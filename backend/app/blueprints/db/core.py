from __future__ import annotations

"""Shared blueprint, helpers, and constants for the /db API."""

import json
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote
import requests
from flask import Blueprint, current_app, request
from dotenv import load_dotenv

from ...cache import cache
from ...heroes import get_hero_name
from ...utils import brackets as bk
from ...utils.item_icons import icon_key, item_icon_index, resolve_icon, shop_item_name
from ....constants import HEROES_URL, ITEMS_URL


load_dotenv()


bp = Blueprint("dlns_db_api", __name__, url_prefix="/db")


def _rows_to_dicts(cur: sqlite3.Cursor) -> List[Dict[str, Any]]:
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


_BROWSER_TTL_DEFAULT = 60


_BROWSER_TTL_SHORT = 15


_BROWSER_TTL_LONG = 300


_SHORT_TTL_SUFFIXES = ("/bans", "/stream/status")


_LONG_TTL_PREFIXES = ("/db/heroes", "/db/items/names", "/db/weeks", "/db/nightshift/index")


@bp.after_request
def _browser_cache_headers(response):
    """Let browsers reuse and revalidate read-only /db answers.

    The server cache already makes these cheap, but without headers the browser
    re-downloads the full body on every navigation. A short max-age gives instant
    repeat views, stale-while-revalidate hides the refresh, and the ETag turns
    revalidation into a tiny 304.
    """
    if (
        request.method != "GET"
        or response.status_code != 200
        or "Cache-Control" in response.headers
        or response.direct_passthrough
        or not (response.mimetype or "").endswith("json")
    ):
        return response

    path = request.path
    if path.endswith(_SHORT_TTL_SUFFIXES):
        ttl = _BROWSER_TTL_SHORT
    elif path.startswith(_LONG_TTL_PREFIXES) and "/heroes/" not in path:
        ttl = _BROWSER_TTL_LONG
    else:
        ttl = _BROWSER_TTL_DEFAULT

    response.headers["Cache-Control"] = f"public, max-age={ttl}, stale-while-revalidate={ttl * 5}"
    response.add_etag()
    return response.make_conditional(request)


def get_ro_conn() -> sqlite3.Connection:
    db_path = Path(current_app.config.get("DB_PATH", "./data/dlns.sqlite3")).resolve()
    # No shared-cache mode: it serialises readers on table locks, which is the opposite
    # of what a threaded server wants. WAL already lets readers run in parallel.
    uri = f"file:{db_path.as_posix()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True, timeout=15)
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
    conn.execute("PRAGMA cache_size=-32768;")
    conn.execute("PRAGMA mmap_size=268435456;")
    conn.execute("PRAGMA temp_store=MEMORY;")
    return conn


def format_player_data(player_row):
    """Convert player row to dict with hero name included."""
    player = dict(player_row)
    if 'hero_id' in player:
        player['hero_name'] = get_hero_name(player['hero_id'])
    return player


