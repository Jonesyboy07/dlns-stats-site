"""Per-route SEO metadata for the React shell pages.

Every React entry is served by ``templates/react.html``, so the shell is the only
place a crawler or link-preview bot sees metadata before JavaScript runs. This
module derives a title, description, canonical URL, social tags and (where it is
worthwhile) JSON-LD from the request path, keeping the individual route handlers
free of SEO plumbing.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from datetime import datetime, timezone
from typing import Any
from urllib.parse import quote, unquote

from flask import Flask, current_app, g, has_request_context, request

from .heroes import get_hero_name

BRAND = "DLNS Stats"
DEFAULT_TITLE = "DLNS Stats — Deadlock Night Shift Match Results & Stats"
DEFAULT_DESCRIPTION = (
    "Deadlock Night Shift match results, player and team statistics, hero "
    "performance and weekly standings for DLNS and Fight Night."
)

_CACHE_TTL_SECONDS = 300
_MAX_CACHE_ENTRIES = 2000
_cache: dict[str, tuple[float, Any]] = {}

_MATCH_RE = re.compile(r"^/matches?/(\d+)$")
_SERIES_RE = re.compile(r"^/series/(\d+)$")
_PLAYER_RE = re.compile(r"^/player/(\d+)$")
_PLAYER_HERO_RE = re.compile(r"^/player/(\d+)/hero/(\d+)$")
_HERO_RE = re.compile(r"^/hero/(\d+)$")
_TEAM_RE = re.compile(r"^/team/(.+)$")
_WEEK_RE = re.compile(r"^/week/(\d+)$")
_INTERVIEW_RE = re.compile(r"^/interviews/([^/]+)$")

# (title, description, og:type)
_STATIC_PAGES: dict[str, tuple[str, str, str]] = {
    "/": (
        "DLNS Stats — Deadlock Night Shift Match Results & Stats",
        "Live Deadlock Night Shift match results, player and team stats, hero "
        "pick rates and weekly Night Shift standings.",
        "website",
    ),
    "/matchlist": (
        "Deadlock Match Results — DLNS Stats",
        "Browse recent DLNS Night Shift and Fight Night matches with scoreboards, "
        "player stats and series results.",
        "website",
    ),
    "/players": (
        "Deadlock Player Stats & Leaderboards — DLNS Stats",
        "Deadlock Night Shift player leaderboards: win rates, KDA, hero pools and "
        "match histories for every DLNS player.",
        "website",
    ),
    "/teams": (
        "Deadlock Team Records & Rosters — DLNS Stats",
        "DLNS Night Shift team records, rosters, hero usage and weekly results for "
        "every team in the league.",
        "website",
    ),
    "/heroes": (
        "Deadlock Hero Stats, Pick Rates & Win Rates — DLNS Stats",
        "Deadlock hero statistics from the Night Shift league: pick rate, win rate, "
        "item builds, matchups and top players per hero.",
        "website",
    ),
    "/items": (
        "Deadlock Item Stats & Builds — DLNS Stats",
        "Deadlock item usage in the Night Shift league: pick rates, win rates and "
        "the most common item builds by hero.",
        "website",
    ),
    "/stats/": (
        "Deadlock League Stats & Records — DLNS Stats",
        "League-wide Deadlock Night Shift statistics, records, averages and weekly "
        "trends across every DLNS event.",
        "website",
    ),
    "/week": (
        "Night Shift Weekly Results & Standings — DLNS Stats",
        "Night Shift weekly brackets, series results, standings and hero picks for "
        "the current DLNS event.",
        "website",
    ),
    "/community": (
        "Deadlock Community Links — DLNS Stats",
        "Deadlock Night Shift community links, creators, resources and ways to get "
        "involved with the league.",
        "website",
    ),
    "/help": (
        "DLNS Stats Help & Guides — DLNS Stats",
        "How to use DLNS Stats: match pages, player profiles, hero statistics and "
        "the Night Shift week view.",
        "website",
    ),
    "/updates": (
        "DLNS Stats Updates — DLNS Stats",
        "The latest DLNS Stats site updates and Night Shift league announcements.",
        "website",
    ),
    "/interviews/": (
        "Deadlock Player Interviews — DLNS Stats",
        "Interviews with Deadlock Night Shift players, teams and community figures.",
        "website",
    ),
    "/privacy": (
        "Privacy Policy — DLNS Stats",
        "How DLNS Stats handles analytics and visitor data.",
        "website",
    ),
}

# Admin tooling and search results are not useful landing pages. Keep them out of
# the index while still letting crawlers follow their links.
_NOINDEX_PATHS = {"/search"}
_NOINDEX_PREFIXES = ("/admin", "/react-admin", "/interviews/upload")

_NOT_FOUND_TITLES = {
    "match": "Match not found",
    "series": "Series not found",
    "player": "Player not found",
    "player-hero": "Player hero page not found",
    "hero": "Hero not found",
    "team": "Team not found",
    "week": "Week not found",
}
_NOT_FOUND_DESCRIPTION = (
    "The requested page could not be found. Browse the latest Deadlock Night "
    "Shift match results, players, teams and hero statistics."
)

_STATIC_BREADCRUMB_LABELS = {
    "/matchlist": "Match results",
    "/players": "Players",
    "/teams": "Teams",
    "/heroes": "Heroes",
    "/items": "Items",
    "/stats/": "League stats",
    "/week": "Night Shift weeks",
    "/help": "Help",
    "/community": "Community",
    "/updates": "Updates",
    "/interviews/": "Interviews",
}


def _base_url() -> str:
    configured = str(current_app.config.get("BASE_URL", "")).strip().rstrip("/")
    if configured:
        return configured
    if has_request_context():
        return request.url_root.rstrip("/")
    return "http://localhost:5050"


def _abs(url_path: str) -> str:
    if not url_path:
        return _base_url() + "/"
    if url_path.startswith("http://") or url_path.startswith("https://"):
        return url_path
    base = _base_url()
    return base + url_path if url_path.startswith("/") else f"{base}/{url_path}"


def _verification_metas() -> list[dict[str, str]]:
    metas: list[dict[str, str]] = []
    for name, config_key in (
        ("google-site-verification", "GOOGLE_SITE_VERIFICATION"),
        ("msvalidate.01", "BING_SITE_VERIFICATION"),
    ):
        token = str(current_app.config.get(config_key, "") or "").strip()
        if token:
            metas.append({"name": name, "content": token})
    return metas


def _og_image_url() -> str:
    configured = str(current_app.config.get("OG_IMAGE", "og.png") or "og.png")
    if configured.startswith("http://") or configured.startswith("https://"):
        return configured
    return _abs("/static/" + configured.lstrip("/"))


# These routes are served with a trailing slash and Flask redirects the
# slash-less form, so the canonical must keep the slash to avoid pointing at a
# redirect.
_TRAILING_SLASH_PATHS = {"/stats": "/stats/", "/interviews": "/interviews/"}


def _canonical_path(path: str) -> str:
    path = path or "/"
    if path == "/home":
        return "/"
    if path.startswith("/users/"):
        path = "/player/" + path[len("/users/") :]
    if path.startswith("/match/"):
        path = "/matches/" + path[len("/match/") :]
    stripped = path.rstrip("/") if path != "/" else path
    if stripped in _TRAILING_SLASH_PATHS:
        return _TRAILING_SLASH_PATHS[stripped]
    return stripped


def _with_brand(title: str) -> str:
    title = " ".join(str(title or "").split())
    if not title:
        return DEFAULT_TITLE
    if BRAND.lower() in title.lower():
        return title
    return f"{title} • {BRAND}"


def _is_noindex(path: str) -> bool:
    return path in _NOINDEX_PATHS or path.startswith(_NOINDEX_PREFIXES)


def _cache_key(*parts: Any) -> str:
    db_path = str(current_app.config.get("DB_PATH", ""))
    return "|".join([db_path, *(str(part) for part in parts)])


def _cached(key: str, loader):
    now = time.time()
    hit = _cache.get(key)
    if hit and now - hit[0] < _CACHE_TTL_SECONDS:
        return hit[1]
    value = loader()
    if len(_cache) >= _MAX_CACHE_ENTRIES:
        for stale in list(_cache)[: _MAX_CACHE_ENTRIES // 2]:
            _cache.pop(stale, None)
    _cache[key] = (now, value)
    return value


def _fetch_match(match_id: int) -> dict[str, Any] | None:
    def load():
        from .blueprints.db_api import get_ro_conn

        sql = (
            "SELECT match_id, event_title, event_week, event_team_a, event_team_b, "
            "event_game, event_region, start_time, created_at, winning_team "
            "FROM matches WHERE match_id = ?"
        )
        conn = get_ro_conn()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(sql, (match_id,)).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    return _cached(_cache_key("match", match_id), load)


def _fetch_user(account_id: int) -> dict[str, Any] | None:
    def load():
        from .blueprints.db_api import get_ro_conn

        conn = get_ro_conn()
        try:
            conn.row_factory = sqlite3.Row
            row = conn.execute(
                "SELECT account_id, persona_name FROM users WHERE account_id = ?",
                (account_id,),
            ).fetchone()
            return dict(row) if row else None
        finally:
            conn.close()

    return _cached(_cache_key("user", account_id), load)


def _fetch_team(name: str) -> str | None:
    """Return the stored spelling of a team name, or None when it has no matches."""

    def load():
        from .blueprints.db_api import get_ro_conn

        conn = get_ro_conn()
        try:
            row = conn.execute(
                "SELECT event_team_a, event_team_b FROM matches "
                "WHERE LOWER(event_team_a) = LOWER(?) OR LOWER(event_team_b) = LOWER(?) "
                "LIMIT 1",
                (name, name),
            ).fetchone()
            if not row:
                return None
            for value in row:
                if value and str(value).lower() == name.lower():
                    return str(value)
            return str(row[0] or row[1] or name)
        finally:
            conn.close()

    return _cached(_cache_key("team", name.lower()), load)


def _week_exists(week: int) -> bool:
    def load():
        from .blueprints.db_api import get_ro_conn

        conn = get_ro_conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM matches WHERE event_week = ? LIMIT 1", (week,)
            ).fetchone()
            return bool(row)
        finally:
            conn.close()

    return bool(_cached(_cache_key("week", week), load))


def _iso_datetime(value: Any) -> str | None:
    """Normalise the two formats matches.start_time is stored in."""
    if value is None:
        return None
    try:
        if isinstance(value, (int, float)):
            return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
        text = str(value).strip()
        if not text:
            return None
        if text.isdigit():
            return datetime.fromtimestamp(float(text), tz=timezone.utc).isoformat()
        return datetime.fromisoformat(text.replace("Z", "+00:00")).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _match_label(match: dict[str, Any], match_id: int) -> str:
    team_a = match.get("event_team_a")
    team_b = match.get("event_team_b")
    if team_a and team_b:
        label = f"{team_a} vs {team_b}"
    else:
        label = f"Match {match_id}"
    week = match.get("event_week")
    game = str(match.get("event_game") or "").strip()
    if week:
        label += f" — Week {week}"
    if game:
        label += f" {game}"
    return label


def _match_context(match: dict[str, Any]) -> str:
    pieces = []
    event = str(match.get("event_title") or "").strip()
    week = match.get("event_week")
    region = str(match.get("event_region") or "").strip()
    if event and week:
        pieces.append(f"{event} Week {week}")
    elif event:
        pieces.append(event)
    if region:
        pieces.append(region)
    return ", ".join(pieces)


def _match_page(match_id: int, canonical: str) -> dict[str, Any]:
    match = _fetch_match(match_id)
    if not match:
        return {}

    title = _with_brand(_match_label(match, match_id))
    context = _match_context(match)
    team_a = match.get("event_team_a")
    team_b = match.get("event_team_b")
    at_context = f" at {context}" if context else ""
    if team_a and team_b:
        description = (
            f"{team_a} vs {team_b}{at_context}. Full Deadlock scoreboard, player "
            "souls and damage, item builds and match timeline."
        )
    else:
        description = (
            f"Deadlock match {match_id}{at_context}: scoreboard, player stats, "
            "item builds and timeline."
        )

    jsonld = {
        "@context": "https://schema.org",
        "@type": "SportsEvent",
        "name": _match_label(match, match_id),
        "url": _abs(canonical),
        "description": description,
        "eventStatus": "https://schema.org/EventScheduled",
    }
    start_date = _iso_datetime(match.get("start_time") or match.get("created_at"))
    if start_date:
        jsonld["startDate"] = start_date
    if team_a and team_b:
        jsonld["homeTeam"] = {"@type": "SportsTeam", "name": team_a}
        jsonld["awayTeam"] = {"@type": "SportsTeam", "name": team_b}
    if context:
        jsonld["superEvent"] = {"@type": "SportsEvent", "name": context}

    breadcrumbs = [("Home", "/")]
    if match.get("event_week") is not None:
        breadcrumbs.append(
            (f"Night Shift Week {match['event_week']}", f"/week/{match['event_week']}")
        )
    breadcrumbs.append(
        (f"{team_a} vs {team_b}" if team_a and team_b else f"Match {match_id}", canonical)
    )

    return {
        "title": title,
        "description": description,
        "jsonld": jsonld,
        "breadcrumbs": breadcrumbs,
    }


def _player_page(account_id: int, canonical: str) -> dict[str, Any]:
    user = _fetch_user(account_id)
    if not user or not user.get("persona_name"):
        return {}

    persona = str(user["persona_name"]).strip()
    description = (
        f"{persona}'s Deadlock Night Shift match history, hero pool, teammates, "
        "opponents and performance statistics."
    )
    jsonld = {
        "@context": "https://schema.org",
        "@type": "ProfilePage",
        "url": _abs(canonical),
        "mainEntity": {
            "@type": "Person",
            "name": persona,
            "identifier": account_id,
            "url": _abs(canonical),
        },
    }
    return {
        "title": _with_brand(f"{persona} — Deadlock Player Stats"),
        "description": description,
        "jsonld": jsonld,
        "og_type": "profile",
        "breadcrumbs": [("Home", "/"), ("Players", "/players"), (persona, canonical)],
    }


def _interview_page(entry_ref: str, canonical: str) -> dict[str, Any]:
    # Imported lazily: the interviews blueprint owns the entry index and aliases,
    # and re-implementing that lookup here would inevitably drift.
    from .blueprints.interviews import _resolve_entry_ref

    entry, _source = _resolve_entry_ref(unquote(entry_ref))
    if not entry or not entry.get("title"):
        return {}

    title = str(entry["title"]).strip()
    guest = str(entry.get("guest") or "").strip()
    short_id = str(entry.get("short_id") or "").strip()
    description = (
        f"Interview with {guest} from the Deadlock Night Shift community."
        if guest
        else f"Read {title} on DLNS Stats."
    )
    jsonld: dict[str, Any] = {
        "@context": "https://schema.org",
        "@type": "Article",
        "headline": title,
        "url": _abs(f"/interviews/{short_id}" if short_id else canonical),
        "description": description,
    }
    published = _iso_datetime(entry.get("created_at"))
    if published:
        jsonld["datePublished"] = published

    resolved = f"/interviews/{short_id}" if short_id else canonical
    return {
        "title": _with_brand(f"{title} — DLNS Interview"),
        "description": description,
        "jsonld": jsonld,
        "canonical": resolved,
        "og_type": "article",
        "breadcrumbs": [("Home", "/"), ("Interviews", "/interviews/"), (title, resolved)],
    }


def _hero_page(hero_id: int, canonical: str) -> dict[str, Any]:
    hero_name = get_hero_name(hero_id)
    if not hero_name or hero_name.startswith("Hero "):
        return {}

    return {
        "title": _with_brand(f"{hero_name} Stats — Deadlock Night Shift"),
        "description": (
            f"{hero_name} pick rate, win rate, item builds, matchups and top players "
            "in the Deadlock Night Shift league."
        ),
        "breadcrumbs": [("Home", "/"), ("Heroes", "/heroes"), (hero_name, canonical)],
    }


def _home_jsonld() -> dict[str, Any]:
    base = _base_url()
    return {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": BRAND,
        "alternateName": "Deadlock Night Shift Stats",
        "url": base + "/",
        "description": DEFAULT_DESCRIPTION,
        "potentialAction": {
            "@type": "SearchAction",
            "target": f"{base}/search?q={{search_term_string}}",
            "query-input": "required name=search_term_string",
        },
    }


def _breadcrumb_jsonld(items: list[tuple[str, str]] | None) -> dict[str, Any] | None:
    if not items:
        return None
    return {
        "@context": "https://schema.org",
        "@type": "BreadcrumbList",
        "itemListElement": [
            {
                "@type": "ListItem",
                "position": index,
                "name": name,
                "item": _abs(path),
            }
            for index, (name, path) in enumerate(items, start=1)
        ],
    }


def _combine_jsonld(*values: dict[str, Any] | None) -> dict[str, Any] | None:
    items = [value for value in values if value]
    if not items:
        return None
    if len(items) == 1:
        return items[0]
    graph = [
        {key: value for key, value in item.items() if key != "@context"}
        for item in items
    ]
    return {"@context": "https://schema.org", "@graph": graph}


def _jsonld_text(value: dict[str, Any] | None) -> str:
    if not value:
        return ""
    # Escaping "<" keeps a data value from ever closing the script element.
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).replace("<", "\\u003c")


def build_seo_context() -> dict[str, Any]:
    """Return template variables for the current request's page metadata."""
    if not has_request_context():
        return {}

    path = request.path or "/"
    canonical = quote(_canonical_path(path), safe="/")
    canonical_url = _abs(canonical)

    title = DEFAULT_TITLE
    description = DEFAULT_DESCRIPTION
    og_type = "website"
    jsonld: dict[str, Any] | None = None
    not_found_kind: str | None = None

    try:
        match = _MATCH_RE.match(canonical)
        series = _SERIES_RE.match(canonical)
        player = _PLAYER_RE.match(canonical)
        player_hero = _PLAYER_HERO_RE.match(canonical)
        hero = _HERO_RE.match(canonical)
        team = _TEAM_RE.match(canonical)
        week = _WEEK_RE.match(canonical)
        interview = _INTERVIEW_RE.match(canonical)

        if match:
            page = _match_page(int(match.group(1)), canonical)
            if not page:
                not_found_kind = "match"
        elif series:
            series_id = int(series.group(1))
            series_match = _fetch_match(series_id)
            page = _match_page(series_id, canonical)
            if not page:
                not_found_kind = "series"
            elif series_match:
                team_a = series_match.get("event_team_a")
                team_b = series_match.get("event_team_b")
                label = f"{team_a} vs {team_b} — Series" if team_a and team_b else f"Series {series_id}"
                if team_a and team_b:
                    page["title"] = _with_brand(label)
                breadcrumbs = [("Home", "/")]
                week = series_match.get("event_week")
                if week is not None:
                    breadcrumbs.append((f"Night Shift Week {week}", f"/week/{week}"))
                breadcrumbs.append((label, canonical))
                page["breadcrumbs"] = breadcrumbs
        elif interview:
            page = _interview_page(interview.group(1), canonical)
        elif player_hero:
            account_id, hero_id = int(player_hero.group(1)), int(player_hero.group(2))
            user = _fetch_user(account_id)
            hero_name = get_hero_name(hero_id)
            if user and user.get("persona_name") and not hero_name.startswith("Hero "):
                persona = str(user["persona_name"]).strip()
                page = {
                    "title": _with_brand(f"{persona} on {hero_name} — Deadlock Stats"),
                    "description": (
                        f"{persona}'s {hero_name} stats in the Deadlock Night Shift "
                        "league: matches, builds, matchups and performance trends."
                    ),
                    "og_type": "profile",
                    "breadcrumbs": [
                        ("Home", "/"),
                        ("Players", "/players"),
                        (persona, f"/player/{account_id}"),
                        (hero_name, canonical),
                    ],
                }
            else:
                page = {}
                not_found_kind = "player-hero"
        elif player:
            page = _player_page(int(player.group(1)), canonical)
            if not page:
                not_found_kind = "player"
        elif hero:
            page = _hero_page(int(hero.group(1)), canonical)
            if not page:
                not_found_kind = "hero"
        elif team:
            team_name = unquote(team.group(1)).strip()
            canonical_team = _fetch_team(team_name) if team_name else None
            if canonical_team:
                page = {
                    "title": _with_brand(f"{canonical_team} — Deadlock Team Stats"),
                    "description": (
                        f"{canonical_team}'s Deadlock Night Shift record, roster, hero "
                        "usage and weekly series results."
                    ),
                    "breadcrumbs": [
                        ("Home", "/"),
                        ("Teams", "/teams"),
                        (canonical_team, canonical),
                    ],
                }
            else:
                page = {}
                not_found_kind = "team"
        elif week:
            week_num = int(week.group(1))
            if _week_exists(week_num):
                page = {
                    "title": _with_brand(f"Night Shift Week {week_num} — Results & Standings"),
                    "description": (
                        f"Deadlock Night Shift week {week_num}: brackets, series results, "
                        "standings, hero picks and player leaderboards."
                    ),
                    "breadcrumbs": [
                        ("Home", "/"),
                        ("Night Shift weeks", "/week"),
                        (f"Week {week_num}", canonical),
                    ],
                }
            else:
                page = {}
                not_found_kind = "week"
        elif canonical == "/":
            page = {"jsonld": _home_jsonld()}
        else:
            static = _STATIC_PAGES.get(canonical)
            page = (
                {"title": static[0], "description": static[1], "og_type": static[2]}
                if static
                else {}
            )
            label = _STATIC_BREADCRUMB_LABELS.get(canonical)
            if label:
                page["breadcrumbs"] = [("Home", "/"), (label, canonical)]
    except Exception:
        # Metadata is a progressive enhancement; never break a page render for it.
        page = {}

    if not_found_kind:
        # The route rendered the SPA shell, but the entity it names does not exist.
        # Mark it noindex and let the after-request hook turn the 200 into a 404.
        g.seo_not_found = True
        title = _with_brand(_NOT_FOUND_TITLES.get(not_found_kind, "Page not found"))
        description = _NOT_FOUND_DESCRIPTION
        og_type = "website"
        jsonld = None
        robots = "noindex, follow"
    else:
        title = page.get("title") or title
        description = page.get("description") or description
        og_type = page.get("og_type") or og_type
        jsonld = _combine_jsonld(
            page.get("jsonld") or jsonld,
            _breadcrumb_jsonld(page.get("breadcrumbs")),
        )
        if page.get("canonical"):
            # Interview aliases all point at the stable short_id URL.
            canonical = quote(page["canonical"], safe="/")
            canonical_url = _abs(canonical)
        robots = "noindex, follow" if _is_noindex(canonical) else ""

    return {
        "meta_title": title,
        "meta_desc": description,
        "meta_url": canonical_url,
        "meta_image": _og_image_url(),
        "meta_robots": robots,
        "meta_og_type": og_type,
        "meta_jsonld": _jsonld_text(jsonld),
        "meta_verifications": _verification_metas(),
    }


def register_seo(app: Flask) -> None:
    """Attach the SEO context processor and not-found status hook to an app."""

    @app.context_processor
    def _inject_seo():
        return build_seo_context()

    @app.after_request
    def _apply_not_found_status(response):
        if g.get("seo_not_found") and response.status_code == 200:
            response.status_code = 404
        return response
