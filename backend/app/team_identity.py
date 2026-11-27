from __future__ import annotations

"""Team identity: one franchise, many feed spellings.

`matches.event_team_a` / `event_team_b` keep whatever the feed wrote that week,
so a rename — or an acquisition that rebrands a roster — arrives as a brand-new
"team" with its own partial record, roster and URL. The tables here attach those
raw spellings to a single identity. Read paths resolve a requested name to its
whole family and match on every spelling, so history, record and roster stay
continuous without rewriting a single match row.

The identity file (`data/team_identities.json`, override with
`TEAM_IDENTITIES_PATH`) is the seed: it owns every row it created (`source`
= 'seed'), which makes re-syncing idempotent and lets an admin-owned row
(`source` = 'admin') win over the file.
"""

import json
import logging
import os
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

log = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_IDENTITIES_PATH = PROJECT_ROOT / "data" / "team_identities.json"

_NON_ALNUM = re.compile(r"[^a-z0-9]")

SEED_SOURCE = "seed"
ADMIN_SOURCE = "admin"


class TeamIdentityError(ValueError):
    """The identity file is malformed. Raised before anything is written."""


# ── Names ────────────────────────────────────────────────────────────────────


def identities_path() -> Path:
    configured = (os.environ.get("TEAM_IDENTITIES_PATH") or "").strip()
    return Path(configured) if configured else DEFAULT_IDENTITIES_PATH


def team_key(name: Any) -> str:
    """The key team names are compared on: trimmed and case-folded.

    Matches SQL `LOWER()` on the match columns, which is what every team query
    already groups by, so no feed data has to change.
    """
    return str(name or "").strip().lower()


def team_slug(name: Any) -> str:
    """URL-safe stem, e.g. `"Melee Creeps"` -> `meleecreeps`.

    Mirrors `teamLogoKey()` in frontend/src/utils/teamLogos.js so a team's slug
    and its crest filename stay the same string.
    """
    return _NON_ALNUM.sub("", team_key(name).replace("&", "and"))


@dataclass(frozen=True)
class TeamSpelling:
    """One raw name the feed used, plus the weeks it was in effect."""

    name: str
    key: str
    valid_from_week: Optional[int] = None
    valid_to_week: Optional[int] = None
    logo_key: Optional[str] = None

    def to_payload(self) -> Dict[str, Any]:
        return {
            "name": self.name,
            "valid_from_week": self.valid_from_week,
            "valid_to_week": self.valid_to_week,
            "logo_key": self.logo_key,
        }


@dataclass(frozen=True)
class TeamIdentity:
    """A team and every name it has played under."""

    slug: str
    display_name: str
    spellings: Tuple[TeamSpelling, ...]

    @property
    def keys(self) -> Tuple[str, ...]:
        return tuple(spelling.key for spelling in self.spellings)

    @property
    def former_names(self) -> Tuple[str, ...]:
        current = team_key(self.display_name)
        return tuple(spelling.name for spelling in self.spellings if spelling.key != current)

    @property
    def logo_key(self) -> Optional[str]:
        """Crest stem for the current name, falling back to any spelling's crest."""
        current = team_key(self.display_name)
        for spelling in self.spellings:
            if spelling.key == current and spelling.logo_key:
                return spelling.logo_key
        for spelling in self.spellings:
            if spelling.logo_key:
                return spelling.logo_key
        return None


class TeamIndex:
    """Name -> identity lookup, rebuilt from the DB per request (a few dozen rows)."""

    def __init__(self, identities: Iterable[TeamIdentity] = ()) -> None:
        self._by_slug: Dict[str, TeamIdentity] = {}
        self._by_key: Dict[str, TeamIdentity] = {}
        for identity in identities:
            self._by_slug.setdefault(identity.slug, identity)
            for spelling in identity.spellings:
                self._by_key.setdefault(spelling.key, identity)

    def by_name(self, name: Any) -> Optional[TeamIdentity]:
        """The identity whose spellings include exactly this name (no slug guessing)."""
        return self._by_key.get(team_key(name))

    def resolve(self, name: Any) -> Optional[TeamIdentity]:
        """The identity owning `name`, or None when the name has no entry."""
        identity = self.by_name(name)
        if identity is not None:
            return identity
        # A slug works as a URL too ("/team/meleecreeps" -> "Melee Creeps").
        return self._by_slug.get(team_slug(name))

    def names_for(self, name: Any) -> Tuple[str, ...]:
        """Every raw spelling (lower-cased) in `name`'s family.

        An unknown name resolves to itself, which is exactly the pre-identity
        behaviour: a team the identity file has never heard of.
        """
        identity = self.resolve(name)
        if identity is not None:
            return identity.keys
        key = team_key(name)
        return (key,) if key else ()

    def __bool__(self) -> bool:
        return bool(self._by_key)


_INDEX_SQL = """
SELECT
    t.slug,
    t.display_name,
    n.display_name,
    n.valid_from_week,
    n.valid_to_week,
    n.logo_key
FROM teams t
JOIN team_names n ON n.team_id = t.team_id
ORDER BY t.slug, n.valid_from_week IS NOT NULL, n.valid_from_week, LOWER(n.display_name)
"""