def _matches_json_path() -> Path:
    db_path = Path(current_app.config.get("DB_PATH", "./data/dlns.sqlite3")).resolve()
    candidates = [
        db_path.parent / "matches.json",
        Path(current_app.root_path).parent / "matches.json",
        Path(current_app.root_path).parent / "data" / "matches.json",
        Path("./data/matches.json").resolve(),
        Path("matches.json").resolve(),
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return candidates[0]


def _site_banner_path() -> Path:
    configured = current_app.config.get("SITE_BANNER_PATH")
    if configured:
        return Path(str(configured)).resolve()
    project_root = Path(current_app.root_path).parent.parent
    return project_root / "data" / "site_banner.json"


def _default_site_banner() -> dict[str, Any]:
    return {
        "enabled": True,
        "badge": "Help wanted",
        "title": "Want to help the project?",
        "message": "We are looking for people who can help improve DLNS Stats with data cleanup, UI polish, and documentation.",
        "details": [
            "Match data cleanup and validation",
            "UI, accessibility, and layout polish",
            "Documentation, bug fixes, and feature ideas",
        ],
        "cta": {
            "label": "Read the help page",
            "url": "/help",
        },
    }


def _normalize_site_banner(raw: Any) -> dict[str, Any]:
    default = _default_site_banner()
    if not isinstance(raw, dict):
        return default

    details = raw.get("details")
    if not isinstance(details, list):
        details = default["details"]

    cta = raw.get("cta")
    if not isinstance(cta, dict):
        cta = default["cta"]

    return {
        "enabled": bool(raw.get("enabled", default["enabled"])),
        "badge": str(raw.get("badge") or default["badge"]).strip(),
        "title": str(raw.get("title") or default["title"]).strip(),
        "message": str(raw.get("message") or default["message"]).strip(),
        "details": [str(item).strip() for item in details if str(item).strip()],
        "cta": {
            "label": str(cta.get("label") or default["cta"]["label"]).strip(),
            "url": str(cta.get("url") or default["cta"]["url"]).strip(),
        },
    }


def _load_site_banner() -> dict[str, Any]:
    path = _site_banner_path()
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            raw = json.load(f)
    except FileNotFoundError:
        return _default_site_banner()
    except Exception:
        return _default_site_banner()
    return _normalize_site_banner(raw)


def _write_site_banner(payload: dict[str, Any]) -> dict[str, Any]:
    path = _site_banner_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp_path.replace(path)
    return payload


def _replay_share_api_url() -> str:
    value = str(current_app.config.get("REPLAY_SHARE_API_URL") or "").strip().rstrip("/")
    if not value:
        raise ValueError("REPLAY_SHARE_API_URL is not configured")
    return value


def _replay_download_base_url() -> str:
    value = str(current_app.config.get("REPLAY_DOWNLOAD_BASE_URL") or "").strip().rstrip("/")
    if not value:
        raise ValueError("REPLAY_DOWNLOAD_BASE_URL is not configured")
    return value


def _replay_share_ui_base_url() -> str:
    """Filebrowser web-UI root for the public share (e.g. .../share/<hash>)."""
    api_url = _replay_share_api_url()
    if "/api/public/share/" in api_url:
        return api_url.replace("/api/public/share/", "/share/", 1)
    # Fallback: guess the UI root from the download base URL.
    dl = _replay_download_base_url()
    return dl.replace("/api/public/dl/", "/share/", 1)


def _build_replay_share_url(item_path: str) -> str:
    """Web-UI link to the folder containing the replay (opens Filebrowser, not a download)."""
    folder = item_path.rstrip("/").rsplit("/", 1)[0]
    encoded = quote(folder.lstrip("/"), safe="/")
    return f"{_replay_share_ui_base_url().rstrip('/')}/{encoded}/"


# Serializes writes to the index file (background refresh vs. per-match append).
_replay_index_write_lock = threading.Lock()


def _crawl_share_replays(
    share_api_url: str, max_dirs: int = 20000, workers: int = 16
) -> dict[int, Dict[str, Any]]:
    """Crawl the whole share and return {match_id: replay_item} for every <id>.zip."""
    found: Dict[int, Dict[str, Any]] = {}
    seen_dirs: set[str] = set()
    frontier: list[str] = [""]

    def listing(path: str | None) -> list[Dict[str, Any]] | None:
        url = share_api_url.rstrip("/")
        if path:
            url = f"{url}/{quote(str(path).lstrip('/'), safe='/')}"
        try:
            resp = requests.get(url, timeout=10)
            resp.raise_for_status()
            items = resp.json().get("items")
            if isinstance(items, list):
                return [it for it in items if isinstance(it, dict)]
            return []
        except Exception:
            return None

    while frontier and len(seen_dirs) < max_dirs:
        batch = [p for p in frontier if p not in seen_dirs]
        if not batch:
            break
        seen_dirs.update(batch)
        frontier = []

        if len(batch) > 1 and workers > 1:
            with ThreadPoolExecutor(max_workers=workers) as ex:
                listings = list(ex.map(lambda p: listing(p or None), batch))
        else:
            listings = [listing(p or None) for p in batch]

        for path, items in zip(batch, listings):
            if not items:
                continue
            for it in items:
                name = str(it.get("name") or "")
                item_path = str(it.get("path") or "")
                if it.get("isDir"):
                    if item_path and item_path not in seen_dirs and len(seen_dirs) < max_dirs:
                        frontier.append(item_path)
                    continue
                if not name.lower().endswith(".zip"):
                    continue
                m = re.match(r"^(\d+)", name)
                if not m:
                    continue
                found[int(m.group(1))] = {
                    "name": name,
                    "path": item_path,
                    "size": it.get("size"),
                    "modified": it.get("modified"),
                }
    return found


def _replay_index_path() -> Path:
    configured = current_app.config.get("REPLAY_INDEX_FILE_CACHE_PATH")
    if configured:
        return Path(str(configured)).resolve()
    project_root = Path(current_app.root_path).parent.parent
    return project_root / "_cache" / "replay_index.json"


def _build_replay_index_sync(share_api_url: str, index_path: str, max_dirs: int = 20000) -> int:
    """Blocking full index build; runs outside any request/app context."""
    replays = _crawl_share_replays(share_api_url, max_dirs=max_dirs)
    if not replays:
        # A failed/empty crawl (share unreachable or no uploads yet) must never
        # clobber a good index or mark a fresh-but-empty one. Keep what exists.
        path = Path(index_path)
        if path.exists():
            try:
                existing = json.loads(path.read_text(encoding="utf-8"))
                return int(existing.get("count") or 0)
            except Exception:
                pass
        return 0
    payload = {
        "version": 2,
        "built_at": int(time.time()),
        "count": len(replays),
        "replays": {str(mid): item for mid, item in replays.items()},
    }
    path = Path(index_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with _replay_index_write_lock:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        tmp_path.replace(path)
    return len(replays)


def rebuild_replay_index() -> int:
    """Build/refresh the full replay index now (blocking). Returns replay count."""
    return _build_replay_index_sync(_replay_share_api_url(), str(_replay_index_path()))


# Items above this shop tier cost 3200+ souls. The assets API exposes tiers
# rather than soul costs, and tier 3 is the 3200 tier.
MIN_SIGNATURE_ITEM_TIER = 3


# ── Player × Hero ───────────────────────────────────────────────────────
# Ability point orders. A game spends 16 points: one unlock per ability plus its
# 1/2/5 AP upgrades, so the build grid is always 16 steps wide.
ABILITY_SLOTS = ("signature1", "signature2", "signature3", "signature4")


ABILITY_GRID_STEPS = 16


MAX_ABILITY_TIER = 3  # tier 3 is the 5 AP upgrade, the one the "max order" tracks


ABILITY_BUILD_LIMIT = 3  # the panel shows the three most common orders


_CATALOG_LAST_GOOD_TTL = 7 * 24 * 3600
_CATALOG_FAILURE_TTL = 30
_catalog_refreshing: set[str] = set()
_catalog_refresh_lock = threading.Lock()


def uncacheable(resp):
    """Mark a response so the route cache does not keep it (e.g. a transient failure)."""
    resp.headers["X-No-Cache"] = "1"
    return resp


def _download_catalog(url: str, label: str) -> Optional[List[Any]]:
    try:
        resp = requests.get(url, params={"language": "english"}, timeout=5)
        resp.raise_for_status()
        data = resp.json()
    except Exception as exc:  # requests raises several types
        current_app.logger.warning("%s catalog unavailable: %s", label, exc)
        return None
    return data if isinstance(data, list) and data else None


def _store_catalog(key: str, data: List[Any], ttl: int) -> None:
    cache.set(key, data, timeout=ttl)
    cache.set(f"{key}:last_good", data, timeout=_CATALOG_LAST_GOOD_TTL)
    cache.delete(f"{key}:failed")


def _refresh_catalog_async(key: str, url: str, label: str, ttl: int) -> None:
    with _catalog_refresh_lock:
        if key in _catalog_refreshing:
            return
        _catalog_refreshing.add(key)
    app = current_app._get_current_object()  # type: ignore[attr-defined]

    def work() -> None:
        try:
            with app.app_context():
                data = _download_catalog(url, label)
                if data:
                    _store_catalog(key, data, ttl)
                else:
                    cache.set(f"{key}:failed", 1, timeout=_CATALOG_FAILURE_TTL)
        finally:
            with _catalog_refresh_lock:
                _catalog_refreshing.discard(key)

    threading.Thread(target=work, name=f"refresh-{key}", daemon=True).start()


def _shared_catalog(key: str, url: str, label: str, ttl: int) -> List[Any]:
    """An upstream catalogue that visitors never wait on twice.

    Fresh copy -> returned. Expired but a last-good copy exists -> that copy is returned
    at once while a background thread refreshes it. Nothing at all (first ever load)
    -> one blocking fetch. A failed fetch is remembered briefly so an upstream outage
    costs one timeout per half minute instead of one per request.
    """
    cached = cache.get(key)
    if cached is not None:
        return cached
    failed = cache.get(f"{key}:failed")
    last_good = cache.get(f"{key}:last_good")
    if last_good is not None:
        if not failed:
            _refresh_catalog_async(key, url, label, ttl)
        return last_good
    if failed:
        return []
    data = _download_catalog(url, label)
    if data:
        _store_catalog(key, data, ttl)
        return data
    cache.set(f"{key}:failed", 1, timeout=_CATALOG_FAILURE_TTL)
    return []


def _item_catalog() -> Dict[int, Dict[str, Any]]:
    """Shop item id -> {name, slot, tier, type, image, icon} (cached)."""
    cached = cache.get("dlns_item_catalog")
    if cached is not None:
        return cached

    raw_catalog = _items_raw()

    icons = item_icon_index()
    catalog: Dict[int, Dict[str, Any]] = {}
    for item in raw_catalog if isinstance(raw_catalog, list) else []:
        item_id = item.get("id")
        if item_id is None:
            continue
        # Internal variants (e.g. upgrade_clip_size_fixed_t3) carry no display
        # name and are never real purchases, so keep them out of the catalog.
        name = shop_item_name(item)
        if name is None:
            continue

        shipped = resolve_icon(item, icons)
        catalog[int(item_id)] = {
            "name": name,
            "slot": item.get("item_slot_type") or "",
            "tier": item.get("item_tier"),
            "type": item.get("type") or "",
            "icon": f"items/{shipped}" if shipped else None,
            # The upstream art, for the items whose file was never cut; the client
            # shows it when `icon` is missing or 404s.
            "image": item.get("image") or None,
        }

    if catalog:
        cache.set("dlns_item_catalog", catalog, timeout=21600)
    return catalog


def _item_class_names() -> Dict[str, str]:
    """Item `class_name` -> display name, for labelling damage sources (cached).

    The same catalog the /items/names endpoint serves; kept in one helper so the
    damage panel and the match tooltips can never disagree about an item's name.
    """
    cached = cache.get("dlns_item_class_names")
    if cached is not None:
        return cached

    names: Dict[str, str] = {}
    for item in _items_raw():
        if not isinstance(item, dict):
            continue
        class_name = item.get("class_name")
        name = item.get("name")
        # Internal variants repeat their class name and are never real purchases.
        if isinstance(class_name, str) and isinstance(name, str) and name and name != class_name:
            names[class_name] = name

    if names:
        cache.set("dlns_item_class_names", names, timeout=21600)
    return names


def _items_raw() -> List[Any]:
    """The upstream item + ability catalogue, verbatim (stale-while-revalidate)."""
    return _shared_catalog("dlns_items_list", ITEMS_URL, "Item", 1800)


def _heroes_raw() -> List[Any]:
    """The upstream hero catalogue, verbatim (stale-while-revalidate).

    Carries the `signature1..4` item slots, which is the only place that maps a
    hero to its four levelable abilities in a stable order.
    """
    return _shared_catalog("dlns_heroes_list", HEROES_URL, "Hero", 1800)


def _ability_icon_index() -> Dict[str, str]:
    """'<key>' -> shipped ability icon path under public/images/abilities."""
    cached = cache.get("dlns_ability_icon_index")
    if cached is not None:
        return cached

    index: Dict[str, str] = {}
    # current_app.root_path is backend/app, so parents[1] is the project root.
    root = Path(current_app.root_path).resolve().parents[1] / "public" / "images" / "abilities"
    try:
        for path in sorted(root.rglob("*.png")):
            rel = path.relative_to(root).as_posix()
            stem = rel.rsplit("/", 1)[-1][:-4]
            if stem.endswith("_psd"):
                stem = stem[:-4]
            key = icon_key(stem)
            if key:
                index.setdefault(key, rel)
    except OSError:
        current_app.logger.warning("Ability icon folder unreadable: %s", root)

    if index:
        cache.set("dlns_ability_icon_index", index, timeout=21600)
    return index


def _hero_ability_slots() -> Dict[int, Dict[str, Any]]:
    """hero_id -> its four levelable abilities, in upstream slot order.

    The abilities in the items catalogue do not carry a hero, and
    `data/hero_meta.json` has names plus shipped image paths but no ids, so the
    slots are read from the HERO catalogue's `signature1..4` class names and
    resolved through the items catalogue — the only place holding both the class
    name and the ability id the match data stores.
    """
    cached = cache.get("dlns_hero_ability_slots")
    if cached is not None:
        return cached

    by_class: Dict[str, Dict[str, Any]] = {}
    for item in _items_raw():
        class_name = item.get("class_name") if isinstance(item, dict) else None
        if isinstance(class_name, str) and item.get("id") is not None:
            by_class[class_name] = item

    icons = _ability_icon_index()
    slots: Dict[int, Dict[str, Any]] = {}
    for hero in _heroes_raw():
        if not isinstance(hero, dict) or hero.get("id") is None:
            continue
        hero_items = hero.get("items") or {}
        abilities: List[Dict[str, Any]] = []
        by_id: Dict[int, int] = {}
        for slot, key in enumerate(ABILITY_SLOTS, start=1):
            class_name = hero_items.get(key)
            entry = by_class.get(class_name or "")
            if not entry:
                continue
            name = entry.get("name") or class_name
            icon = icons.get(icon_key(entry.get("class_name") or name))
            abilities.append(
                {
                    "slot": slot,
                    "ability_id": int(entry["id"]),
                    "name": name,
                    "icon": f"abilities/{icon}" if icon else None,
                }
            )
            by_id[int(entry["id"])] = slot
        if abilities:
            slots[int(hero["id"])] = {"abilities": abilities, "slots": by_id}

    if slots:
        cache.set("dlns_hero_ability_slots", slots, timeout=21600)
    return slots


def _match_won(side: Any, winner: Any, result: Any) -> Optional[bool]:
    """The SQL-side twin of the UI's `matchOutcome`: True/False/<none>.

    The stored result is only trusted when the sides are unknown, exactly like the
    frontend, so a cross-player baseline can never disagree with the page above it.
    """
    if side in (0, 1) and winner in (0, 1):
        return side == winner
    if result == "Win":
        return True
    if result == "Loss":
        return False
    return None


def _ability_builds(rows: List[Any], slots: Dict[str, Any], games: int) -> Dict[str, Any]:
    """The ability point orders for one player on one hero, as up to three builds.

    `players.ability_order` is polluted: the ingest calls an entry an ability when
    its id repeats or it carries an `upgrade_id`, so ordinary tier-2/3 ITEM
    purchases are stored in there too. Filtering to the hero's own ability ids is
    what makes the sequence readable. `tier` is the index of that ability's own
    purchase events (0 = unlock, then the 1/2/5 AP upgrades).

    Builds are grouped by the ORDER THE FOUR ABILITIES ARE UNLOCKED. Comparing the
    full 16-step sequence instead would be useless — measured on a 20-game player
    it produced 18 distinct builds, one per game, because the later upgrades are
    near-arbitrary — while the unlock order clusters properly (6 distinct, the top
    three covering 45/20/15% of games). The grid shows each group's most common
    full order, and every line states the group's real size, so nothing implies a
    consistency the data does not have.
    """
    ability_slots: Dict[int, int] = slots.get("slots") or {}
    groups: Dict[tuple, Dict[str, Any]] = {}

    for row in rows:
        raw = row[8]
        if not raw:
            continue
        try:
            events = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if not isinstance(events, list):
            continue

        # (slot, tier) -> the time it happened. A repeated entry keeps the earliest.
        steps: Dict[tuple, float] = {}
        for event in events:
            if not isinstance(event, dict):
                continue
            slot = ability_slots.get(event.get("ability_id"))
            if slot is None:
                continue
            key = (slot, int(event.get("tier") or 0))
            time = event.get("game_time_s")
            time = float(time) if time is not None else float("inf")
            if key not in steps or time < steps[key]:
                steps[key] = time
        if not steps:
            continue

        ordered = sorted(steps.items(), key=lambda kv: (kv[1], kv[0][0], kv[0][1]))
        sequence = tuple(step for step, _ in ordered)[:ABILITY_GRID_STEPS]
        unlock_order = tuple(step[0] for step in sequence if step[1] == 0)
        if not unlock_order:
            continue
        won = _match_won(row[1], row[10], row[2])

        group = groups.setdefault(
            unlock_order,
            {
                "unlock_order": list(unlock_order),
                "games": 0,
                "wins": 0,
                "losses": 0,
                "match_id": row[0],
                "sequences": {},
                "max_orders": {},
            },
        )
        group["games"] += 1
        if won is True:
            group["wins"] += 1
        elif won is False:
            group["losses"] += 1
        # `mine` is ordered oldest first, so the last write is the newest game.
        group["match_id"] = row[0]
        group["sequences"][sequence] = group["sequences"].get(sequence, 0) + 1
        final = tuple(step[0] for step, _ in ordered if step[1] == MAX_ABILITY_TIER)
        if final:
            group["max_orders"][final] = group["max_orders"].get(final, 0) + 1

    def most_common(counter: Dict[Any, int], fallback: Any = ()) -> Any:
        if not counter:
            return fallback
        return max(counter.items(), key=lambda kv: (kv[1], kv[0]))[0]

    by_slot = {ability["slot"]: ability["name"] for ability in slots.get("abilities") or []}
    names = lambda order: [by_slot.get(slot, f"Ability {slot}") for slot in order]

    ordered_groups = sorted(
        groups.values(), key=lambda group: (-group["games"], -group["wins"], -group["match_id"])
    )
    builds = []
    for group in ordered_groups[:ABILITY_BUILD_LIMIT]:
        decided = group["wins"] + group["losses"]
        builds.append(
            {
                "steps": [list(step) for step in most_common(group["sequences"])],
                "unlock_order": names(group["unlock_order"]),
                "games": group["games"],
                "wins": group["wins"],
                "losses": group["losses"],
                "win_rate": group["wins"] / decided if decided else None,
                "share": group["games"] / games if games else None,
                "match_id": group["match_id"],
                "max_order": names(most_common(group["max_orders"])),
            }
        )

    return {
        "abilities": slots.get("abilities") or [],
        "games": games,
        "other_games": max(0, games - sum(build["games"] for build in builds)),
        "builds": builds,
    }


def _brackets_file_path() -> Path:
    """`data/brackets.json` sits beside the database, as the bracket blueprint expects."""
    db_path = Path(current_app.config.get("DB_PATH", "./data/dlns.sqlite3")).resolve()
    return db_path.parent / "brackets.json"


def _load_brackets_events() -> List[Dict[str, Any]]:
    try:
        with _brackets_file_path().open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except (OSError, ValueError):
        return []
    events = data.get("events") if isinstance(data, dict) else None
    return events if isinstance(events, list) else []


def _schedule_data() -> Dict[str, Any]:
    """Title -> week -> set -> game layout used by the stats pages.

    Built from `data/brackets.json`. Legacy `matches.json` entries are kept for
    games the brackets do not cover, so older weeks still resolve.
    """
    data = bk.to_schedule(_load_brackets_events())
    seen: set = set()
    for series in data["series"]:
        for week in series["weeks"]:
            for game in week["games"]:
                for m in game["matches"]:
                    seen.add(m["match_id"])
    try:
        with open(_matches_json_path(), encoding="utf-8-sig") as handle:
            legacy = json.load(handle)
    except Exception:
        return data
    for series in (legacy.get("series") or []) if isinstance(legacy, dict) else []:
        if not isinstance(series, dict):
            continue
        weeks = []
        for week in series.get("weeks") or []:
            games = []
            for game in week.get("games") or []:
                matches = [m for m in game.get("matches") or []
                           if not (isinstance(m, dict) and m.get("match_id") in seen)]
                if matches:
                    games.append(dict(game, matches=matches))
            if games:
                weeks.append(dict(week, games=games))
        if not weeks:
            continue
        target = next((s for s in data["series"] if s["title"] == (series.get("title") or "").strip()), None)
        if target is None:
            data["series"].append({"title": (series.get("title") or "").strip(), "weeks": weeks})
            continue
        for week in weeks:
            tw = next((w for w in target["weeks"] if w.get("week") == week.get("week")), None)
            if tw is None:
                target["weeks"].append(week)
            else:
                tw["games"].extend(week["games"])
                for k in ("vod_link", "vod_links"):
                    if week.get(k) and not tw.get(k):
                        tw[k] = week[k]
    return data
