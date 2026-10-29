from __future__ import annotations

"""/db routes: nightshift."""

import sqlite3
from typing import Any, Dict, List, Optional, Tuple
from flask import jsonify, request

from ...cache import cache
from ...heroes import get_hero_name
from ...utils import brackets as bk
from ....steam_news import iso_to_epoch, news_for_games
from .core import (
    _load_brackets_events,
    _rows_to_dicts,
    _schedule_data,
    bp,
    get_ro_conn,
)


def _week_brackets(event_title: str, week: int) -> List[Dict[str, Any]]:
    """Authored brackets for one week, computed against the ingested results.

    The structure — rounds, series, advancement — belongs to `data/brackets.json`
    and the bracket builder that writes it. Scores, winners and the teams fed
    forward are computed from those games' results by the same helper the admin
    bracket view uses, so both surfaces always agree.

    Returns an empty list when the file is missing or holds no matching week, so
    callers can fall back to deriving a bracket from the match rows.
    """
    wanted = str(event_title or "").strip().lower()
    events = [
        event
        for event in _load_brackets_events()
        if str(event.get("title") or "").strip().lower() == wanted
        and int(event.get("week") or 0) == int(week)
    ]
    if not events:
        return []

    match_ids: List[int] = []
    for event in events:
        match_ids.extend(bk.match_ids(event))

    # {match_id: 'team_a' | 'team_b'} — the winning *slot*, which is what the
    # bracket model advances. Rows without a recorded side stay untold.
    results: Dict[int, str] = {}
    if match_ids:
        placeholders = ",".join("?" * len(match_ids))
        with get_ro_conn() as conn:
            cur = conn.execute(
                f"""
                SELECT match_id, winning_team, event_team_a_ingame_side
                FROM matches
                WHERE match_id IN ({placeholders})
                """,
                tuple(match_ids),
            )
            for match_id, winning_team, side_a in cur.fetchall():
                if winning_team is None or side_a is None:
                    continue
                results[int(match_id)] = "team_a" if int(winning_team) == int(side_a) else "team_b"

    computed: List[Dict[str, Any]] = []
    for event in events:
        payload = bk.compute(event, results)
        payload["ban_pattern"] = bk.ban_pattern(event)
        payload["bans_per_team"] = bk.bans_per_team(event)
        computed.append(payload)
    computed.sort(key=lambda event: str(event.get("region") or ""))
    return computed


def _week_announcements(matches: List[Dict[str, Any]]) -> Dict[str, Any]:
    """The Steam announcements this week's games came after, for the page to link to.

    Split by kind, because they age differently: the game update the night was
    played under stays relevant however old it is, while a hero reveal only
    explains the night while it is recent. The week links out to Steam rather than
    showing build numbers, which mean nothing to a reader. Both are None when
    nothing of that kind predates the week, or when Steam cannot be reached.
    """
    games: List[tuple] = []
    for match in matches or []:
        start = iso_to_epoch(match.get("start_time"))
        if start is None:
            continue
        games.append((start, start + int(match.get("duration_s") or 0)))
    return news_for_games(games)


def _stream_vod(vod_link: Any, vod_links: Any) -> Optional[Dict[str, str]]:
    """The whole broadcast's VOD, from either shape `matches.json` uses.

    Weeks recorded early carry a single `vod_link` string; later weeks carry a
    `vod_links` list of `{title, url}`. Both mean the same thing to the page, so
    they are normalised here rather than making the frontend know about both.
    """
    if vod_link:
        return {"url": str(vod_link), "title": ""}
    if isinstance(vod_links, list):
        for entry in vod_links:
            if isinstance(entry, dict) and entry.get("url"):
                return {"url": str(entry["url"]), "title": str(entry.get("title") or "")}
            if isinstance(entry, str) and entry:
                return {"url": entry, "title": ""}
    return None