def load_team_index(conn: sqlite3.Connection) -> TeamIndex:
    """Build the resolver from the DB. Missing tables mean "no identities yet"."""
    try:
        rows = conn.execute(_INDEX_SQL).fetchall()
    except sqlite3.Error:
        return TeamIndex()
    grouped: Dict[str, Dict[str, Any]] = {}
    for slug, display_name, name, from_week, to_week, logo_key in rows:
        entry = grouped.setdefault(slug, {"display_name": display_name, "spellings": []})
        entry["spellings"].append(
            TeamSpelling(str(name), team_key(name), from_week, to_week, logo_key)
        )
    return TeamIndex(
        TeamIdentity(slug, entry["display_name"], tuple(entry["spellings"]))
        for slug, entry in grouped.items()
    )


# ── Seed file ────────────────────────────────────────────────────────────────


def load_identities_file(path: Optional[Path] = None) -> List[Dict[str, Any]]:
    """Parse and validate the identity file. A missing file means "no identities"."""
    source = Path(path) if path is not None else identities_path()
    try:
        raw = source.read_text(encoding="utf-8")
    except FileNotFoundError:
        return []
    except OSError as exc:
        raise TeamIdentityError(f"{source}: {exc}") from exc
    if not raw.strip():
        return []
    try:
        data = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise TeamIdentityError(f"{source}: invalid JSON ({exc})") from exc
    return _validate_entries(data, source)


def _validate_entries(data: Any, source: Path) -> List[Dict[str, Any]]:
    if not isinstance(data, Mapping):
        raise TeamIdentityError(f"{source}: expected an object with a 'teams' array")
    raw_teams = data.get("teams", [])
    if not isinstance(raw_teams, list):
        raise TeamIdentityError(f"{source}: 'teams' must be an array")

    teams: List[Dict[str, Any]] = []
    slugs: Dict[str, str] = {}
    keys: Dict[str, str] = {}

    for position, entry in enumerate(raw_teams):
        where = f"{source}: teams[{position}]"
        if not isinstance(entry, Mapping):
            raise TeamIdentityError(f"{where}: expected an object")
        display_name = str(entry.get("name") or "").strip()
        if not display_name:
            raise TeamIdentityError(f"{where}: 'name' is required")

        slug = team_slug(entry.get("slug") or display_name)
        if not slug:
            raise TeamIdentityError(f"{where}: 'slug' is empty after normalisation")
        if slug in slugs:
            raise TeamIdentityError(f"{where}: slug {slug!r} is already used by {slugs[slug]!r}")

        spellings = _validate_spellings(entry.get("names"), where)
        if not spellings:
            spellings = [_new_spelling(display_name)]
        if team_key(display_name) not in {team_key(s["name"]) for s in spellings}:
            # The current name must always resolve, even if only old spellings are listed.
            spellings.append(_new_spelling(display_name))

        for spelling in spellings:
            key = team_key(spelling["name"])
            if key in keys:
                raise TeamIdentityError(
                    f"{where}: name {spelling['name']!r} is already used by {keys[key]!r}"
                )
            keys[key] = display_name
            spelling["key"] = key

        logo_key = entry.get("logo_key")
        slugs[slug] = display_name
        teams.append(
            {
                "slug": slug,
                "display_name": display_name,
                "logo_key": str(logo_key).strip() if logo_key else None,
                "spellings": spellings,
            }
        )
    return teams


def _new_spelling(name: str) -> Dict[str, Any]:
    return {"name": name, "valid_from_week": None, "valid_to_week": None, "logo_key": None}


def _validate_spellings(raw: Any, where: str) -> List[Dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise TeamIdentityError(f"{where}: 'names' must be an array")
    spellings = []
    for index, item in enumerate(raw):
        spot = f"{where}.names[{index}]"
        if isinstance(item, str):
            item = {"name": item}
        if not isinstance(item, Mapping):
            raise TeamIdentityError(f"{spot}: expected a name or an object")
        name = str(item.get("name") or "").strip()
        if not name:
            raise TeamIdentityError(f"{spot}: 'name' is required")
        from_week = _week(item.get("valid_from_week"), f"{spot}.valid_from_week")
        to_week = _week(item.get("valid_to_week"), f"{spot}.valid_to_week")
        if from_week is not None and to_week is not None and from_week > to_week:
            raise TeamIdentityError(f"{spot}: valid_from_week is after valid_to_week")
        logo_key = item.get("logo_key")
        spellings.append(
            {
                "name": name,
                "valid_from_week": from_week,
                "valid_to_week": to_week,
                "logo_key": str(logo_key).strip() if logo_key else None,
            }
        )
    if len({team_key(s["name"]) for s in spellings}) != len(spellings):
        raise TeamIdentityError(f"{where}: the same name is listed twice")
    return spellings


def _week(value: Any, where: str) -> Optional[int]:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, int):
        raise TeamIdentityError(f"{where}: expected an integer week or null")
    return value


# ── Sync ─────────────────────────────────────────────────────────────────────


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _desired_state(
    path: Optional[Path] = None,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    teams: Dict[str, Dict[str, Any]] = {}
    names: Dict[str, Dict[str, Any]] = {}
    for team in load_identities_file(path):
        teams[team["slug"]] = {
            "display_name": team["display_name"],
            "logo_key": team["logo_key"],
        }
        for spelling in team["spellings"]:
            names[spelling["key"]] = {
                "slug": team["slug"],
                "display_name": spelling["name"],
                "valid_from_week": spelling["valid_from_week"],
                "valid_to_week": spelling["valid_to_week"],
                "logo_key": spelling["logo_key"] or team["logo_key"],
            }
    return teams, names


def _current_state(
    conn: sqlite3.Connection,
) -> Tuple[Dict[str, Dict[str, Any]], Dict[str, Dict[str, Any]]]:
    teams: Dict[str, Dict[str, Any]] = {}
    for slug, display_name, logo_key in conn.execute(
        "SELECT slug, display_name, logo_key FROM teams"
    ):
        teams[slug] = {"display_name": display_name, "logo_key": logo_key}
    names: Dict[str, Dict[str, Any]] = {}
    for row in conn.execute(
        """
        SELECT n.name_key, t.slug, n.display_name, n.valid_from_week, n.valid_to_week,
               n.logo_key, n.source
        FROM team_names n
        JOIN teams t ON t.team_id = n.team_id
        """
    ):
        name_key, slug, display_name, from_week, to_week, logo_key, source = row
        names[name_key] = {
            "slug": slug,
            "display_name": display_name,
            "valid_from_week": from_week,
            "valid_to_week": to_week,
            "logo_key": logo_key,
            "source": source,
        }
    return teams, names


def sync_team_identities(conn: sqlite3.Connection, path: Optional[Path] = None) -> bool:
    """Apply the identity file to the DB, touching seed-owned rows only.

    Returns True when anything changed, so the caller can drop cached team
    payloads. Idempotent: re-running against an unchanged file writes nothing.
    """
    desired_teams, desired_names = _desired_state(path)
    current_teams, current_names = _current_state(conn)
    now = _now_iso()
    changed = False

    for slug, team in desired_teams.items():
        existing = current_teams.get(slug)
        if existing is None:
            conn.execute(
                "INSERT INTO teams(slug, display_name, logo_key, created_at, updated_at) "
                "VALUES(?, ?, ?, ?, ?)",
                (slug, team["display_name"], team["logo_key"], now, now),
            )
            changed = True
        elif (
            existing["display_name"] != team["display_name"]
            or existing["logo_key"] != team["logo_key"]
        ):
            conn.execute(
                "UPDATE teams SET display_name = ?, logo_key = ?, updated_at = ? WHERE slug = ?",
                (team["display_name"], team["logo_key"], now, slug),
            )
            changed = True

    team_ids = {slug: team_id for team_id, slug in conn.execute("SELECT team_id, slug FROM teams")}

    for name_key, name in desired_names.items():
        team_id = team_ids[name["slug"]]
        existing = current_names.get(name_key)
        if existing is None:
            conn.execute(
                "INSERT INTO team_names(name_key, team_id, display_name, valid_from_week, "
                "valid_to_week, logo_key, source, created_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    name_key,
                    team_id,
                    name["display_name"],
                    name["valid_from_week"],
                    name["valid_to_week"],
                    name["logo_key"],
                    SEED_SOURCE,
                    now,
                ),
            )
            changed = True
        elif existing["source"] != SEED_SOURCE:
            # An admin claimed this spelling; the file must not move it.
            if existing["slug"] != name["slug"]:
                log.warning(
                    "team identity: keeping %r under %r (owned by %s, file says %r)",
                    name["display_name"],
                    existing["slug"],
                    existing["source"],
                    name["slug"],
                )
        elif any(
            existing[field] != name[field]
            for field in (
                "slug",
                "display_name",
                "valid_from_week",
                "valid_to_week",
                "logo_key",
            )
        ):
            conn.execute(
                "UPDATE team_names SET team_id = ?, display_name = ?, valid_from_week = ?, "
                "valid_to_week = ?, logo_key = ? WHERE name_key = ?",
                (
                    team_id,
                    name["display_name"],
                    name["valid_from_week"],
                    name["valid_to_week"],
                    name["logo_key"],
                    name_key,
                ),
            )
            changed = True

    stale = [
        name_key
        for name_key, row in current_names.items()
        if row["source"] == SEED_SOURCE and name_key not in desired_names
    ]
    if stale:
        conn.executemany("DELETE FROM team_names WHERE name_key = ?", [(key,) for key in stale])
        changed = True

    orphaned = conn.execute(
        "DELETE FROM teams WHERE team_id NOT IN (SELECT DISTINCT team_id FROM team_names)"
    ).rowcount
    if orphaned:
        changed = True

    conn.commit()
    return changed


def invalidate_team_caches() -> None:
    """Drop cached team payloads after identities change (no-op outside an app)."""
    try:
        from flask import has_app_context

        from .cache import cache

        if has_app_context():
            cache.invalidate_data()
    except Exception:  # pragma: no cover - cache is optional for CLI callers
        log.exception("team identity: cache invalidation failed")