def _nightshift_available_events(conn: sqlite3.Connection) -> List[str]:
    cur = conn.execute(
        """
        SELECT DISTINCT event_title
        FROM matches
        WHERE event_title IS NOT NULL AND TRIM(event_title) != '' AND event_week IS NOT NULL
        ORDER BY LOWER(event_title) ASC
        """
    )
    return [row[0] for row in cur.fetchall()]


def _match_winner_side(row: Dict[str, Any]) -> Optional[str]:
    """Return 'a'/'b' for the side that won a single match row, else None.

    `winning_team` is the in-game side (0 = Amber, 1 = Sapphire) and
    `event_team_a_ingame_side` maps the series' team A onto a side. Rows written
    before that column existed fall back to team A = Amber.
    """
    winning = row.get("winning_team")
    if winning not in (0, 1):
        return None
    side_a = row.get("event_team_a_ingame_side")
    if side_a not in (0, 1):
        side_a = 0
    return "a" if winning == side_a else "b"


def _normalize_region(value: Optional[str]) -> Optional[str]:
    """Normalize the hand-authored `event_region` to an uppercase label."""
    region = (value or "").strip().upper()
    return region or None


def _build_nightshift_index(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Collapse match rows into one index entry per event week, oldest first.

    Each week carries the same per-region series summaries the week page builds
    from its own matches, so the sidebar (region champions and a filtered team's
    result) and the bracket card derive from a single shape. `event_region` is
    hand-authored and is occasionally blank, so a missing region is inferred
    from a team that already has a known one in the same week.
    """
    weeks: Dict[int, Dict[str, Any]] = {}
    series_by_key: Dict[Tuple[int, str, str, str, str], Dict[str, Any]] = {}

    for row in rows:
        week = row.get("event_week")
        if week is None:
            continue
        entry = weeks.setdefault(week, {"week": week, "date": None, "regions": {}})
        start_time = row.get("start_time")
        if start_time and (entry["date"] is None or start_time < entry["date"]):
            entry["date"] = start_time

        team_a = row.get("event_team_a") or ""
        team_b = row.get("event_team_b") or ""
        if not team_a or not team_b:
            continue
        region = _normalize_region(row.get("event_region"))
        round_title = (row.get("event_subtitle") or "").strip()
        key = (week, region or "", round_title, team_a, team_b)
        series = series_by_key.get(key)
        if series is None:
            series = series_by_key[key] = {
                "region": region,
                "round": round_title or None,
                "team_a": team_a,
                "team_b": team_b,
                "score_a": 0,
                "score_b": 0,
                "start_time": start_time,
                "teams": (team_a, team_b),
            }
        elif start_time and (series["start_time"] is None or start_time < series["start_time"]):
            series["start_time"] = start_time
        winner = _match_winner_side(row)
        if winner == "a":
            series["score_a"] += 1
        elif winner == "b":
            series["score_b"] += 1

    # Fill in blank regions from any other series in the same week that shares a team.
    teams_by_week: Dict[int, Dict[str, str]] = {}
    for (week, _, _, _, _), series in series_by_key.items():
        if not series["region"]:
            continue
        for team in series["teams"]:
            teams_by_week.setdefault(week, {})[team] = series["region"]
    for (week, _, _, _, _), series in series_by_key.items():
        if series["region"]:
            continue
        known = teams_by_week.get(week, {})
        inferred = known.get(series["team_a"]) or known.get(series["team_b"])
        if inferred:
            series["region"] = inferred

    for (week, _, _, _, _), series in series_by_key.items():
        region = series["region"] or "Other"
        week_entry = weeks.get(week)
        if week_entry is None:
            continue
        bucket = week_entry["regions"].setdefault(region, {"series": []})
        bucket["series"].append(
            {
                "round": series["round"],
                "team_a": series["team_a"],
                "team_b": series["team_b"],
                "score_a": series["score_a"],
                "score_b": series["score_b"],
                "start_time": series["start_time"],
            }
        )

    for week_entry in weeks.values():
        for bucket in week_entry["regions"].values():
            bucket["series"].sort(key=lambda s: (s["start_time"] or "", s["team_a"], s["team_b"]))
    return [weeks[key] for key in sorted(weeks)]


@bp.get("/nightshift/index")
@cache.cached(timeout=1800, query_string=True)
def nightshift_index():
    """Week index for the Night Shift page: one entry per week, oldest first."""
    event_title = (request.args.get("event_title") or "").strip() or "Night Shift"
    with get_ro_conn() as conn:
        cur = conn.execute(
            """
            SELECT
                m.event_week, m.event_region, m.event_subtitle,
                m.event_team_a, m.event_team_b,
                m.winning_team, m.event_team_a_ingame_side,
                m.start_time, m.match_id
            FROM matches m
            WHERE LOWER(m.event_title) = LOWER(?) AND m.event_week IS NOT NULL
              AND m.event_team_a IS NOT NULL AND m.event_team_b IS NOT NULL
            ORDER BY m.event_week ASC, COALESCE(m.start_time, '') ASC, m.match_id ASC
            """,
            (event_title,),
        )
        rows = _rows_to_dicts(cur)
        available_event_titles = _nightshift_available_events(conn)

    return jsonify(
        {
            "event_title": event_title,
            "available_event_titles": available_event_titles,
            "weeks": _build_nightshift_index(rows),
        }
    )


@bp.get("/nightshift/<int:week>")
@cache.cached(timeout=1800, query_string=True)
def nightshift_week(week: int):
    """Return all matches and summary stats for a given Night Shift week."""
    # Event titles are hand-authored in data/matches.json and their casing has
    # slipped before ("NIGHT SHIFT" vs "Night Shift"), which silently hides a
    # whole week because SQLite's `=` on TEXT is case-sensitive. Match loosely.
    event_title = (request.args.get("event_title") or "").strip() or "Night Shift"
    with get_ro_conn() as conn:
        # Summary stats for the week
        stats_row = conn.execute(
            """
            SELECT
                COUNT(*) AS total_matches,
                SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) AS amber_wins,
                SUM(CASE WHEN winning_team = 1 THEN 1 ELSE 0 END) AS sapphire_wins,
                ROUND(AVG(duration_s), 0) AS avg_duration_s,
                MIN(start_time) AS first_match_time
            FROM matches
            WHERE LOWER(event_title) = LOWER(?) AND event_week = ?
            """,
            (event_title, week),
        ).fetchone()
        stats_cols = ["total_matches", "amber_wins", "sapphire_wins", "avg_duration_s", "first_match_time"]
        stats = dict(zip(stats_cols, stats_row)) if stats_row else {}

        # All matches for this week
        cur = conn.execute(
            """
            SELECT
                m.match_id, m.duration_s, m.winning_team,
                m.event_title, m.event_week, m.event_game,
                m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                m.start_time, m.event_subtitle, m.event_region, m.match_vod
            FROM matches m
            WHERE LOWER(m.event_title) = LOWER(?) AND m.event_week = ?
            ORDER BY m.start_time ASC, m.match_id ASC
            """,
            (event_title, week),
        )
        matches = _rows_to_dicts(cur)

        # Player stats for each match
        match_ids = [m["match_id"] for m in matches]
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            pcur = conn.execute(
                f"""
                SELECT p.match_id, p.team, p.hero_id, p.kills, p.deaths, p.assists,
                       p.net_worth, p.player_damage, p.player_healing,
                       p.account_id, u.persona_name, u.avatar_url
                FROM players p
                LEFT JOIN users u ON u.account_id = p.account_id
                WHERE p.match_id IN ({placeholders})
                ORDER BY p.team, p.player_slot
                """,
                tuple(match_ids),
            )
            players_by_match: dict = {}
            for row in _rows_to_dicts(pcur):
                mid = row["match_id"]
                if mid not in players_by_match:
                    players_by_match[mid] = []
                if row.get("hero_id"):
                    row["hero_name"] = get_hero_name(row["hero_id"])
                players_by_match[mid].append(row)
            for m in matches:
                m["players"] = players_by_match.get(m["match_id"], [])

            # Per-match hero bans. `match_bans` is written by the ingester and is
            # absent from databases created before bans were tracked, so a missing
            # table must degrade to "no bans" instead of failing the whole week.
            try:
                bcur = conn.execute(
                    f"""
                    SELECT b.match_id, b.ban_order, b.team, b.hero_id
                    FROM match_bans b
                    WHERE b.match_id IN ({placeholders})
                    ORDER BY b.match_id, b.ban_order
                    """,
                    tuple(match_ids),
                )
                bans_by_match: dict = {}
                for row in _rows_to_dicts(bcur):
                    if row.get("hero_id"):
                        row["hero_name"] = get_hero_name(row["hero_id"])
                    bans_by_match.setdefault(row["match_id"], []).append(row)
            except sqlite3.OperationalError:
                bans_by_match = {}
            for m in matches:
                m["bans"] = bans_by_match.get(m["match_id"], [])

        # Neighbouring weeks so the page can offer prev/next navigation
        neighbours = conn.execute(
            """
            SELECT DISTINCT event_week FROM matches
            WHERE LOWER(event_title) = LOWER(?) AND event_week IS NOT NULL
            ORDER BY event_week ASC
            """,
            (event_title,),
        ).fetchall()
        all_weeks = [r[0] for r in neighbours]

        # Pull vod_link (week-level), per-series match_vod, and per-game match_vod from brackets.json
        vod_link: str | None = None
        vod_links: list = []
        series_vods: dict = {}  # key: "team_a__team_b" -> vod url
        game_vods: dict = {}    # key: str(match_id) -> vod url
        try:
            mdata = _schedule_data()
            week_entries: list = []
            root_series = mdata.get("series")
            if isinstance(root_series, list):
                for s in root_series:
                    for e in s.get("weeks") or s.get("events") or []:
                        if isinstance(e, dict) and e.get("week") == week:
                            week_entries.append(e)
            if not week_entries:
                for e in mdata.get("weeks") or mdata.get("events") or []:
                    if isinstance(e, dict) and e.get("week") == week:
                        week_entries.append(e)
            for entry in week_entries:
                if not vod_link:
                    vod_link = entry.get("vod_link") or None
                if not vod_links:
                    raw_vls = entry.get("vod_links")
                    if isinstance(raw_vls, list) and raw_vls:
                        vod_links = raw_vls
                for game in entry.get("games") or []:
                    if not isinstance(game, dict):
                        continue
                    ta = game.get("team_a") or game.get("team1") or ""
                    tb = game.get("team_b") or game.get("team2") or ""
                    mv = game.get("match_vod") or ""
                    if mv and ta and tb:
                        series_vods[f"{ta}__{tb}"] = mv
                    for gmatch in game.get("matches") or []:
                        if not isinstance(gmatch, dict):
                            continue
                        mid = gmatch.get("match_id")
                        gvod = gmatch.get("match_vod") or ""
                        if mid and gvod:
                            game_vods[str(mid)] = gvod
        except Exception:
            pass

        announcements = _week_announcements(matches)
        return jsonify({
            "week": week,
            "event_title": event_title,
            "stats": stats,
            "matches": matches,
            "brackets": _week_brackets(event_title, week),
            "latest_update": announcements["update"],
            "latest_hero": announcements["hero"],
            "all_weeks": all_weeks,
            "stream_vod": _stream_vod(vod_link, vod_links),
            "vod_link": vod_link,
            "vod_links": vod_links,
            "series_vods": series_vods,
            "game_vods": game_vods,
        })
