from __future__ import annotations

import json
import os
import re
import sqlite3
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote

import requests

from flask import Blueprint, current_app, jsonify, request
from ..cache import cache
from dotenv import load_dotenv
from ..heroes import get_hero_name
from ..utils import brackets as bk
from ..utils.auth import require_admin
from ..help_config import load_help_config, save_help_config
from ...constants import HEROES_URL, ITEMS_URL

load_dotenv()
bp = Blueprint("dlns_db_api", __name__, url_prefix="/db")
_replay_file_cache_lock = threading.Lock()

# DLNS's 3-lane map, in scoreboard order: York, Greenwich, Broadway. Mirrors
# LANE_ORDER in MatchDetail.jsx so hero lineups read identically in both places.
LANE_ORDER = (1, 4, 6)


def _rows_to_dicts(cur: sqlite3.Cursor) -> List[Dict[str, Any]]:
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def get_ro_conn() -> sqlite3.Connection:
    db_path = Path(current_app.config.get("DB_PATH", "./data/dlns.sqlite3")).resolve()
    uri = f"file:{db_path.as_posix()}?mode=ro&cache=shared"
    conn = sqlite3.connect(uri, uri=True, timeout=15)
    conn.execute("PRAGMA foreign_keys=ON;")
    conn.execute("PRAGMA busy_timeout=5000;")
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


def _fetch_replay_listing(path: str | None = None) -> list[dict[str, Any]]:
    url = _replay_share_api_url()
    if path:
        # Filebrowser's public share API navigates by appending the folder path
        # to the share URL. (A ?path= query param is ignored by the server, which
        # would make the recursive scan never descend past the share root.)
        url = f"{url.rstrip('/')}/{quote(str(path).lstrip('/'), safe='/')}"
    resp = requests.get(url, timeout=10)
    resp.raise_for_status()
    payload = resp.json()
    items = payload.get("items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []


def _build_replay_download_url(item_path: str) -> str:
    encoded_path = quote(item_path.lstrip("/"), safe="/")
    return f"{_replay_download_base_url()}/{encoded_path}"


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


def _replay_cache_key(match_id: int) -> str:
    return f"replay_url:{match_id}"


def _request_arg_true(name: str) -> bool:
    return (request.args.get(name) or "").strip().lower() in {"1", "true", "yes", "on"}


def _replay_open_url(replay: dict[str, Any] | None) -> str | None:
    if not isinstance(replay, dict):
        return None
    return str(replay.get("download_url") or replay.get("share_url") or "") or None


def _replay_cache_ttl_seconds() -> int:
    # 48 hours default TTL for replay URL lookups.
    return int(current_app.config.get("REPLAY_URL_CACHE_TTL_SECONDS", 48 * 60 * 60))


def _replay_file_cache_path() -> Path:
    configured = current_app.config.get("REPLAY_URL_FILE_CACHE_PATH")
    if configured:
        return Path(str(configured)).resolve()
    project_root = Path(current_app.root_path).parent.parent
    return project_root / "_cache" / "replay_urls.json"


def _load_replay_file_cache() -> dict[str, Any]:
    path = _replay_file_cache_path()
    if not path.exists():
        return {"version": 2, "matches": {}}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            matches = raw.get("matches")
            if isinstance(matches, dict):
                return {"version": 2, "matches": matches}
            entries = raw.get("entries")
            if isinstance(entries, dict):
                migrated: dict[str, Any] = {}
                for key, entry in entries.items():
                    if not isinstance(entry, dict):
                        continue
                    replay = entry.get("replay")
                    if not isinstance(replay, dict):
                        continue
                    migrated[str(key)] = {
                        "cached_at": entry.get("cached_at"),
                        "expires_at": entry.get("expires_at"),
                        "found": True,
                        "replay": replay,
                        "searched_dirs": entry.get("searched_dirs", 0),
                    }
                return {"version": 2, "matches": migrated}
    except Exception:
        current_app.logger.warning("Replay URL file cache unreadable: %s", path)
    return {"version": 2, "matches": {}}


def _write_replay_file_cache(payload: dict[str, Any]) -> None:
    path = _replay_file_cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2, sort_keys=True)
    tmp_path.replace(path)


def _get_persisted_replay_lookup(match_id: int) -> dict[str, Any] | None:
    now = int(time.time())
    key = str(match_id)
    with _replay_file_cache_lock:
        cache_payload = _load_replay_file_cache()
        matches = cache_payload.get("matches") or {}
        entry = matches.get(key)
        if not isinstance(entry, dict):
            return None
        expires_at = int(entry.get("expires_at") or 0)
        found = bool(entry.get("found"))
        replay = entry.get("replay")
        if expires_at <= now or (found and not isinstance(replay, dict)):
            matches.pop(key, None)
            cache_payload["matches"] = matches
            _write_replay_file_cache(cache_payload)
            return None
        return {
            "found": found,
            "replay": replay if found else None,
            "searched_dirs": int(entry.get("searched_dirs") or 0),
        }


def _set_persisted_replay_lookup(
    match_id: int,
    *,
    found: bool,
    replay: dict[str, Any] | None,
    ttl_seconds: int,
    searched_dirs: int = 0,
) -> None:
    now = int(time.time())
    key = str(match_id)
    with _replay_file_cache_lock:
        cache_payload = _load_replay_file_cache()
        matches = cache_payload.get("matches") or {}
        matches[key] = {
            "cached_at": now,
            "expires_at": now + max(1, int(ttl_seconds)),
            "found": bool(found),
            "replay": replay if found else None,
            "searched_dirs": int(searched_dirs or 0),
        }
        cache_payload["matches"] = matches
        _write_replay_file_cache(cache_payload)


# ---------------------------------------------------------------------------
# Replay share index
# ---------------------------------------------------------------------------
# A full crawl of the Filebrowser share, mapping match_id -> replay file, stored
# as JSON so match lookups are instant instead of walking the share per request.
_replay_index_refresh_lock = threading.Lock()
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


def _replay_index_refresh_hours() -> float:
    raw = current_app.config.get("REPLAY_INDEX_REFRESH_HOURS")
    try:
        return float(raw or 6)
    except (TypeError, ValueError):
        return 6.0


def _load_replay_index() -> Dict[str, Any]:
    path = _replay_index_path()
    if not path.exists():
        return {"version": 2, "built_at": 0, "count": 0, "replays": {}}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict) and isinstance(raw.get("replays"), dict):
            return raw
    except Exception:
        pass
    return {"version": 2, "built_at": 0, "count": 0, "replays": {}}


def _save_replay_index(payload: Dict[str, Any]) -> None:
    path = _replay_index_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with _replay_index_write_lock:
        with tmp_path.open("w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
        tmp_path.replace(path)


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


def _schedule_index_refresh() -> bool:
    """Kick off a background full-index rebuild if the index is missing or stale."""
    if not _replay_index_refresh_lock.acquire(blocking=False):
        return False  # a rebuild is already running
    try:
        api_url = _replay_share_api_url()
        index_path = str(_replay_index_path())
        refresh_hours = _replay_index_refresh_hours()
    except Exception:
        _replay_index_refresh_lock.release()
        return False

    payload = _load_replay_index()
    age_hours = (time.time() - int(payload.get("built_at") or 0)) / 3600.0
    if payload.get("built_at") and age_hours < refresh_hours:
        _replay_index_refresh_lock.release()
        return False

    def worker() -> None:
        try:
            _build_replay_index_sync(api_url, index_path)
        except Exception:
            pass
        finally:
            _replay_index_refresh_lock.release()

    threading.Thread(target=worker, name="replay-index-refresh", daemon=True).start()
    return True


def _replay_match_item(match_id: int, max_dirs: int = 3000) -> tuple[dict[str, Any] | None, int]:
    """Return (matched_item, visited_dir_count).

    Looks up a prebuilt replay index first (instant, no network). If the match
    is absent, it still walks the live share so newly uploaded or previously
    missed replays can be found immediately, while also scheduling an index
    refresh when needed so later lookups stay fast.
    """
    payload = _load_replay_index()
    replays = payload.get("replays") or {}
    indexed = replays.get(str(match_id))
    if isinstance(indexed, dict):
        return indexed, 0

    try:
        _schedule_index_refresh()
    except Exception:
        pass

    target_prefix = f"{match_id}"
    visited_dirs = 0
    seen_dirs: set[str] = set()
    stack: list[str] = [""]

    while stack and visited_dirs < max_dirs:
        current_path = stack.pop()
        norm_path = (current_path or "").strip()
        if norm_path in seen_dirs:
            continue
        seen_dirs.add(norm_path)
        visited_dirs += 1

        try:
            items = _fetch_replay_listing(norm_path or None)
        except Exception:
            # Ignore unreadable directories and continue scan.
            continue

        # Prefer deterministic traversal order.
        dir_paths: list[str] = []
        for item in items:
            item_path = str(item.get("path") or "")
            name = str(item.get("name") or "")
            is_dir = bool(item.get("isDir"))

            if is_dir:
                if item_path:
                    dir_paths.append(item_path)
                continue

            lower_name = name.lower()
            if not lower_name.endswith(".zip"):
                continue
            if not name.startswith(target_prefix):
                continue

            # Remember it in the index so the next lookup is instant.
            try:
                entry = {
                    "name": name,
                    "path": item_path,
                    "size": item.get("size"),
                    "modified": item.get("modified"),
                }
                refreshed = _load_replay_index()
                refreshed.setdefault("replays", {})[str(match_id)] = entry
                refreshed["count"] = len(refreshed["replays"])
                _save_replay_index(refreshed)
            except Exception:
                pass
            return item, visited_dirs

        for next_dir in sorted(dir_paths, reverse=True):
            if next_dir not in seen_dirs:
                stack.append(next_dir)

    return None, visited_dirs


@bp.get("/matches/tree")
@cache.cached(timeout=1800)
def matches_tree():
    """Return the full matches.json payload without reshaping."""
    matches_file = _matches_json_path()
    try:
        # Accept UTF-8 files with or without BOM.
        with open(matches_file, encoding="utf-8-sig") as f:
            data = json.load(f)
    except FileNotFoundError:
        return jsonify({"error": "matches.json not found"}), 404
    except Exception as e:
        return jsonify({"error": f"Failed to load matches.json: {e}"}), 500
    return jsonify(data)


@bp.get("/weeks")
@cache.cached(timeout=3600, query_string=True)
def weeks_map():  # type: ignore
    event_title_filter = (request.args.get("event_title") or "").strip()
    event_title_filter_lc = event_title_filter.lower()
    matches_file = _matches_json_path()
    try:
        # Accept UTF-8 files with or without BOM.
        with open(matches_file, encoding="utf-8-sig") as f:
            data = json.load(f)
    except Exception:
        return jsonify({"weeks": {}, "title": ""})
    result: Dict[str, Any] = {}
    details: Dict[str, Any] = {}
    available_series_titles: List[str] = []

    week_sources: List[tuple[str, List[Any]]] = []
    root_series = data.get("series")
    if isinstance(root_series, list):
        for series_obj in root_series:
            if not isinstance(series_obj, dict):
                continue
            series_title = str(series_obj.get("title") or "").strip()
            if series_title:
                available_series_titles.append(series_title)
            entries = series_obj.get("weeks")
            if not isinstance(entries, list):
                entries = series_obj.get("events")
            if isinstance(entries, list):
                if event_title_filter_lc and series_title.lower() != event_title_filter_lc:
                    continue
                week_sources.append((series_title, entries))

    if not week_sources:
        entries = data.get("weeks")
        if not isinstance(entries, list):
            entries = data.get("events")
        if isinstance(entries, list):
            week_sources.append((str(data.get("title") or "").strip(), entries))

    for series_title, entries in week_sources:
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            week = entry.get("week")

            # Backward-compatible format: week.match_ids = [id, id]
            ids = entry.get("match_ids")
            if isinstance(ids, list):
                for mid in ids:
                    result[str(mid)] = week
                    key = str(mid)
                    if key not in details:
                        details[key] = {
                            "series": series_title or str(entry.get("title") or "").strip(),
                            "week": week,
                            "team_a": None,
                            "team_b": None,
                            "game": None,
                        }

            # New format: week.games = [{team_a, team_b, matches:[{game, match_id}]}]
            games = entry.get("games")
            if not isinstance(games, list):
                continue

            for series in games:
                if not isinstance(series, dict):
                    continue
                team_a = series.get("team_a") or series.get("team1")
                team_b = series.get("team_b") or series.get("team2")

                nested_matches = series.get("matches")
                if not isinstance(nested_matches, list):
                    nested_matches = series.get("games")

                if isinstance(nested_matches, list):
                    for idx, game in enumerate(nested_matches, start=1):
                        game_label = None
                        mid = None
                        if isinstance(game, dict):
                            game_label = game.get("game") or game.get("game_label") or game.get("label")
                            mid = game.get("match_id") if "match_id" in game else game.get("id")
                        else:
                            mid = game
                            game_label = f"Game {idx}"

                        try:
                            key = str(int(mid))
                        except Exception:
                            continue

                        result[key] = week
                        if key not in details:
                            details[key] = {
                                "series": series_title or str(entry.get("title") or "").strip(),
                                "week": week,
                                "team_a": team_a,
                                "team_b": team_b,
                                "game": game_label,
                                "series_title": (series.get("title") or "").strip(),
                                "match_vod": (game.get("match_vod") if isinstance(game, dict) else "") or series.get("match_vod") or "",
                            }
                    continue

                # Alternate compact format: one record with match_id + game
                try:
                    key = str(int(series.get("match_id")))
                except Exception:
                    continue

                result[key] = week
                if key not in details:
                    details[key] = {
                        "series": series_title or str(entry.get("title") or "").strip(),
                        "week": week,
                        "team_a": team_a,
                        "team_b": team_b,
                        "game": series.get("game") or series.get("game_label"),
                        "series_title": (series.get("title") or "").strip(),
                        "match_vod": series.get("match_vod") or "",
                    }

    if not event_title_filter_lc:
        for _, entries in week_sources:
            for entry in entries:
                if isinstance(entry, dict):
                    t = str(entry.get("title") or "").strip()
                    if t:
                        available_series_titles.append(t)

    seen_titles: set[str] = set()
    deduped_titles: List[str] = []
    for t in available_series_titles:
        key = t.lower()
        if not t or key in seen_titles:
            continue
        seen_titles.add(key)
        deduped_titles.append(t)

    return jsonify(
        {
            "weeks": result,
            "details": details,
            "title": event_title_filter or data.get("title", ""),
            "series_titles": deduped_titles,
            "selected_event_title": event_title_filter or None,
        }
    )


@bp.get("/help-config")
@require_admin
def help_config():
    """Return the modular help configuration for admins."""
    resp = jsonify(load_help_config())
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.route("/help-config", methods=["PUT", "POST"])
@require_admin
def update_help_config():
    """Update the modular help configuration."""
    raw = request.get_json(silent=True)
    if not isinstance(raw, dict):
        return jsonify({"ok": False, "error": "JSON body required"}), 400

    config = save_help_config(raw)
    resp = jsonify({"ok": True, "help_config": config})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/site-banner")
@require_admin
def site_banner_alias():
    """Deprecated banner alias kept for compatibility."""
    resp = jsonify({"banner": load_help_config().get("banner", {})})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/stats/overview")
@cache.cached(timeout=1800, query_string=True)
def stats_overview():
    """Return pre-aggregated stats. Optional ?event_title= to filter by event."""
    event_title = request.args.get("event_title")
    if event_title:
        sql = """
            SELECT
                COUNT(*) as total_matches,
                SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) as amber_wins,
                SUM(CASE WHEN winning_team = 1 THEN 1 ELSE 0 END) as sapphire_wins,
                ROUND(AVG(duration_s), 0) as avg_duration,
                MAX(duration_s) as max_duration,
                MIN(CASE WHEN duration_s > 0 THEN duration_s END) as min_duration
            FROM matches
            WHERE event_title = ?
              AND match_id > 0
        """
        params = (event_title,)
    else:
        sql = """
            SELECT
                COUNT(*) as total_matches,
                SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) as amber_wins,
                SUM(CASE WHEN winning_team = 1 THEN 1 ELSE 0 END) as sapphire_wins,
                ROUND(AVG(duration_s), 0) as avg_duration,
                MAX(duration_s) as max_duration,
                MIN(CASE WHEN duration_s > 0 THEN duration_s END) as min_duration
            FROM matches
            WHERE match_id > 0
        """
        params = ()
    with get_ro_conn() as conn:
        cur = conn.execute(sql, params)
        row = cur.fetchone()
        cols = [c[0] for c in cur.description]
        return jsonify({"overview": dict(zip(cols, row))})


@bp.get("/stats/weekly")
@cache.cached(timeout=1800, query_string=True)
def stats_weekly():
    """Return per-week aggregated stats for an event or combined across all events."""
    event_title = (request.args.get("event_title") or "").strip()
    with get_ro_conn() as conn:
        events_cur = conn.execute(
            """
            SELECT DISTINCT event_title
            FROM matches
            WHERE event_title IS NOT NULL AND TRIM(event_title) != '' AND event_week IS NOT NULL
            ORDER BY LOWER(event_title) ASC
            """
        )
        available_event_titles = [row[0] for row in events_cur.fetchall()]

        if event_title:
            sql = """
                SELECT
                    event_week,
                    COUNT(*) as total_matches,
                    SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) as amber_wins,
                    SUM(CASE WHEN winning_team = 1 THEN 1 ELSE 0 END) as sapphire_wins,
                    ROUND(AVG(duration_s) / 60.0, 2) as avg_duration_min,
                    ROUND(
                        100.0 * SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) / COUNT(*), 1
                    ) as amber_win_pct
                FROM matches
                WHERE event_title = ? AND event_week IS NOT NULL AND match_id > 0
                GROUP BY event_week
                ORDER BY event_week ASC
            """
            params = (event_title,)
        else:
            sql = """
                SELECT
                    event_week,
                    COUNT(*) as total_matches,
                    SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) as amber_wins,
                    SUM(CASE WHEN winning_team = 1 THEN 1 ELSE 0 END) as sapphire_wins,
                    ROUND(AVG(duration_s) / 60.0, 2) as avg_duration_min,
                    ROUND(
                        100.0 * SUM(CASE WHEN winning_team = 0 THEN 1 ELSE 0 END) / COUNT(*), 1
                    ) as amber_win_pct
                FROM matches
                WHERE event_week IS NOT NULL AND match_id > 0
                GROUP BY event_week
                ORDER BY event_week ASC
            """
            params = ()

        cur = conn.execute(sql, params)
        rows = _rows_to_dicts(cur)
    return jsonify({"weeks": rows, "event_title": event_title or None, "available_event_titles": available_event_titles})


@bp.get("/stats/records")
@cache.cached(timeout=1800, query_string=True)
def stats_records():
    """Return single-game player records with match context. ?event_title= to filter."""
    event_title = request.args.get("event_title")
    where = "WHERE m.event_title = ?" if event_title else ""
    params = (event_title,) if event_title else ()

    def best(order_col):
        sql = f"""
            SELECT
                p.{order_col} as value,
                u.persona_name,
                u.avatar_url,
                p.account_id,
                p.hero_id,
                p.match_id,
                m.duration_s,
                m.event_week
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            LEFT JOIN users u ON u.account_id = p.account_id
            {where}
            ORDER BY p.{order_col} DESC
            LIMIT 5
        """
        return sql

    records = {}
    stat_keys = [
        ("kills",          "kills"),
        ("assists",        "assists"),
        ("deaths",         "deaths"),
        ("obj_damage",     "obj_damage"),
        ("player_healing", "healing"),
        ("net_worth",      "souls"),
    ]
    with get_ro_conn() as conn:
        for col, key in stat_keys:
            cur = conn.execute(best(col), params)
            rows = cur.fetchall()
            if rows:
                cols = [c[0] for c in cur.description]
                records[key] = [dict(zip(cols, row)) for row in rows]

    return jsonify({"records": records})


@bp.get("/stats/averages")
@cache.cached(timeout=1800, query_string=True)
def stats_averages():
    """Return top players by average stat per game, min 5 games. ?event_title= to filter."""
    event_title = request.args.get("event_title")
    where = "WHERE m.event_title = ?" if event_title else ""
    hero_where = "WHERE m2.event_title = ?" if event_title else ""
    params = (event_title, event_title) if event_title else ()

    def best_avg(stat_col):
        return f"""
            SELECT
                ROUND(AVG(p.{stat_col}), 2) as value,
                u.persona_name,
                u.avatar_url,
                p.account_id,
                COUNT(*) as games_played,
                (SELECT p2.hero_id FROM players p2
                 JOIN matches m2 ON m2.match_id = p2.match_id
                 {hero_where}
                 AND p2.account_id = p.account_id
                 GROUP BY p2.hero_id
                 ORDER BY COUNT(*) DESC
                 LIMIT 1) as top_hero_id
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            LEFT JOIN users u ON u.account_id = p.account_id
            {where}
            GROUP BY p.account_id
            HAVING COUNT(*) >= 5
            ORDER BY AVG(p.{stat_col}) DESC
            LIMIT 5
        """

    averages = {}
    stat_keys = [
        ("kills",          "kills"),
        ("assists",        "assists"),
        ("deaths",         "deaths"),
        ("obj_damage",     "obj_damage"),
        ("player_healing", "healing"),
        ("net_worth",      "souls"),
    ]
    with get_ro_conn() as conn:
        for col, key in stat_keys:
            cur = conn.execute(best_avg(col), params)
            rows = cur.fetchall()
            if rows:
                cols = [c[0] for c in cur.description]
                averages[key] = [dict(zip(cols, row)) for row in rows]

    return jsonify({"averages": averages})


@bp.get("/stats/hero-selection")
@cache.cached(timeout=1800, query_string=True)
def stats_hero_selection():
    """Return hero pick rates and win rates, optionally filtered by event title."""
    event_title = request.args.get("event_title")
    conditions = ["p.hero_id IS NOT NULL"]
    params = []
    if event_title:
      conditions.append("m.event_title = ?")
      params.append(event_title)
    where = "WHERE " + " AND ".join(conditions)

    with get_ro_conn() as conn:
        cur = conn.execute(
            f"""
            SELECT
                p.hero_id,
                COUNT(*) as pick_count,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as win_count
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            {where}
            GROUP BY p.hero_id
            ORDER BY pick_count DESC, p.hero_id ASC
            """,
            tuple(params),
        )
        rows = cur.fetchall()
        if not rows:
            return jsonify({"heroes": []})

        cols = [c[0] for c in cur.description]
        total_picks = sum(row[1] or 0 for row in rows)
        heroes = []
        for row in rows:
            data = dict(zip(cols, row))
            pick_count = int(data.get("pick_count") or 0)
            win_count = int(data.get("win_count") or 0)
            heroes.append(
                {
                    "hero_id": data.get("hero_id"),
                    "pick_count": pick_count,
                    "win_rate": round(win_count / pick_count, 4) if pick_count else 0,
                    "pick_percentage": round(pick_count / total_picks, 4) if total_picks else 0,
                }
            )

    return jsonify({"heroes": heroes})


@bp.get("/matches/latest")
@cache.cached(timeout=300)
def latest_matches():  # type: ignore
    limit = int(current_app.config.get("API_LATEST_LIMIT", 50))
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, start_time, created_at "
            "FROM matches ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        data = _rows_to_dicts(cur)
        return jsonify({"matches": data})

@bp.get("/matches/latest/paged")
@cache.cached(timeout=180, query_string=True)
def latest_matches_paged():  # type: ignore
    try:
        page = max(1, int(request.args.get("page", 1)))
    except Exception:
        page = 1
    try:
        per_page = max(1, min(20, int(request.args.get("per_page", 20))))
    except Exception:
        per_page = 25
    order = (request.args.get("order") or "desc").lower()
    order = "asc" if order == "asc" else "desc"
    team = request.args.get("team") or ""
    gm = request.args.get("game_mode") or ""
    mm = request.args.get("match_mode") or ""
    hero_filter = request.args.get("hero") or ""
    player_filter = request.args.get("player") or ""
    event_title = (request.args.get("event_title") or "").strip()
    event_week_raw = (request.args.get("event_week") or "").strip()
    event_week: int | None = None
    if event_week_raw:
        try:
            event_week = int(event_week_raw)
        except Exception:
            event_week = None
    # Callers that do not read the embedded hero/player arrays can opt out; those
    # arrays are roughly 60% of the response size. Omitting the param keeps the
    # historical behaviour (players included).
    include_players = (request.args.get("include_players") or "1").strip().lower() not in (
        "0",
        "false",
        "no",
    )

    offset = (page - 1) * per_page
    params = []
    sql_base = "FROM matches m"
    joins = ""
    conds = ["m.match_id > 0", "m.duration_s IS NOT NULL"]
    if team in ("0", "1"):
        conds.append("m.winning_team = ?")
        params.append(int(team))
    if gm:
        conds.append("m.game_mode = ?")
        params.append(gm)
    if mm:
        conds.append("m.match_mode = ?")
        params.append(mm)
    if event_title:
        conds.append("m.event_title = ?")
        params.append(event_title)
    if event_week is not None:
        conds.append("m.event_week = ?")
        params.append(event_week)

    # Hero filter: resolve name to hero_ids, then JOIN players table
    if hero_filter:
        from ..heroes import get_all_hero_names
        hero_ids = []
        for hid, hname in get_all_hero_names().items():
            if hero_filter.lower() in hname.lower():
                hero_ids.append(int(hid))
        if hero_ids:
            placeholders = ",".join("?" * len(hero_ids))
            joins += f" JOIN players hp ON hp.match_id = m.match_id AND hp.hero_id IN ({placeholders})"
            params = list(hero_ids) + params
        else:
            # No matching hero — return empty
            return jsonify({
                "matches": [], "page": page, "per_page": per_page,
                "total": 0, "total_pages": 0
            })

    # Player filter: JOIN users table
    if player_filter:
        joins += " JOIN players pp ON pp.match_id = m.match_id JOIN users pu ON pu.account_id = pp.account_id AND pu.persona_name LIKE ?"
        params.append(f"%{player_filter}%")

    where = (" WHERE " + " AND ".join(conds)) if conds else ""
    use_distinct = bool(hero_filter or player_filter)
    count_expr = "COUNT(DISTINCT m.match_id)" if use_distinct else "COUNT(*)"
    select_distinct = "DISTINCT " if use_distinct else ""

    with get_ro_conn() as conn:
        # total count for this filter
        ccur = conn.execute(f"SELECT {count_expr} {sql_base}{joins}{where}", tuple(params))
        total = ccur.fetchone()[0]
        cur = conn.execute(
            f"SELECT {select_distinct}m.match_id, m.duration_s, m.winning_team, m.match_outcome, m.game_mode, m.match_mode, m.event_title, m.event_week, m.event_team_a, m.event_team_b, m.event_game, m.event_team_a_ingame_side, m.start_time, m.created_at {sql_base}{joins}{where} "
            f"ORDER BY COALESCE(m.start_time, m.created_at) {'ASC' if order == 'asc' else 'DESC'} LIMIT ? OFFSET ?",
            tuple(params + [per_page, offset])
        )
        matches = _rows_to_dicts(cur)

        # Fetch players for each match to include hero data
        match_ids = [m["match_id"] for m in matches] if include_players else []
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            pcur = conn.execute(
                f"SELECT p.match_id, p.team, p.hero_id, u.persona_name, u.avatar_url, p.account_id "
                f"FROM players p LEFT JOIN users u ON u.account_id = p.account_id "
                f"WHERE p.match_id IN ({placeholders}) ORDER BY p.team, p.player_slot",
                tuple(match_ids)
            )
            from ..heroes import get_all_hero_names

            hero_name_map = get_all_hero_names()
            players_by_match = {}
            for row in _rows_to_dicts(pcur):
                mid = row["match_id"]
                if mid not in players_by_match:
                    players_by_match[mid] = []
                if row.get("hero_id"):
                    row["hero_name"] = hero_name_map.get(str(row["hero_id"]), f"Hero {row['hero_id']}")
                players_by_match[mid].append(row)
            for m in matches:
                m["players"] = players_by_match.get(m["match_id"], [])

        return jsonify({
            "matches": matches,
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": (total + per_page - 1) // per_page
        })


@bp.get("/matches/<int:match_id>/bans")
@cache.cached(timeout=30)  # short, so bans saved in the bracket editor show up quickly
def match_bans(match_id: int):  # type: ignore
    """Hero bans for one game, in ban order, with the in-game side of the team that banned.

    Bans are stored per event team (team_a / team_b); ``side`` maps that to the match's
    sides (0 = Amber, 1 = Sapphire) via event_team_a_ingame_side.
    """
    with get_ro_conn() as conn:
        try:
            rows = conn.execute(
                "SELECT b.ban_order, b.team, b.team_name, b.hero_id, m.event_team_a_ingame_side "
                "FROM match_bans b JOIN matches m ON m.match_id = b.match_id "
                "WHERE b.match_id = ? ORDER BY b.ban_order",
                (match_id,),
            ).fetchall()
        except sqlite3.OperationalError:
            rows = []  # DB from before match_bans existed
    bans = []
    for order, team, team_name, hero_id, team_a_side in rows:
        side = None
        if team_a_side in (0, 1):
            side = int(team_a_side) if team == "team_a" else 1 - int(team_a_side)
        bans.append({"order": order, "team": team, "team_name": team_name, "hero_id": hero_id, "side": side})
    return jsonify({"bans": bans})


@bp.get("/matches/<int:match_id>/adjacent")
@cache.cached(timeout=900)
def match_adjacent(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur_row = conn.execute(
            "SELECT start_time, winning_team, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, duration_s, match_vod FROM matches WHERE match_id = ?",
            (match_id,),
        ).fetchone()
        prev_row = conn.execute(
            "SELECT match_id FROM matches WHERE created_at > "
            "(SELECT created_at FROM matches WHERE match_id = ?) "
            "ORDER BY created_at ASC LIMIT 1",
            (match_id,),
        ).fetchone()
        next_row = conn.execute(
            "SELECT match_id FROM matches WHERE created_at < "
            "(SELECT created_at FROM matches WHERE match_id = ?) "
            "ORDER BY created_at DESC LIMIT 1",
            (match_id,),
        ).fetchone()
    return jsonify({
        "start_time": cur_row[0] if cur_row else None,
        "winning_team": cur_row[1] if cur_row else None,
        "event_title": cur_row[2] if cur_row else None,
        "event_week": cur_row[3] if cur_row else None,
        "event_team_a": cur_row[4] if cur_row else None,
        "event_team_b": cur_row[5] if cur_row else None,
        "event_game": cur_row[6] if cur_row else None,
        "event_team_a_ingame_side": cur_row[7] if cur_row else None,
        "duration_s": cur_row[8] if cur_row else None,
        "match_vod": cur_row[9] if cur_row else None,
        "previous_match_id": prev_row[0] if prev_row else None,
        "next_match_id": next_row[0] if next_row else None,
    })


@bp.get("/matches/<int:match_id>/replay")
def match_replay(match_id: int):
    """Resolve a replay ZIP for a match and return a direct filebrowser download URL."""
    # Match IDs in DB can be placeholders (negative). Replays are only meaningful for positive IDs.
    if match_id <= 0:
        return jsonify({"ok": False, "error": "invalid_match_id"}), 400
    retry_requested = _request_arg_true("retry")

    try:
        # Ensure replay endpoints are configured via environment.
        _replay_share_api_url()
        _replay_download_base_url()
    except ValueError as e:
        return jsonify(
            {
                "ok": False,
                "match_id": match_id,
                "found": False,
                "error": "replay_config_missing",
                "message": str(e),
            }
        ), 503

    ttl_seconds = _replay_cache_ttl_seconds()
    cached_replay = cache.get(_replay_cache_key(match_id))
    if _replay_open_url(cached_replay):
        return jsonify(
            {
                "ok": True,
                "match_id": match_id,
                "found": True,
                "cached": True,
                "cache_source": "memory",
                "cache_ttl_seconds": ttl_seconds,
                "replay": cached_replay,
            }
        )

    persisted_lookup = _get_persisted_replay_lookup(match_id)
    if isinstance(persisted_lookup, dict):
        persisted_replay = persisted_lookup.get("replay")
        if persisted_lookup.get("found") and _replay_open_url(persisted_replay):
            cache.set(_replay_cache_key(match_id), persisted_replay, timeout=ttl_seconds)
            return jsonify(
                {
                    "ok": True,
                    "match_id": match_id,
                    "found": True,
                    "cached": True,
                    "cache_source": "file",
                    "cache_ttl_seconds": ttl_seconds,
                    "replay": persisted_replay,
                }
            )
        if persisted_lookup.get("found") is False and not retry_requested:
            return jsonify(
                {
                    "ok": False,
                    "match_id": match_id,
                    "found": False,
                    "cached": True,
                    "cache_source": "file",
                    "cache_ttl_seconds": ttl_seconds,
                    "searched_dirs": int(persisted_lookup.get("searched_dirs") or 0),
                    "error": "replay_not_found",
                    "message": "Replay was not found in replay_storage for this match ID.",
                }
            ), 404

    item, visited_dirs = _replay_match_item(match_id)
    if not item:
        _set_persisted_replay_lookup(
            match_id,
            found=False,
            replay=None,
            ttl_seconds=ttl_seconds,
            searched_dirs=visited_dirs,
        )
        return jsonify(
            {
                "ok": False,
                "match_id": match_id,
                "found": False,
                "cached": False,
                "searched_dirs": visited_dirs,
                "error": "replay_not_found",
                "message": "Replay was not found in replay_storage for this match ID.",
            }
        ), 404

    item_path = str(item.get("path") or "")
    filename = str(item.get("name") or "")
    replay_payload = {
        "name": filename,
        "path": item_path,
        "size": item.get("size"),
        "modified": item.get("modified"),
        "download_url": _build_replay_download_url(item_path),
    }
    cache.set(_replay_cache_key(match_id), replay_payload, timeout=ttl_seconds)
    _set_persisted_replay_lookup(
        match_id,
        found=True,
        replay=replay_payload,
        ttl_seconds=ttl_seconds,
        searched_dirs=visited_dirs,
    )

    return jsonify(
        {
            "ok": True,
            "match_id": match_id,
            "found": True,
            "cached": False,
            "cache_source": None,
            "cache_ttl_seconds": ttl_seconds,
            "searched_dirs": visited_dirs,
            "replay": replay_payload,
        }
    )


@bp.get("/matches/<int:match_id>/players")
@cache.cached(timeout=900)
def match_players(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT p.*, u.persona_name, u.avatar_url FROM players p "
            "LEFT JOIN users u ON u.account_id = p.account_id "
            "WHERE p.match_id = ? ORDER BY p.team, p.player_slot",
            (match_id,),
        )
        data = _rows_to_dicts(cur)

        # Per-player soul income breakdown (from the final stats snapshot).
        gcur = conn.execute(
            "SELECT account_id, source, kills, damage, gold, gold_orbs "
            "FROM player_gold_sources WHERE match_id = ? ORDER BY account_id, source",
            (match_id,),
        )
        gs_by_acct: Dict[int, list] = {}
        for row in gcur.fetchall():
            acct, src, kills, damage, gold, gold_orbs = row
            gs_by_acct.setdefault(acct, []).append({
                "source": src,
                "kills": kills,
                "damage": damage,
                "gold": gold,
                "gold_orbs": gold_orbs,
            })

        # Per-player damage-by-source (ability/item/weapon) from the match damage_matrix.
        dcur = conn.execute(
            "SELECT account_id, source, damage FROM player_damage_sources "
            "WHERE match_id = ? ORDER BY account_id, damage DESC",
            (match_id,),
        )
        dmg_by_acct: Dict[int, list] = {}
        for acct, src, dmg in dcur.fetchall():
            dmg_by_acct.setdefault(acct, []).append({"source": src, "damage": dmg})

    for p in data:
        p["gold_sources"] = gs_by_acct.get(p.get("account_id"), [])
        p["damage_sources"] = dmg_by_acct.get(p.get("account_id"), [])

    return jsonify({"players": data})


@bp.get("/items/names")
@cache.cached(timeout=21600)  # Cache for 6 hours
def item_names():  # type: ignore
    """Return class_name -> display name for items (for damage-source labels)."""
    return jsonify(_item_class_names())


@bp.get("/matches/<int:match_id>/deaths")
@cache.cached(timeout=3600, query_string=True)
def match_deaths(match_id: int):  # type: ignore
    team_raw = (request.args.get("team") or "").strip()
    account_raw = (request.args.get("account_id") or "").strip()
    team = None
    account_id = None

    if team_raw:
        try:
            team = int(team_raw)
        except ValueError:
            return jsonify({"error": "invalid_team"}), 400
        if team not in (0, 1):
            return jsonify({"error": "invalid_team"}), 400

    if account_raw:
        try:
            account_id = int(account_raw)
        except ValueError:
            return jsonify({"error": "invalid_account_id"}), 400
        if account_id <= 0 or account_id > 2**63 - 1:
            return jsonify({"error": "invalid_account_id"}), 400

    conditions = ["d.match_id = ?"]
    params: list[int] = [match_id]
    if team is not None:
        conditions.append("p.team = ?")
        params.append(team)
    if account_id is not None:
        conditions.append("d.account_id = ?")
        params.append(account_id)

    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT d.match_id, d.account_id, d.death_index, d.death_time_s, "
            "d.position_x, d.position_y, d.position_z, d.midpoint_distance_x, "
            "d.midpoint_distance_y, d.midpoint_distance_z, d.midpoint_distance, "
            "p.player_slot, p.team, p.hero_id, u.persona_name "
            "FROM player_deaths d "
            "LEFT JOIN players p ON p.match_id = d.match_id AND p.account_id = d.account_id "
            "LEFT JOIN users u ON u.account_id = d.account_id "
            f"WHERE {' AND '.join(conditions)} "
            "ORDER BY d.death_time_s IS NULL, d.death_time_s, d.account_id, d.death_index",
            tuple(params),
        )
        deaths = _rows_to_dicts(cur)

    return jsonify({
        "match_id": match_id,
        "count": len(deaths),
        "filters": {"team": team, "account_id": account_id},
        "deaths": deaths,
    })


@bp.get("/matches/<int:match_id>/timeline")
@cache.cached(timeout=3600)
def match_timeline(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        # Check if any snapshots exist for this match
        cur = conn.execute(
            "SELECT COUNT(*) FROM player_snapshots WHERE match_id = ?",
            (match_id,),
        )
        count = cur.fetchone()[0]
        if count == 0:
            return jsonify({"available": False, "players": {}})

        cur = conn.execute(
            "SELECT s.account_id, s.snapshot_index, s.net_worth, s.kills, s.deaths, "
            "s.assists, s.player_damage, s.player_healing, s.time_stamp_s, "
            "u.persona_name, p.team, p.hero_id "
            "FROM player_snapshots s "
            "LEFT JOIN users u ON u.account_id = s.account_id "
            "LEFT JOIN players p ON p.match_id = s.match_id AND p.account_id = s.account_id "
            "WHERE s.match_id = ? "
            "ORDER BY s.account_id, s.snapshot_index",
            (match_id,),
        )
        rows = cur.fetchall()

    players: Dict[str, Any] = {}
    for row in rows:
        account_id, snap_idx, net_worth, kills, deaths, assists, player_damage, player_healing, time_stamp_s, persona_name, team, hero_id = row
        key = str(account_id)
        if key not in players:
            players[key] = {
                "account_id": account_id,
                "persona_name": persona_name,
                "team": team,
                "hero_id": hero_id,
                "snapshots": [],
            }
        players[key]["snapshots"].append({
            "net_worth": net_worth,
            "kills": kills,
            "deaths": deaths,
            "assists": assists,
            "player_damage": player_damage,
            "player_healing": player_healing,
            "time_stamp_s": time_stamp_s,
        })

    return jsonify({"available": True, "players": players})


@bp.get("/matches/<int:match_id>/items")
@cache.cached(timeout=86400)
def match_items(match_id: int):  # type: ignore
    # Fetch item catalog (cached 10 min).
    # If the cache is cold, do a short-timeout fetch so we don't block Flask's
    # single-threaded dev server long enough to cause an ECONNRESET at the proxy.
    item_catalog = cache.get("dlns_items_list")
    if item_catalog is None:
        try:
            resp = requests.get(
                ITEMS_URL,
                params={"language": "english"},
                timeout=3,
            )
            resp.raise_for_status()
            item_catalog = resp.json()
            cache.set("dlns_items_list", item_catalog, timeout=600)
        except Exception as e:
            current_app.logger.warning("Item catalog unavailable: %s", e)
            return jsonify({})

    # Build id -> {name, item_slot_type, item_tier, type, image} lookup
    item_lookup: dict = {}
    for item in (item_catalog if isinstance(item_catalog, list) else []):
        iid = item.get("id")
        if iid is not None:
            item_lookup[int(iid)] = {
                "name": item.get("name", ""),
                "image": item.get("image", ""),
                "item_slot_type": item.get("item_slot_type", ""),
                "item_tier": item.get("item_tier"),
                "type": item.get("type", ""),
            }

    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT account_id, items, raw_items_json FROM players WHERE match_id = ?",
            (match_id,),
        )
        rows = cur.fetchall()

    result: dict = {}
    for account_id, items_json, raw_items_json in rows:
        enriched = []
        if raw_items_json:
            # New path: classify using catalog so abilities are never included
            try:
                raw_entries = json.loads(raw_items_json)
            except Exception:
                raw_entries = []
            seen_ids: set = set()
            for entry in raw_entries:
                iid = entry.get("item_id")
                if iid is None:
                    continue
                iid_int = int(iid)
                if iid_int in seen_ids:
                    continue
                if entry.get("sold_time_s", 0) != 0:
                    continue
                meta = item_lookup.get(iid_int)
                if meta and meta.get("name") and meta.get("type") != "ability":
                    seen_ids.add(iid_int)
                    enriched.append(meta)
        elif items_json:
            # Legacy path: pre-stored item_id list
            try:
                item_ids = json.loads(items_json)
            except Exception:
                item_ids = []
            seen_ids = set()
            for iid in item_ids:
                iid_int = int(iid)
                if iid_int in seen_ids:
                    continue
                seen_ids.add(iid_int)
                meta = item_lookup.get(iid_int)
                if meta and meta.get("name") and meta.get("type") != "ability":
                    enriched.append(meta)
        if not enriched:
            continue
        enriched.sort(key=lambda x: x.get("item_tier") or 0, reverse=True)
        enriched = enriched[:12]
        result[str(account_id)] = enriched

    return jsonify(result)


@bp.get("/matches/<int:match_id>/build")
@cache.cached(timeout=3600)
def match_build(match_id: int):  # type: ignore
    item_catalog = cache.get("dlns_items_list")
    if item_catalog is None:
        try:
            resp = requests.get(
                ITEMS_URL,
                params={"language": "english"},
                timeout=3,
            )
            resp.raise_for_status()
            item_catalog = resp.json()
            cache.set("dlns_items_list", item_catalog, timeout=600)
        except Exception as e:
            current_app.logger.warning("Item catalog unavailable: %s", e)
            return jsonify({})

    item_lookup: dict = {}
    ability_lookup: dict = {}
    for item in (item_catalog if isinstance(item_catalog, list) else []):
        iid = item.get("id")
        if iid is None:
            continue
        iid_int = int(iid)
        item_type = item.get("type", "")
        if item_type == "ability":
            ability_lookup[iid_int] = {
                "name": item.get("name", ""),
                "image": item.get("image", ""),
                "ability_type": item.get("ability_type", ""),
                "hero": item.get("hero"),
            }
        else:
            item_lookup[iid_int] = {
                "name": item.get("name", ""),
                "image": item.get("image", ""),
                "item_slot_type": item.get("item_slot_type", ""),
                "item_tier": item.get("item_tier"),
                "type": item_type,
            }

    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT account_id, item_build, items, ability_order, raw_items_json FROM players WHERE match_id = ?",
            (match_id,),
        )
        rows = cur.fetchall()

    result: dict = {}
    for account_id, item_build_json, items_json, ability_order_json, raw_items_json in rows:
        # --- items + abilities ---
        # Prefer raw_items_json (full API data) + catalog for reliable classification.
        # Fall back to pre-processed item_build / ability_order for older rows.
        if raw_items_json:
            try:
                raw_entries = json.loads(raw_items_json)
            except Exception:
                raw_entries = []

            # Group by item_id
            item_groups: dict = {}
            for entry in raw_entries:
                iid = entry.get("item_id")
                if iid is None:
                    continue
                iid_int = int(iid)
                if iid_int not in item_groups:
                    item_groups[iid_int] = []
                item_groups[iid_int].append(entry)

            enriched_items = []
            enriched_abilities_raw: dict = {}
            for iid_int, entries in item_groups.items():
                if iid_int in item_lookup:
                    # Shop item: take the earliest unsold entry for purchase timestamp
                    unsold = [e for e in entries if e.get("sold_time_s", 0) == 0]
                    if not unsold:
                        continue
                    first = min(unsold, key=lambda e: e.get("game_time_s") or 0)
                    enriched_items.append({**item_lookup[iid_int], "game_time_s": first.get("game_time_s")})
                elif iid_int in ability_lookup:
                    # Hero ability: collect tier upgrades
                    unsold = [e for e in entries if e.get("sold_time_s", 0) == 0]
                    if not unsold:
                        continue
                    upgrades = [
                        {"tier": i, "game_time_s": e.get("game_time_s")}
                        for i, e in enumerate(sorted(unsold, key=lambda e: e.get("game_time_s") or 0))
                    ]
                    enriched_abilities_raw[iid_int] = upgrades
                # items not in catalog are silently ignored

            enriched_items.sort(key=lambda x: (x["game_time_s"] is None, x["game_time_s"] or 0))

            enriched_abilities = []
            for aid_int, upgrades in enriched_abilities_raw.items():
                meta = ability_lookup.get(aid_int)
                if meta and meta.get("name"):
                    enriched_abilities.append({**meta, "ability_id": aid_int, "upgrades": upgrades})
            enriched_abilities.sort(
                key=lambda a: (a["upgrades"][0]["game_time_s"] is None, a["upgrades"][0]["game_time_s"] or 0)
                if a["upgrades"] else (True, 0)
            )

        else:
            # Legacy path: use pre-processed columns
            if item_build_json:
                try:
                    build = json.loads(item_build_json)
                except Exception:
                    build = []
            elif items_json:
                try:
                    build = [{"item_id": iid, "game_time_s": None} for iid in json.loads(items_json)]
                except Exception:
                    build = []
            else:
                build = []
            enriched_items = []
            for entry in build:
                try:
                    iid_int = int(entry["item_id"])
                except (KeyError, TypeError, ValueError):
                    continue
                meta = item_lookup.get(iid_int)
                if meta and meta.get("name") and meta.get("type") != "ability":
                    enriched_items.append({**meta, "game_time_s": entry.get("game_time_s")})

            ability_events = []
            if ability_order_json:
                try:
                    ability_events = json.loads(ability_order_json)
                except Exception:
                    ability_events = []
            grouped: dict = {}
            for ev in ability_events:
                aid = ev.get("ability_id")
                if aid is None:
                    continue
                aid_int = int(aid)
                if aid_int not in grouped:
                    grouped[aid_int] = []
                grouped[aid_int].append({"tier": ev.get("tier", 0), "game_time_s": ev.get("game_time_s")})
            enriched_abilities = []
            for aid_int, upgrades in grouped.items():
                meta = ability_lookup.get(aid_int)
                if meta and meta.get("name"):
                    enriched_abilities.append({**meta, "ability_id": aid_int, "upgrades": upgrades})
            enriched_abilities.sort(
                key=lambda a: (a["upgrades"][0]["game_time_s"] is None, a["upgrades"][0]["game_time_s"] or 0)
                if a["upgrades"] else (True, 0)
            )

        if enriched_items or enriched_abilities:
            result[str(account_id)] = {"items": enriched_items, "abilities": enriched_abilities}

    return jsonify(result)


@bp.get("/matches/<int:match_id>/users/<int:account_id>")
@cache.cached(timeout=900)
def match_user_stats(match_id: int, account_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT p.*, u.persona_name, u.avatar_url FROM players p "
            "LEFT JOIN users u ON u.account_id = p.account_id "
            "WHERE p.match_id = ? AND p.account_id = ?",
            (match_id, account_id),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        cols = [c[0] for c in cur.description]
        player_data = dict(zip(cols, row))
        
        # Enhance with hero name
        if player_data.get('hero_id'):
            player_data['hero_name'] = get_hero_name(player_data['hero_id'])
        
        return jsonify({"player": player_data})


@bp.get("/users/<int:account_id>")
@cache.cached(timeout=1800)
def user_info(account_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT account_id, persona_name, avatar_url, updated_at FROM users WHERE account_id = ?",
            (account_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"error": "not_found"}), 404
        return jsonify({"user": {"account_id": row[0], "persona_name": row[1], "avatar_url": row[2], "updated_at": row[3]}})


@bp.get("/users/<int:account_id>/stats")
@cache.cached(timeout=1800)
def user_stats(account_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT * FROM user_stats WHERE account_id = ?",
            (account_id,),
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"stats": None})
        cols = [c[0] for c in cur.description]
        return jsonify({"stats": dict(zip(cols, row))})


@bp.get("/users/<int:account_id>/matches")
@cache.cached(timeout=900, query_string=True)
def user_matches_api(account_id: int):
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.net_worth, p.last_hits, p.denies, p.creep_kills, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, p.level, p.lane, p.lane_real, m.duration_s, m.winning_team, m.game_mode, m.match_mode, m.start_time, m.created_at, m.event_title, m.event_week, m.event_game, m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.match_vod "
            # Order by when the game was PLAYED, not when it was ingested —
            # `created_at` reorders a player's history whenever a week is
            # re-ingested (e.g. the week-49 repair), which broke "last 10 games".
            "FROM players p JOIN matches m ON m.match_id = p.match_id WHERE p.account_id = ? "
            "ORDER BY COALESCE(m.start_time, m.created_at) DESC",
            (account_id,),
        )
        data = _rows_to_dicts(cur)
        
        # Enhance with hero names
        for match in data:
            if match.get('hero_id'):
                match['hero_name'] = get_hero_name(match['hero_id'])
        
        return jsonify({"matches": data})

# Whitelisted ORDER BY fragments for /users/<id>/matches/paged. Anything else
# falls back to newest-first, so the sort param can never reach the SQL string.
_USER_MATCH_SORTS = {
    "date": "COALESCE(m.start_time, m.created_at)",
    "kda": "(p.kills + p.assists) * 1.0 / MAX(COALESCE(p.deaths, 0), 1)",
    "souls": "p.net_worth",
    "duration": "m.duration_s",
}


@bp.get("/users/<int:account_id>/matches/paged")
@cache.cached(timeout=900, query_string=True)
def user_matches_paged_api(account_id: int):
    order = (request.args.get("order") or "desc").lower()
    order = "asc" if order == "asc" else "desc"
    res = (request.args.get("res") or "").lower()  # win|loss|''
    # The player's own side: 0 = Amber, 1 = Sapphire. `team` is the legacy name
    # for the same filter and is still honoured.
    sidef = request.args.get("side") or request.args.get("team") or ""
    sort = (request.args.get("sort") or "date").lower()
    order_by = _USER_MATCH_SORTS.get(sort, _USER_MATCH_SORTS["date"])
    try:
        page = max(1, int(request.args.get("page", 1)))
    except Exception:
        page = 1
    try:
        per_page = max(1, min(20, int(request.args.get("per_page", 20))))
    except Exception:
        per_page = 25
    offset = (page - 1) * per_page

    params: List[Any] = [account_id]
    conds: List[str] = []
    if res in ("win", "loss"):
        conds.append("p.result = ?")
        params.append("Win" if res == "win" else "Loss")
    if sidef in ("0", "1"):
        conds.append("p.team = ?")
        params.append(int(sidef))
    herof = request.args.get("hero") or ""
    if herof:
        try:
            conds.append("p.hero_id = ?")
            params.append(int(herof))
        except Exception:
            pass

    where = " WHERE p.account_id = ?" + (" AND " + " AND ".join(conds) if conds else "")
    with get_ro_conn() as conn:
        ccur = conn.execute(
            "SELECT COUNT(1) FROM players p JOIN matches m ON m.match_id = p.match_id" + where,
            tuple(params)
        )
        total = ccur.fetchone()[0]
        cur = conn.execute(
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.net_worth, p.last_hits, p.denies, p.creep_kills, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, p.level, p.lane, p.lane_real, m.duration_s, m.winning_team, m.start_time, m.created_at, m.event_week, m.event_game, m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.match_vod "
            "FROM players p JOIN matches m ON m.match_id = p.match_id" + where +
            f" ORDER BY {order_by} {'ASC' if order == 'asc' else 'DESC'} LIMIT ? OFFSET ?",
            tuple(params + [per_page, offset])
        )
        data = _rows_to_dicts(cur)
        
        # Enhance with hero names
        for match in data:
            if match.get('hero_id'):
                match['hero_name'] = get_hero_name(match['hero_id'])
        
        return jsonify({
            "matches": data,
            "page": page,
            "per_page": per_page,
            "total": total,
            "total_pages": (total + per_page - 1) // per_page
        })

@bp.get("/users/<int:account_id>/souls")
@cache.cached(timeout=1800)
def user_souls_api(account_id: int):  # type: ignore
    """Soul income per source, averaged over the games that carry soul data.

    `player_gold_sources` holds one row per (match, source), so dividing by the
    number of games that HAVE soul data keeps the shares consistent and makes the
    per-game values add up to the player's souls per game. A source a game never
    produced simply contributes nothing, which is how the in-game breakdown works.

    Source ids are resolved to names in the frontend (SOUL_SOURCE_LABELS), the
    same map MatchDetail's tooltip uses.
    """
    with get_ro_conn() as conn:
        rows = conn.execute(
            """
            SELECT source,
                   SUM(COALESCE(gold, 0) + COALESCE(gold_orbs, 0)) AS total,
                   COUNT(DISTINCT match_id) AS games
              FROM player_gold_sources
             WHERE account_id = ?
             GROUP BY source
            """,
            (account_id,),
        ).fetchall()
        total_games = conn.execute(
            "SELECT COUNT(*) FROM players WHERE account_id = ?",
            (account_id,),
        ).fetchone()[0]

    # Every game with data contributes at least one source row, so the largest
    # per-source game count is the number of games that have soul data at all.
    games = max((row[2] or 0) for row in rows) if rows else 0
    total = sum(row[1] or 0 for row in rows)

    sources = [
        {
            "source": row[0],
            "total": int(row[1] or 0),
            "per_game": (row[1] or 0) / games if games else None,
            "share": (row[1] or 0) / total if total else None,
        }
        for row in rows
    ]
    sources.sort(key=lambda item: item["total"], reverse=True)

    return jsonify(
        {
            "account_id": account_id,
            "games": games,  # games that carry soul data
            "total_games": total_games,  # every game the player played
            "total_per_game": total / games if games else None,
            "sources": sources,
        }
    )


@bp.get("/users/<int:account_id>/deaths")
@cache.cached(timeout=1800)
def user_deaths_api(account_id: int):  # type: ignore
    """Death rate and timing, split by game phase.

    Two sources, on purpose: `players.deaths` is the authoritative per-game
    count (it is what every other page shows), while `player_deaths` carries the
    per-death time used for the phase split — those rows only exist for matches
    that have stats snapshots.

    There is deliberately no "overextension" figure: `player_deaths.midpoint_distance`
    is NULL in every stored row, because the ingest only fills it when x, y AND z
    are all present and the snapshots never carry a z. A 2D stand-in from
    `position_x`/`position_y` is possible but would be a different metric, so it is
    not served until the league asks for one.
    """
    with get_ro_conn() as conn:
        games, deaths, seconds = conn.execute(
            """
            SELECT COUNT(*) AS games,
                   COALESCE(SUM(p.deaths), 0) AS deaths,
                   COALESCE(SUM(m.duration_s), 0) AS seconds
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.account_id = ?
            """,
            (account_id,),
        ).fetchone()

        timed, avg_time, early, mid, late = conn.execute(
            """
            SELECT COUNT(d.death_time_s),
                   AVG(d.death_time_s),
                   SUM(CASE WHEN d.death_time_s < 900 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN d.death_time_s >= 900 AND d.death_time_s <= 1800 THEN 1 ELSE 0 END),
                   SUM(CASE WHEN d.death_time_s > 1800 THEN 1 ELSE 0 END)
              FROM player_deaths d
             WHERE d.account_id = ?
            """,
            (account_id,),
        ).fetchone()

        games_with_death_data = conn.execute(
            "SELECT COUNT(DISTINCT match_id) FROM player_deaths WHERE account_id = ?",
            (account_id,),
        ).fetchone()[0]

    return jsonify(
        {
            "account_id": account_id,
            "games": games,
            "deaths": deaths,
            "deaths_per_game": deaths / games if games else None,
            "deaths_per_min": deaths / (seconds / 60) if seconds else None,
            "avg_death_time_s": avg_time,
            "timed_deaths": timed or 0,
            # Death timing/positions only exist for matches with stats snapshots.
            "games_with_death_data": games_with_death_data,
            "phases": [
                {"id": "early", "label": "< 15 min", "count": early or 0},
                {"id": "mid", "label": "15 – 30 min", "count": mid or 0},
                {"id": "late", "label": "30+ min", "count": late or 0},
            ],
        }
    )


@bp.get("/users/<int:account_id>/items")
@cache.cached(timeout=1800)
def user_items_api(account_id: int):  # type: ignore
    """Signature items (3,200+ souls) and the typical build order."""
    with get_ro_conn() as conn:
        summary = _item_summary(conn, account_id)

    return jsonify({"account_id": account_id, **summary})


def _item_summary(
    conn: sqlite3.Connection, account_id: int, hero_id: Optional[int] = None
) -> Dict[str, Any]:
    """Signature items and the build order for one player, optionally on one hero.

    Shared by /users/<id>/items (whole career) and /users/<id>/hero/<hero_id>, so
    the two panels can never disagree about a median buy time. `players.raw_items_json`
    holds one entry per purchase event, so entries with a non-zero `sold_time_s`
    were bought and later sold and are excluded — the same rule the team page
    uses. Median buy time is computed here rather than in SQL because SQLite has
    no median aggregate.
    """
    catalog = _item_catalog()
    scope = ""
    params: List[Any] = [account_id]
    if hero_id is not None:
        scope = " AND p.hero_id = ?"
        params.append(hero_id)

    total_games = conn.execute(
        "SELECT COUNT(*) FROM players p WHERE p.account_id = ?" + scope,
        tuple(params),
    ).fetchone()[0]
    rows = conn.execute(
        """
        SELECT p.match_id,
               json_extract(entry.value, '$.item_id') AS item_id,
               json_extract(entry.value, '$.game_time_s') AS game_time_s
          FROM players p,
               json_each(p.raw_items_json) AS entry
         WHERE p.account_id = ?
           AND p.raw_items_json IS NOT NULL
           AND json_extract(entry.value, '$.item_id') IS NOT NULL
           AND COALESCE(json_extract(entry.value, '$.sold_time_s'), 0) = 0
        """
        + scope,
        tuple(params),
    ).fetchall()

    # item id -> the games it was bought in and the buy times collected
    stats: Dict[int, Dict[str, Any]] = {}
    games_with_items = set()
    for match_id, item_id, game_time_s in rows:
        games_with_items.add(match_id)
        bucket = stats.setdefault(int(item_id), {"games": set(), "times": []})
        bucket["games"].add(match_id)
        if game_time_s is not None:
            bucket["times"].append(game_time_s)

    def median(values: List[float]) -> Optional[float]:
        if not values:
            return None
        ordered = sorted(values)
        middle = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[middle]
        return (ordered[middle - 1] + ordered[middle]) / 2

    entries = []
    for item_id, bucket in stats.items():
        meta = catalog.get(item_id)
        if not meta or meta["type"] == "ability":
            continue
        bought = len(bucket["games"])
        entries.append(
            {
                "item_id": item_id,
                "item_name": meta["name"],
                "tier": meta["tier"],
                "slot": meta["slot"],
                "icon": meta["icon"],
                "games": bought,
                "share": bought / total_games if total_games else None,
                "median_time_s": median(bucket["times"]),
            }
        )

    signature = sorted(
        (item for item in entries if (item["tier"] or 0) >= MIN_SIGNATURE_ITEM_TIER),
        key=lambda item: (-item["games"], item["item_name"]),
    )[:SIGNATURE_ITEM_PROFILE_LIMIT]

    # The build order is the most-bought items, laid out by when they are
    # typically finished — an item nobody buys has no place on a build timeline.
    build = sorted(
        (item for item in entries if item["games"] >= 2 and item["median_time_s"] is not None),
        key=lambda item: (-item["games"], item["item_name"]),
    )[:BUILD_ORDER_LIMIT]
    build.sort(key=lambda item: item["median_time_s"])

    return {
        "games": total_games,
        "games_with_items": len(games_with_items),
        "signature": signature,
        "build": build,
    }


@bp.get("/users/<int:account_id>/hero/<int:hero_id>")
@cache.cached(timeout=1800)
def user_hero_api(account_id: int, hero_id: int):  # type: ignore
    """Everything the Player × Hero page needs that is not already in the player's
    match list: league baselines on the hero, the standings on it, the ability
    point orders and the matchups.

    The page's own tiles, form strip, trend and lane split are derived from
    `/users/<id>/matches` in the browser, so they use the same rules as the
    player page; only the cross-player figures are computed here.
    """
    from ..heroes import get_all_hero_names

    hero_names = get_all_hero_names()
    slots = _hero_ability_slots().get(hero_id) or {"abilities": [], "slots": {}}

    with get_ro_conn() as conn:
        mine = conn.execute(
            """
            SELECT p.match_id, p.team, p.result, p.kills, p.deaths, p.assists,
                   p.net_worth, p.player_damage, p.ability_order,
                   m.duration_s, m.winning_team, m.event_week, m.event_team_a,
                   m.event_team_b, m.event_team_a_ingame_side,
                   COALESCE(m.start_time, m.created_at) AS played
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.account_id = ? AND p.hero_id = ?
             ORDER BY played ASC
            """,
            (account_id, hero_id),
        ).fetchall()

        # The whole hero pool, small enough (a few hundred rows at most) to rank
        # in Python with the exact same win/loss rule the UI uses.
        pool = conn.execute(
            """
            SELECT p.account_id, p.team, p.result, p.kills, p.deaths, p.assists,
                   p.net_worth, p.player_damage, m.duration_s, m.winning_team
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?
            """,
            (hero_id,),
        ).fetchall()

        matchups = conn.execute(
            """
            SELECT p.match_id, e.hero_id
              FROM players p
              JOIN players e ON e.match_id = p.match_id AND e.team <> p.team
             WHERE p.account_id = ? AND p.hero_id = ?
               AND p.team IN (0, 1) AND e.team IN (0, 1)
            """,
            (account_id, hero_id),
        ).fetchall()

        items = _item_summary(conn, account_id, hero_id)

    games = len(mine)
    wins = sum(1 for row in mine if _match_won(row[1], row[10], row[2]) is True)
    losses = sum(1 for row in mine if _match_won(row[1], row[10], row[2]) is False)
    weeks = [row[11] for row in mine if row[11] is not None]
    # The team from the most recent game whose side is resolvable — a side-less
    # qualifier match cannot say which of the two named teams the player was on.
    team = None
    for row in reversed(mine):
        team = _named_team(row[1], row[14], row[12], row[13])
        if team:
            break

    own = _hero_aggregate([
        (row[3], row[4], row[5], row[6], row[7], row[9], _match_won(row[1], row[10], row[2]))
        for row in mine
    ])

    per_player: Dict[int, Dict[str, Any]] = {}
    league_rows = []
    for account, side, result, kills, deaths, assists, net_worth, damage, duration, winner in pool:
        won = _match_won(side, winner, result)
        league_rows.append((kills, deaths, assists, net_worth, damage, duration, won))
        entry = per_player.setdefault(account, {"games": 0, "wins": 0, "losses": 0})
        entry["games"] += 1
        if won is True:
            entry["wins"] += 1
        elif won is False:
            entry["losses"] += 1

    league = _hero_aggregate(league_rows)
    league_wins = sum(entry["wins"] for entry in per_player.values())
    league_losses = sum(entry["losses"] for entry in per_player.values())
    league["games"] = len(league_rows)
    league["decided"] = league_wins + league_losses
    league["win_rate"] = (
        league_wins / (league_wins + league_losses) if league_wins + league_losses else None
    )
    standings = _hero_standings(per_player, account_id, RANK_TOP_N, RANK_MIN_GAMES)

    matchup_rows: Dict[int, Dict[str, Any]] = {}
    outcomes = {row[0]: _match_won(row[1], row[10], row[2]) for row in mine}
    for match_id, enemy_hero_id in matchups:
        won = outcomes.get(match_id)
        entry = matchup_rows.setdefault(
            int(enemy_hero_id), {"games": 0, "wins": 0, "losses": 0}
        )
        entry["games"] += 1
        if won is True:
            entry["wins"] += 1
        elif won is False:
            entry["losses"] += 1

    matchups_out = [
        {
            "hero_id": enemy_hero_id,
            "hero_name": hero_names.get(str(enemy_hero_id), f"Hero {enemy_hero_id}"),
            **entry,
        }
        for enemy_hero_id, entry in matchup_rows.items()
    ]
    matchups_out.sort(key=lambda row: (-row["games"], row["hero_name"]))

    return jsonify(
        {
            "account_id": account_id,
            "hero_id": hero_id,
            "hero_name": hero_names.get(str(hero_id), f"Hero {hero_id}"),
            "games": games,
            "wins": wins,
            "losses": losses,
            "decided": wins + losses,
            "win_rate": wins / (wins + losses) if wins + losses else None,
            **own,
            "team": team,
            "first_week": min(weeks) if weeks else None,
            "last_week": max(weeks) if weeks else None,
            "league": {"players": len(per_player), **league},
            "rank": standings,
            "ability_builds": _ability_builds(mine, slots, games),
            "items": {
                "games": items["games"],
                "games_with_items": items["games_with_items"],
                "build": items["build"],
                "signature": items["signature"],
            },
            "matchups": matchups_out,
        }
    )


@bp.get("/users/<int:account_id>/damage")
@cache.cached(timeout=1800)
def user_damage_api(account_id: int):  # type: ignore
    """Hero damage by source, grouped the way the Damage Profile panel shows it.

    `player_damage_sources` stores the upstream damage matrix verbatim, which
    mixes generic buckets ("Ability", "Bullet", "Melee", "Misc"), per-hero weapon
    sets and internal ability keys. Labelling an ability key needs the hero the
    player was on, so the rows are aggregated per (source, hero) and classified in
    Python — see `_classify_damage_source`.

    `per_game` divides by the games that actually carry damage data (the same
    denominator the souls panel uses), so the group shares always add up to 100%.
    """
    index = _damage_source_index()
    item_names = _item_class_names()
    from ..heroes import get_all_hero_names

    hero_names = get_all_hero_names()

    with get_ro_conn() as conn:
        total_games = conn.execute(
            "SELECT COUNT(*) FROM players WHERE account_id = ?",
            (account_id,),
        ).fetchone()[0]
        rows = conn.execute(
            """
            SELECT s.source, p.hero_id, SUM(s.damage) AS damage
              FROM player_damage_sources s
              JOIN players p ON p.match_id = s.match_id AND p.account_id = s.account_id
             WHERE s.account_id = ?
             GROUP BY s.source, p.hero_id
            """,
            (account_id,),
        ).fetchall()
        games_with_damage = conn.execute(
            "SELECT COUNT(DISTINCT match_id) FROM player_damage_sources WHERE account_id = ?",
            (account_id,),
        ).fetchone()[0]

    group_totals: Dict[str, int] = {}
    ability_rows: Dict[tuple, Dict[str, Any]] = {}
    # Rows that are one line in the panel however many sources feed them.
    fixed_rows: Dict[str, Dict[str, Any]] = {}
    item_damage = 0
    total = 0

    for source, hero_id, damage in rows:
        damage = int(damage or 0)
        if not damage:
            continue
        group, label, sub = _classify_damage_source(source, hero_id, index, item_names)
        total += damage
        group_totals[group] = group_totals.get(group, 0) + damage

        if group == "abilities":
            hero_name = hero_names.get(str(hero_id)) or f"Hero {hero_id}"
            # A named ability is labelled with the hero who cast it, and the same
            # key can show up for several heroes (a Shiv ability hit taken while
            # on someone else), so the hero stays part of the row key. The generic
            # bucket has its own sub-label and must not split per hero.
            key = (label, sub, hero_id if not sub else None)
            row = ability_rows.setdefault(
                key, {"label": label, "sub": sub or hero_name, "damage": 0}
            )
            row["damage"] += damage
        elif group == "items":
            # Item procs are itemised in Items & Build, so the damage panel keeps
            # one line for them and their individual names are not repeated here.
            item_damage += damage
        else:
            row = fixed_rows.setdefault(
                label, {"label": label, "sub": sub, "group": group, "damage": 0}
            )
            row["damage"] += damage

    def per_game(value: int) -> Optional[float]:
        return value / games_with_damage if games_with_damage else None

    def as_source_row(row: Dict[str, Any], group: str) -> Dict[str, Any]:
        return {
            "label": row["label"],
            "sub": row["sub"],
            "group": group,
            "damage": row["damage"],
            "share": row["damage"] / total if total else None,
            "per_game": per_game(row["damage"]),
        }

    ordered_abilities = sorted(ability_rows.values(), key=lambda row: (-row["damage"], row["label"]))
    sources = [
        as_source_row(row, "abilities") for row in ordered_abilities[:MAX_DAMAGE_ABILITY_ROWS]
    ]

    # Whatever the top-N cut off is rolled into one remainder row, so the ability
    # lines still add up to the Abilities share printed above them.
    rest = ordered_abilities[MAX_DAMAGE_ABILITY_ROWS:]
    if rest:
        remainder = sum(row["damage"] for row in rest)
        sources.append(
            as_source_row(
                {
                    "label": "Other abilities",
                    "sub": f"{len(rest)} more",
                    "damage": remainder,
                },
                "abilities",
            )
        )

    for label in ("Bullets", "Headshots / crits"):
        row = fixed_rows.get(label)
        if row:
            sources.append(as_source_row(row, "weapon"))
    if item_damage:
        sources.append(
            as_source_row(
                {"label": "Item procs", "sub": "all items", "damage": item_damage},
                "items",
            )
        )
    for label in ("Melee", "Misc"):
        row = fixed_rows.get(label)
        if row:
            sources.append(as_source_row(row, row["group"]))

    return jsonify(
        {
            "account_id": account_id,
            "games": total_games,
            "games_with_damage": games_with_damage,
            "total_damage": total,
            "total_per_game": per_game(total),
            "groups": [
                {
                    "id": group_id,
                    "label": DAMAGE_GROUP_LABELS[group_id],
                    "damage": group_totals[group_id],
                    "share": group_totals[group_id] / total if total else None,
                    "per_game": per_game(group_totals[group_id]),
                }
                for group_id in DAMAGE_GROUP_ORDER
                if group_totals.get(group_id)
            ],
            "sources": sources,
        }
    )


def _named_team(side: Any, side_a: Any, team_a: Any, team_b: Any) -> Optional[str]:
    """The team the player was on, or None when the metadata cannot say.

    `players.team` is the in-game side (a bare 0/1) and `event_team_a_ingame_side`
    maps one of the two NAMED teams onto it. The 63 Night Shift Open 1 matches
    never had that mapping authored, so they resolve to nothing rather than to a
    guess — callers count them instead of attributing them.
    """
    if side in (0, 1) and side_a in (0, 1) and team_a and team_b:
        return team_a if side == side_a else team_b
    return None


def _opponent_team(side: Any, side_a: Any, team_a: Any, team_b: Any) -> Optional[str]:
    """The other team in the match, or None when the player's own side is unclear."""
    mine = _named_team(side, side_a, team_a, team_b)
    if not mine:
        return None
    return team_b if mine == team_a else team_a


def _teammate_rows(rows: List[Any]) -> List[Dict[str, Any]]:
    """Group the player's team-mates by account.

    `players.team` is the in-game side and is populated for every row, including
    the side-less qualifier matches, so no game is lost here. The team name shown
    is the one they shared most often — a rosters' worth of players move between
    teams, and the name is only context for the win rate.
    """
    grouped: Dict[int, Dict[str, Any]] = {}
    for account, persona, avatar, team_name, won in rows:
        entry = grouped.setdefault(
            account,
            {
                "account_id": account,
                "persona_name": persona or f"Player {account}",
                "avatar_url": avatar,
                "games": 0,
                "wins": 0,
                "losses": 0,
                "teams": {},
            },
        )
        entry["games"] += 1
        if won is True:
            entry["wins"] += 1
        elif won is False:
            entry["losses"] += 1
        if team_name:
            entry["teams"][team_name] = entry["teams"].get(team_name, 0) + 1

    teammates = []
    for entry in grouped.values():
        decided = entry["wins"] + entry["losses"]
        shared = entry.pop("teams")
        top_team = (
            sorted(shared.items(), key=lambda kv: (-kv[1], kv[0]))[0][0] if shared else None
        )
        teammates.append(
            {
                **entry,
                "team": top_team,
                "decided": decided,
                "win_rate": entry["wins"] / decided if decided else None,
            }
        )
    teammates.sort(key=lambda row: (-row["games"], row["persona_name"].lower()))
    return teammates


@bp.get("/users/<int:account_id>/teammates")
@cache.cached(timeout=1800)
def user_teammates_api(account_id: int):  # type: ignore
    """Everyone the player has shared a side with, most games first.

    A teammate is another row in the same match with the same `players.team`, which
    is the in-game side and therefore carries no name of its own — the team shown
    comes from the match metadata, so a side-less qualifier game contributes to the
    games and the win rate but not to the name.
    """
    with get_ro_conn() as conn:
        rows = conn.execute(
            """
            SELECT e.account_id, u.persona_name, u.avatar_url,
                   m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                   p.team, p.result, m.winning_team
              FROM players p
              JOIN players e
                ON e.match_id = p.match_id AND e.account_id <> p.account_id AND e.team = p.team
              JOIN matches m ON m.match_id = p.match_id
              LEFT JOIN users u ON u.account_id = e.account_id
             WHERE p.account_id = ?
            """,
            (account_id,),
        ).fetchall()

    prepared = []
    for account, persona, avatar, team_a, team_b, side_a, side, result, winner in rows:
        prepared.append(
            (
                account,
                persona,
                avatar,
                _named_team(side, side_a, team_a, team_b),
                _match_won(side, winner, result),
            )
        )

    teammates = _teammate_rows(prepared)
    return jsonify(
        {
            "account_id": account_id,
            "count": len(teammates),
            "teammates": teammates,
        }
    )


@bp.get("/users/<int:account_id>/opponents")
@cache.cached(timeout=1800)
def user_opponents_api(account_id: int):  # type: ignore
    """Who the player has faced, by player and by team.

    The player side is a plain self-join on the opposite `players.team`. The team
    side needs the match metadata to turn an in-game side into a team NAME, so the
    side-less qualifier matches are counted in `unresolved_games` instead of being
    attributed to whichever team they might have been.
    """
    with get_ro_conn() as conn:
        rows = conn.execute(
            """
            SELECT e.account_id, u.persona_name, u.avatar_url,
                   m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                   p.team, p.result, m.winning_team, p.match_id
              FROM players p
              JOIN players e ON e.match_id = p.match_id AND e.team <> p.team
              JOIN matches m ON m.match_id = p.match_id
              LEFT JOIN users u ON u.account_id = e.account_id
             WHERE p.account_id = ? AND p.team IN (0, 1) AND e.team IN (0, 1)
            """,
            (account_id,),
        ).fetchall()

    players: Dict[int, Dict[str, Any]] = {}
    teams: Dict[str, Dict[str, Any]] = {}
    unresolved_matches: set = set()
    # The join returns one row per ENEMY PLAYER, so a team would otherwise count a
    # single game six times. The players list wants that; the team list does not.
    counted_team_games: set = set()

    for account, persona, avatar, team_a, team_b, side_a, side, result, winner, match_id in rows:
        won = _match_won(side, winner, result)
        entry = players.setdefault(
            account,
            {
                "account_id": account,
                "name": persona or f"Player {account}",
                "avatar_url": avatar,
                "games": 0,
                "wins": 0,
                "losses": 0,
            },
        )
        entry["games"] += 1
        if won is True:
            entry["wins"] += 1
        elif won is False:
            entry["losses"] += 1

        enemy = _opponent_team(side, side_a, team_a, team_b)
        if not enemy:
            unresolved_matches.add(match_id)
            continue
        # Team names are hand-authored and drift in case ("MELEE CREEPS" and
        # "Melee Creeps" are one team), so the grouping is case-insensitive and the
        # most-used spelling is the one shown — the team route is case-insensitive
        # as well, so either spelling links correctly.
        key = enemy.lower()
        if (match_id, key) in counted_team_games:
            continue
        counted_team_games.add((match_id, key))
        team_entry = teams.setdefault(
            key, {"name": enemy, "spellings": {}, "games": 0, "wins": 0, "losses": 0}
        )
        team_entry["spellings"][enemy] = team_entry["spellings"].get(enemy, 0) + 1
        team_entry["name"] = max(
            team_entry["spellings"].items(), key=lambda kv: (kv[1], kv[0])
        )[0]
        team_entry["games"] += 1
        if won is True:
            team_entry["wins"] += 1
        elif won is False:
            team_entry["losses"] += 1

    def finish(rows_in: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = []
        for row in rows_in:
            decided = row["wins"] + row["losses"]
            out.append(
                {
                    **row,
                    "decided": decided,
                    "win_rate": row["wins"] / decided if decided else None,
                }
            )
        out.sort(key=lambda row: (-row["games"], row["name"].lower()))
        return out

    for entry in teams.values():
        entry.pop("spellings", None)

    return jsonify(
        {
            "account_id": account_id,
            "players": finish(list(players.values())),
            # A game faces six players but only one team, and a game whose metadata
            # never named the sides lands in neither list.
            "teams": finish(list(teams.values())),
            "unresolved_games": len(unresolved_matches),
        }
    )


@bp.get("/search/suggest")
@cache.cached(timeout=120, query_string=True)
def search_suggest():  # type: ignore
    q = (request.args.get("q") or "").strip()
    if not q:
        return jsonify({"results": []})
    results = []
    with get_ro_conn() as conn:
        if q.isdigit():
            # Suggest recent matches whose ID starts with the typed digits
            cur = conn.execute(
                "SELECT match_id FROM matches WHERE CAST(match_id AS TEXT) LIKE ? ORDER BY created_at DESC LIMIT 10",
                (f"{q}%",),
            )
            rows = cur.fetchall()
            results = [
                {"type": "match", "text": str(r[0]), "url": f"/matches/{r[0]}"}
                for r in rows
            ]
        else:
            # Suggest user names starting with query (prefix match for better perf)
            cur = conn.execute(
                "SELECT account_id, persona_name FROM users WHERE persona_name LIKE ? ORDER BY persona_name LIMIT 10",
                (f"{q}%",),
            )
            rows = cur.fetchall()
            results = [
                {"type": "user", "text": r[1], "url": f"/users/{r[0]}"}
                for r in rows
            ]

            # Teams (prefix match, most active first)
            cur = conn.execute(
                """
                SELECT MIN(team_name) AS team_name, COUNT(DISTINCT match_id) AS matches
                FROM (
                    SELECT event_team_a AS team_name, match_id FROM matches
                    WHERE event_team_a IS NOT NULL AND event_team_a != ''
                    UNION ALL
                    SELECT event_team_b AS team_name, match_id FROM matches
                    WHERE event_team_b IS NOT NULL AND event_team_b != ''
                )
                WHERE LOWER(team_name) LIKE ?
                GROUP BY LOWER(team_name)
                ORDER BY matches DESC, LOWER(team_name) ASC
                LIMIT 5
                """,
                (f"{q.lower()}%",),
            )
            results += [
                {
                    "type": "team",
                    "text": r[0],
                    "url": f"/team/{quote(r[0])}",
                    "meta": r[1],
                }
                for r in cur.fetchall()
            ]

            # Heroes (substring match — hero names are single words)
            from ..heroes import get_all_hero_names

            hero_hits = [
                (int(hid), str(hname))
                for hid, hname in get_all_hero_names().items()
                if q.lower() in str(hname).lower()
            ]
            hero_hits.sort(key=lambda item: item[1].lower())
            results += [
                {"type": "hero", "text": hname, "url": f"/hero/{hid}"}
                for hid, hname in hero_hits[:5]
            ]

    return jsonify({"results": results})


# ── Twitch live status ────────────────────────────────────────────────────
# Drives the home page stream strip / widget. Credentials are read from the
# environment (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET); when they are absent
# the endpoint reports configured=false and the UI degrades to a plain link.
_twitch_token_lock = threading.Lock()
_twitch_token: Dict[str, Any] = {"token": None, "expires_at": 0.0}


def _twitch_app_token(client_id: str, client_secret: str) -> str | None:
    """Return a memoized app access token via the client-credentials flow."""
    now = time.time()
    with _twitch_token_lock:
        token = _twitch_token.get("token")
        if token and float(_twitch_token.get("expires_at") or 0) > now + 60:
            return token

    try:
        resp = requests.post(
            "https://id.twitch.tv/oauth2/token",
            params={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
            timeout=3,
        )
    except requests.RequestException:
        return None

    if resp.status_code != 200:
        return None

    payload = resp.json() or {}
    token = payload.get("access_token")
    if not token:
        return None

    expires_in = int(payload.get("expires_in") or 0)
    with _twitch_token_lock:
        _twitch_token["token"] = token
        _twitch_token["expires_at"] = now + max(expires_in - 60, 60)
    return token


@bp.get("/stream/status")
@cache.cached(timeout=60)
def stream_status():  # type: ignore
    """Live/offline state for the DLNS Twitch channel.

    Response fields:
      configured   – whether Twitch credentials are present
      channel      – login name being checked
      channel_url  – link to open the channel
      live         – true when a stream is currently up
      title/game_name/viewer_count/started_at – set while live
      display_name/avatar_url – channel identity, when it can be resolved
      next_stream  – {start_time, title, category} from the channel schedule

    While a stream is live the identity and schedule lookups are skipped, so the
    live path costs one token request plus one /helix/streams request.
    """
    channel = (os.getenv("TWITCH_CHANNEL") or "deadlocknightshift").strip().lower()
    channel_url = f"https://www.twitch.tv/{channel}"
    client_id = (os.getenv("TWITCH_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("TWITCH_CLIENT_SECRET") or "").strip()

    payload: Dict[str, Any] = {
        "configured": bool(client_id and client_secret),
        "channel": channel,
        "channel_url": channel_url,
        "live": False,
        "title": None,
        "game_name": None,
        "viewer_count": None,
        "started_at": None,
        "next_stream": None,
        "checked_at": int(time.time()),
    }

    if not payload["configured"]:
        return jsonify(payload)

    token = _twitch_app_token(client_id, client_secret)
    if not token:
        payload["error"] = "auth"
        return jsonify(payload)

    headers = {"Client-Id": client_id, "Authorization": f"Bearer {token}"}

    try:
        resp = requests.get(
            "https://api.twitch.tv/helix/streams",
            params={"user_login": channel},
            headers=headers,
            timeout=3,
        )
        if resp.status_code == 200:
            data = (resp.json() or {}).get("data") or []
            if data:
                stream = data[0]
                payload.update(
                    {
                        "live": True,
                        "title": stream.get("title"),
                        "game_name": stream.get("game_name"),
                        "viewer_count": stream.get("viewer_count"),
                        "started_at": stream.get("started_at"),
                        # /helix/streams already reports the display name, so a
                        # live stream needs no /helix/users round trip.
                        "display_name": stream.get("user_name"),
                    }
                )
        elif resp.status_code == 401:
            # Token expired early — clear it so the next request re-authenticates.
            with _twitch_token_lock:
                _twitch_token["token"] = None
                _twitch_token["expires_at"] = 0.0
        else:
            payload["error"] = f"streams:{resp.status_code}"
    except requests.RequestException:
        payload["error"] = "network"
        return jsonify(payload)

    # While a stream is up there is nothing else to look up — skipping the
    # identity and schedule calls keeps the live path to two HTTP calls.
    if payload["live"]:
        return jsonify(payload)

    # Channel identity — needed for the display name and the schedule call.
    broadcaster_id = None
    try:
        user_resp = requests.get(
            "https://api.twitch.tv/helix/users",
            params={"login": channel},
            headers=headers,
            timeout=3,
        )
        if user_resp.status_code == 200:
            users = (user_resp.json() or {}).get("data") or []
            if users:
                broadcaster_id = users[0].get("id")
                payload["display_name"] = users[0].get("display_name")
                payload["avatar_url"] = users[0].get("profile_image_url")
    except requests.RequestException:
        pass

    if not broadcaster_id:
        return jsonify(payload)

    # Next scheduled stream, when the channel publishes a schedule.
    try:
        sched_resp = requests.get(
            "https://api.twitch.tv/helix/schedule",
            params={"broadcaster_id": broadcaster_id, "first": 1},
            headers=headers,
            timeout=3,
        )
        if sched_resp.status_code == 200:
            segments = ((sched_resp.json() or {}).get("data") or {}).get("segments") or []
            if segments:
                segment = segments[0]
                payload["next_stream"] = {
                    "start_time": segment.get("start_time"),
                    "title": segment.get("title"),
                    "category": (segment.get("category") or {}).get("name"),
                }
    except requests.RequestException:
        pass

    return jsonify(payload)


@bp.get("/heroes")
@cache.cached(timeout=21600)  # Cache for 6 hours
def get_heroes():
    """Return hero ID to name mapping for JavaScript."""
    from ..heroes import _load_if_needed, _names, _lock
    
    with _lock:
        _load_if_needed()
        # Return the heroes dict directly - this will be the flat ID->name mapping
        return jsonify(_names)


@bp.get("/heroes/trending")
@cache.cached(timeout=1800)
def heroes_trending():
    """Win rate per hero for the two most recent Night Shift weeks.

    Powers the Heroes list page: the "Trending This Week" strip and the
    week-over-week arrow on each card. Returns the two weeks compared plus a
    per-hero map keyed by hero id, so the client can decorate a hero selection
    table it already has without a second round trip.

    Both queries are restricted to the Night Shift series: `event_week` is only
    unique within a series (week 1 holds `Night Shift` AND `Night Shift Open 1`),
    so selecting by week alone would fold an unrelated qualifier into the trend.
    """
    with get_ro_conn() as conn:
        weeks = [
            row[0]
            for row in conn.execute(
                f"""
                SELECT DISTINCT m.event_week
                FROM matches m
                WHERE m.event_week IS NOT NULL AND m.match_id > 0
                  AND {NIGHT_SHIFT_TITLE_SQL}
                ORDER BY m.event_week DESC
                LIMIT 2
                """
            ).fetchall()
        ]
        if len(weeks) < 2:
            return jsonify({"current_week": weeks[0] if weeks else None, "previous_week": None, "heroes": {}})

        current_week, previous_week = weeks[0], weeks[1]
        rows = conn.execute(
            f"""
            SELECT m.event_week, p.hero_id, COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE m.event_week IN (?, ?) AND p.hero_id IS NOT NULL
               AND {NIGHT_SHIFT_TITLE_SQL}
             GROUP BY m.event_week, p.hero_id
            """,
            (current_week, previous_week),
        ).fetchall()

    heroes: Dict[str, Dict[str, Any]] = {}
    for week, hero_id, games, wins in rows:
        entry = heroes.setdefault(str(int(hero_id)), {})
        entry["current" if week == current_week else "previous"] = {
            "week": week,
            "games": int(games or 0),
            "win_rate": (wins / games) if games else None,
        }

    return jsonify(
        {
            "current_week": current_week,
            "previous_week": previous_week,
            "heroes": heroes,
        }
    )


@bp.get("/heroes/<int:hero_id>/stats")
@cache.cached(timeout=1800)
def hero_stats(hero_id: int):
    """Return aggregated stats for a specific hero across all matches.

    Alongside the per-game averages this returns per-minute rates, which the
    hero profile's headline tiles and Combat & Economy panel compare against the
    league: the match duration is summed so the rate is the true total-over-total
    rather than an average of per-game rates.
    """
    with get_ro_conn() as conn:
        cur = conn.execute(
            """
            SELECT
                COUNT(*) as games_played,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as wins,
                ROUND(AVG(p.kills), 2) as avg_kills,
                ROUND(AVG(p.deaths), 2) as avg_deaths,
                ROUND(AVG(p.assists), 2) as avg_assists,
                ROUND(AVG(CAST(p.kills + p.assists AS REAL) / MAX(p.deaths, 1)), 2) as avg_kda,
                ROUND(AVG(p.player_damage), 0) as avg_damage,
                ROUND(AVG(p.obj_damage), 0) as avg_obj_damage,
                ROUND(AVG(p.player_healing), 0) as avg_healing,
                ROUND(AVG(p.net_worth), 0) as avg_souls,
                ROUND(AVG(m.duration_s), 0) as avg_duration,
                ROUND(SUM(p.player_damage) / (SUM(m.duration_s) / 60.0), 0) as damage_per_min,
                ROUND(SUM(p.net_worth) / (SUM(m.duration_s) / 60.0), 0) as souls_per_min,
                ROUND(SUM(p.kills) / (SUM(m.duration_s) / 60.0), 2) as kills_per_min,
                ROUND(SUM(p.deaths) / (SUM(m.duration_s) / 60.0), 2) as deaths_per_min,
                ROUND(SUM(p.assists) / (SUM(m.duration_s) / 60.0), 2) as assists_per_min,
                MAX(p.kills) as max_kills,
                MAX(p.player_damage) as max_damage,
                MAX(p.player_healing) as max_healing,
                MAX(p.obj_damage) as max_obj_damage
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.hero_id = ?
            """,
            (hero_id,)
        )
        row = cur.fetchone()
        if not row:
            return jsonify({"stats": None})
        cols = [c[0] for c in cur.description]
        stats = dict(zip(cols, row))

        # Pick rate = hero games / total match-player rows
        total_cur = conn.execute("SELECT COUNT(*) FROM players WHERE account_id IS NOT NULL")
        total = total_cur.fetchone()[0]
        stats["pick_rate"] = round(stats["games_played"] / total, 4) if total else 0
        stats["win_rate"] = round(stats["wins"] / stats["games_played"], 4) if stats["games_played"] else 0

        return jsonify({"stats": stats})


@bp.get("/heroes/<int:hero_id>/top_items")
@cache.cached(timeout=1800)
def hero_top_items(hero_id: int):
    """Return most-purchased items for a specific hero, ranked by frequency."""
    # Reuse cached item catalog
    item_catalog = cache.get("dlns_items_list")
    if item_catalog is None:
        try:
            resp = requests.get(
                ITEMS_URL,
                params={"language": "english"},
                timeout=3,
            )
            resp.raise_for_status()
            item_catalog = resp.json()
            cache.set("dlns_items_list", item_catalog, timeout=600)
        except Exception as e:
            current_app.logger.warning("Item catalog unavailable: %s", e)
            return jsonify({"items": []})

    item_lookup: dict = {}
    for item in (item_catalog if isinstance(item_catalog, list) else []):
        iid = item.get("id")
        if iid is not None:
            item_lookup[int(iid)] = {
                "name": item.get("name", ""),
                "item_slot_type": item.get("item_slot_type", ""),
                "item_tier": item.get("item_tier"),
                "shopable": item.get("shopable", False),
                "cost": item.get("cost", 0),
            }

    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT items FROM players WHERE hero_id = ? AND items IS NOT NULL",
            (hero_id,),
        )
        rows = cur.fetchall()

    from collections import Counter
    counts: Counter = Counter()
    total_games = 0
    for (items_json,) in rows:
        try:
            item_ids = json.loads(items_json)
        except Exception:
            continue
        total_games += 1
        for iid in item_ids:
            try:
                counts[int(iid)] += 1
            except (ValueError, TypeError):
                pass

    result = []
    for iid, count in counts.most_common(50):
        meta = item_lookup.get(iid)
        if not meta or not meta.get("name"):
            continue
        # Skip abilities and non-purchasable entries
        if not meta.get("shopable") and not (meta.get("cost") or 0) > 0:
            continue
        result.append({
            "id": iid,
            "name": meta["name"],
            "item_slot_type": meta["item_slot_type"],
            "item_tier": meta["item_tier"],
            "count": count,
            "pick_rate": round(count / total_games, 4) if total_games else 0,
        })
        if len(result) == 10:
            break

    return jsonify({"items": result, "total_games": total_games})


@bp.get("/heroes/<int:hero_id>/matchups")
@cache.cached(timeout=1800)
def hero_matchups(hero_id: int):
    """Return heroes most effective with/against a specific hero."""
    MIN_GAMES = 3
    with get_ro_conn() as conn:
        # Most effective WITH (same team, ranked by win rate)
        with_cur = conn.execute(
            """
            SELECT
                ally.hero_id,
                COUNT(*) as games,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as wins
            FROM players p
            JOIN players ally
                ON ally.match_id = p.match_id
                AND ally.team = p.team
                AND ally.hero_id != p.hero_id
            WHERE p.hero_id = ?
            GROUP BY ally.hero_id
            HAVING games >= ?
            ORDER BY CAST(wins AS REAL) / games DESC
            LIMIT 5
            """,
            (hero_id, MIN_GAMES),
        )
        with_rows = _rows_to_dicts(with_cur)

        # Most effective AGAINST (opposite team, ranked by win rate)
        against_cur = conn.execute(
            """
            SELECT
                opp.hero_id,
                COUNT(*) as games,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as wins
            FROM players p
            JOIN players opp
                ON opp.match_id = p.match_id
                AND opp.team != p.team
            WHERE p.hero_id = ?
            GROUP BY opp.hero_id
            HAVING games >= ?
            ORDER BY CAST(wins AS REAL) / games DESC
            LIMIT 5
            """,
            (hero_id, MIN_GAMES),
        )
        against_rows = _rows_to_dicts(against_cur)

    def enrich(rows):
        for r in rows:
            gp = r["games"] or 0
            r["win_rate"] = round(r["wins"] / gp, 4) if gp else 0
        return rows

    return jsonify({
        "effective_with": enrich(with_rows),
        "effective_against": enrich(against_rows),
    })


@bp.get("/heroes/<int:hero_id>/top_players")
@cache.cached(timeout=1800)
def hero_top_players(hero_id: int):
    """Return top players by games played on a specific hero."""
    with get_ro_conn() as conn:
        cur = conn.execute(
            """
            SELECT
                p.account_id,
                u.persona_name,
                u.avatar_url,
                COUNT(*) as games_played,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as wins
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.account_id IS NOT NULL
            GROUP BY p.account_id, u.persona_name
            ORDER BY games_played DESC
            LIMIT 10
            """,
            (hero_id,)
        )
        rows = _rows_to_dicts(cur)
        for row in rows:
            gp = row["games_played"] or 0
            row["win_rate"] = round(row["wins"] / gp, 4) if gp else 0
        return jsonify({"players": rows})


@bp.get("/heroes/<int:hero_id>/bans")
@cache.cached(timeout=60)  # short, so bans saved in the bracket editor show up quickly
def hero_bans(hero_id: int):  # type: ignore
    """Ban stats for one hero, over the games that have a ban draft recorded.

    Rates use "drafted games" (games with at least one ban in match_bans) as the
    denominator, since older games were played before bans were entered.
    """
    empty = {"drafted_games": 0, "bans": 0, "ban_rate": 0.0, "first_bans": 0, "by_order": {}, "by_week": {},
             "picks": 0, "presence": 0.0, "banner_wins": 0, "banner_win_rate": None,
             "teams": [], "recent": []}
    with get_ro_conn() as conn:
        try:
            drafted = conn.execute("SELECT COUNT(DISTINCT match_id) FROM match_bans").fetchone()[0] or 0
        except sqlite3.OperationalError:
            return jsonify(empty)  # DB from before match_bans existed
        rows = conn.execute(
            """
            SELECT b.match_id, b.ban_order, b.team, b.team_name,
                   m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.winning_team,
                   m.event_title, m.event_week, m.start_time
            FROM match_bans b JOIN matches m ON m.match_id = b.match_id
            WHERE b.hero_id = ?
            ORDER BY m.start_time DESC, b.match_id DESC
            """,
            (hero_id,),
        ).fetchall()
        # Games where the hero was picked, among games that had a ban draft.
        picks = conn.execute(
            "SELECT COUNT(DISTINCT p.match_id) FROM players p "
            "WHERE p.hero_id = ? AND p.match_id IN (SELECT DISTINCT match_id FROM match_bans)",
            (hero_id,),
        ).fetchone()[0] or 0

    by_order: Dict[str, int] = {}
    by_week: Dict[str, int] = {}
    teams: Dict[str, int] = {}
    banner_wins = decided = 0
    recent = []
    for (mid, order, team, team_name, team_a, team_b, a_side, winning, title, week, start) in rows:
        by_order[str(order)] = by_order.get(str(order), 0) + 1
        if week is not None:
            by_week[str(week)] = by_week.get(str(week), 0) + 1
        name = team_name or (team_a if team == "team_a" else team_b) or "Unknown"
        teams[name] = teams.get(name, 0) + 1
        if a_side in (0, 1) and winning in (0, 1):
            side = int(a_side) if team == "team_a" else 1 - int(a_side)
            decided += 1
            banner_wins += int(int(winning) == side)
        if len(recent) < 8:
            recent.append({
                "match_id": mid,
                "order": order,
                "team_name": name,
                "against": (team_b if team == "team_a" else team_a) or None,
                "event_title": title,
                "event_week": week,
                "start_time": start,
            })
    bans = len(rows)
    return jsonify({
        "drafted_games": drafted,
        "bans": bans,
        "ban_rate": bans / drafted if drafted else 0.0,
        "first_bans": by_order.get("1", 0),
        "by_order": by_order,
        "by_week": by_week,
        "picks": picks,
        "presence": (bans + picks) / drafted if drafted else 0.0,
        "banner_wins": banner_wins,
        "banner_win_rate": banner_wins / decided if decided else None,
        "teams": [{"team": t, "bans": n} for t, n in sorted(teams.items(), key=lambda kv: (-kv[1], kv[0]))[:5]],
        "recent": recent,
    })


@bp.get("/heroes/<int:hero_id>/meta")
@cache.cached(timeout=21600)
def hero_meta(hero_id: int):
    """Return curated metadata (tagline + abilities) for a specific hero."""
    meta_path = Path(current_app.root_path).parent.parent / "data" / "hero_meta.json"
    try:
        with open(meta_path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return jsonify({"error": "meta data unavailable"}), 503

    entry = data.get(str(hero_id))
    if entry is None:
        return jsonify({"error": "not found"}), 404

    return jsonify(entry)


def _per_minute(total: Any, seconds: Any) -> Optional[float]:
    minutes = (seconds or 0) / 60.0
    return (total / minutes) if minutes and total is not None else None


def _combat_stats(row: Any) -> Dict[str, Any]:
    """Map a combat aggregate row onto the Combat & Economy cells.

    Column order is the one both the hero and the league query select, so the two
    sides of every "avg X +/-delta" comparison are built the same way.
    """
    if row is None:
        row = (0,) * 19
    hits = row[7] or 0
    misses = row[8] or 0
    return {
        "games": row[0] or 0,
        "kills_per_min": _per_minute(row[1], row[4]),
        "deaths_per_min": _per_minute(row[2], row[4]),
        "assists_per_min": _per_minute(row[3], row[4]),
        "last_hits": row[5],
        "denies": row[6],
        "hit_pct": (hits / (hits + misses)) if (hits + misses) else None,
        "obj_damage": row[9],
        "healing": row[10],
        "pings": row[11],
        "level": row[12],
        "avg_duration": row[13],
        "kills": row[14],
        "deaths": row[15],
        "assists": row[16],
        "damage": row[17],
        "souls": row[18],
    }


@bp.get("/heroes/<int:hero_id>/profile")
@cache.cached(timeout=1800)
def hero_profile(hero_id: int):
    """Everything the Hero detail page renders, for the whole Night Shift league run.

    The whole league is the only scope: per-week samples are far too small for a
    hero to be meaningful, so the page compares against the league average
    instead of against itself in a narrower window. The range itself comes from
    `night_shift_scope`, so it tracks the newest ingested week automatically.

    The per-hero table is built for EVERY hero, which is what lets the page rank
    this hero, average the league baseline, and compare against any other hero
    (head-to-head) without a second round trip.
    """
    from ..heroes import get_all_hero_names

    hero_names = get_all_hero_names()
    slots = _hero_ability_slots().get(hero_id) or {"abilities": [], "slots": {}}

    with get_ro_conn() as conn:
        fragment, scope_label = night_shift_scope(conn)
        fragment_params: Tuple[Any, ...] = ()
        where_params = (hero_id,) + fragment_params

        total_matches = conn.execute(
            "SELECT COUNT(*) FROM matches m WHERE m.match_id > 0" + fragment,
            fragment_params,
        ).fetchone()[0] or 0

        per_hero_rows = conn.execute(
            f"""
            SELECT p.hero_id,
                   COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided,
                   AVG(CAST(p.kills + p.assists AS REAL) / MAX(COALESCE(p.deaths, 0), 1)) AS kda,
                   SUM(p.player_damage) AS damage,
                   SUM(p.net_worth) AS souls,
                   SUM(m.duration_s) AS seconds,
                   SUM(p.deaths) AS deaths,
                   SUM(p.kills) AS kills,
                   SUM(p.assists) AS assists
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id IS NOT NULL{fragment}
             GROUP BY p.hero_id
            """,
            fragment_params,
        ).fetchall()

        mine = conn.execute(
            """
            SELECT p.match_id, p.team, p.result, p.kills, p.deaths, p.assists,
                   p.net_worth, p.player_damage, p.ability_order,
                   m.duration_s, m.winning_team
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?
            """
            + fragment
            + """
             ORDER BY COALESCE(m.start_time, m.created_at) ASC
            """,
            where_params,
        ).fetchall()

        weekly_rows = conn.execute(
            f"""
            SELECT m.event_week,
                   COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?{fragment}
             GROUP BY m.event_week
             ORDER BY m.event_week ASC
            """,
            where_params,
        ).fetchall()
        # Same scope as the per-hero series, so the pick-rate denominators add up to
        # `total_matches` rather than drifting away from it.
        week_totals = dict(
            conn.execute(
                "SELECT m.event_week, COUNT(*) FROM matches m"
                " WHERE m.match_id > 0" + fragment + " GROUP BY m.event_week"
            ).fetchall()
        )

        recent_rows = conn.execute(
            """
            SELECT p.match_id, p.team, p.result, p.kills, p.deaths, p.assists,
                   m.duration_s, m.winning_team, m.event_week,
                   u.persona_name, p.account_id,
                   m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                   m.event_game, COALESCE(m.start_time, m.created_at) AS played
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
              LEFT JOIN users u ON u.account_id = p.account_id
             WHERE p.hero_id = ?
            """
            + fragment
            + """
             ORDER BY COALESCE(m.start_time, m.created_at) DESC
             LIMIT 8
            """,
            where_params,
        ).fetchall()

        combat = conn.execute(
            f"""
            SELECT COUNT(*) AS games,
                   SUM(p.kills) AS kills, SUM(p.deaths) AS deaths, SUM(p.assists) AS assists,
                   SUM(m.duration_s) AS seconds,
                   ROUND(AVG(p.last_hits), 1) AS last_hits,
                   ROUND(AVG(p.denies), 1) AS denies,
                   SUM(p.shots_hit) AS shots_hit, SUM(p.shots_missed) AS shots_missed,
                   ROUND(AVG(p.obj_damage), 0) AS obj_damage,
                   ROUND(AVG(p.player_healing), 0) AS healing,
                   ROUND(AVG(p.pings_count), 1) AS pings,
                   ROUND(AVG(p.level), 1) AS level,
                   ROUND(AVG(m.duration_s), 0) AS avg_duration,
                   ROUND(AVG(p.kills), 2) AS avg_kills,
                   ROUND(AVG(p.deaths), 2) AS avg_deaths,
                   ROUND(AVG(p.assists), 2) AS avg_assists,
                   ROUND(AVG(p.player_damage), 0) AS avg_player_damage,
                   ROUND(AVG(p.net_worth), 0) AS avg_net_worth
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?{fragment}
            """,
            where_params,
        ).fetchone()

        combat_league = conn.execute(
            f"""
            SELECT COUNT(*) AS games,
                   SUM(p.kills) AS kills, SUM(p.deaths) AS deaths, SUM(p.assists) AS assists,
                   SUM(m.duration_s) AS seconds,
                   ROUND(AVG(p.last_hits), 1) AS last_hits,
                   ROUND(AVG(p.denies), 1) AS denies,
                   SUM(p.shots_hit) AS shots_hit, SUM(p.shots_missed) AS shots_missed,
                   ROUND(AVG(p.obj_damage), 0) AS obj_damage,
                   ROUND(AVG(p.player_healing), 0) AS healing,
                   ROUND(AVG(p.pings_count), 1) AS pings,
                   ROUND(AVG(p.level), 1) AS level,
                   ROUND(AVG(m.duration_s), 0) AS avg_duration,
                   ROUND(AVG(p.kills), 2) AS avg_kills,
                   ROUND(AVG(p.deaths), 2) AS avg_deaths,
                   ROUND(AVG(p.assists), 2) AS avg_assists,
                   ROUND(AVG(p.player_damage), 0) AS avg_player_damage,
                   ROUND(AVG(p.net_worth), 0) AS avg_net_worth
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id IS NOT NULL{fragment}
            """,
            fragment_params,
        ).fetchone()

        item_rows = conn.execute(
            """
            SELECT p.match_id,
                   json_extract(entry.value, '$.item_id') AS item_id,
                   json_extract(entry.value, '$.game_time_s') AS game_time_s
              FROM players p,
                   json_each(p.raw_items_json) AS entry
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?
               AND p.raw_items_json IS NOT NULL
               AND json_extract(entry.value, '$.item_id') IS NOT NULL
               AND COALESCE(json_extract(entry.value, '$.sold_time_s'), 0) = 0
            """
            + fragment,
            where_params,
        ).fetchall()

        matchup_rows = {}
        for key, ally in (("against", False), ("with", True)):
            operator = "=" if ally else "<>"
            extra = " AND e.hero_id <> p.hero_id" if ally else ""
            matchup_rows[key] = conn.execute(
                f"""
                SELECT e.hero_id,
                       COUNT(*) AS games,
                       SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                       SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided
                  FROM players p
                  JOIN matches m ON m.match_id = p.match_id
                  JOIN players e ON e.match_id = p.match_id AND e.team {operator} p.team{extra}
                 WHERE p.hero_id = ? AND p.team IN (0, 1) AND e.team IN (0, 1){fragment}
                 GROUP BY e.hero_id
                 ORDER BY games DESC, e.hero_id ASC
                """,
                where_params,
            ).fetchall()

        lane_assigned = dict(
            conn.execute(
                "SELECT p.lane, COUNT(*) FROM players p JOIN matches m ON m.match_id = p.match_id"
                f" WHERE p.hero_id = ? AND p.lane IS NOT NULL{fragment} GROUP BY p.lane",
                where_params,
            ).fetchall()
        )
        lane_actual = dict(
            conn.execute(
                "SELECT p.lane_real, COUNT(*) FROM players p JOIN matches m ON m.match_id = p.match_id"
                f" WHERE p.hero_id = ? AND p.lane_real IS NOT NULL{fragment} GROUP BY p.lane_real",
                where_params,
            ).fetchall()
        )
        lane_total, lane_stayed = conn.execute(
            "SELECT COUNT(*), SUM(CASE WHEN p.lane_real IS NULL OR p.lane IS NULL OR p.lane_real = p.lane THEN 1 ELSE 0 END)"
            " FROM players p JOIN matches m ON m.match_id = p.match_id"
            f" WHERE p.hero_id = ?{fragment}",
            where_params,
        ).fetchone()

        side_rows = conn.execute(
            f"""
            SELECT p.team, COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ? AND p.team IN (0, 1){fragment}
             GROUP BY p.team
            """,
            where_params,
        ).fetchall()

        length_rows = conn.execute(
            f"""
            SELECT CASE
                     WHEN m.duration_s < 1500 THEN 'under25'
                     WHEN m.duration_s < 2100 THEN 'mid'
                     ELSE 'over35'
                   END AS bucket,
                   COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ? AND m.duration_s IS NOT NULL{fragment}
             GROUP BY bucket
            """,
            where_params,
        ).fetchall()

        souls_hero = conn.execute(
            """
            SELECT CAST(s.time_stamp_s / 60 AS INTEGER) AS minute, AVG(s.net_worth)
              FROM player_snapshots s
              JOIN players p ON p.match_id = s.match_id AND p.account_id = s.account_id
              JOIN matches m ON m.match_id = p.match_id
             WHERE p.hero_id = ?
               AND p.account_id IS NOT NULL
               AND s.time_stamp_s IS NOT NULL
               AND s.time_stamp_s BETWEEN 60 AND 2400
            """
            + fragment
            + " GROUP BY minute ORDER BY minute",
            where_params,
        ).fetchall()
        souls_league = conn.execute(
            """
            SELECT CAST(s.time_stamp_s / 60 AS INTEGER) AS minute, AVG(s.net_worth)
              FROM player_snapshots s
              JOIN matches m ON m.match_id = s.match_id
             WHERE s.time_stamp_s IS NOT NULL
               AND s.time_stamp_s BETWEEN 60 AND 2400
            """
            + fragment
            + " GROUP BY minute ORDER BY minute",
            fragment_params,
        ).fetchall()

        record_specs = (
            ("highest_damage", "p.player_damage", None),
            ("most_kills", "p.kills", None),
            ("most_healing", "p.player_healing", None),
            ("fastest_win", "m.duration_s", "ASC"),
        )
        records = {}
        for key, column, direction in record_specs:
            order = direction or "DESC"
            row = conn.execute(
                f"""
                SELECT u.persona_name, p.account_id, p.match_id, {column} AS value
                  FROM players p
                  JOIN matches m ON m.match_id = p.match_id
                  LEFT JOIN users u ON u.account_id = p.account_id
                 WHERE p.hero_id = ? AND {column} IS NOT NULL{fragment}
                """
                + (" AND m.duration_s > 0" if key == "fastest_win" else "")
                + f" ORDER BY {column} {order} LIMIT 1",
                where_params,
            ).fetchone()
            if row is None:
                continue
            if key == "fastest_win":
                won = conn.execute(
                    f"SELECT 1 FROM players p JOIN matches m ON m.match_id = p.match_id"
                    f" WHERE p.match_id = ? AND {MATCH_WON_SQL} = 1 LIMIT 1",
                    (row[2],),
                ).fetchone()
                if won is None:
                    continue
            records[key] = {
                "value": row[3],
                "persona_name": row[0],
                "account_id": row[1],
                "match_id": row[2],
            }

        top_players = conn.execute(
            f"""
            SELECT p.account_id, u.persona_name, u.avatar_url,
                   COUNT(*) AS games,
                   SUM(CASE WHEN {MATCH_WON_SQL} = 1 THEN 1 ELSE 0 END) AS wins,
                   SUM(CASE WHEN {MATCH_WON_SQL} IS NOT NULL THEN 1 ELSE 0 END) AS decided,
                   AVG(CAST(p.kills + p.assists AS REAL) / MAX(COALESCE(p.deaths, 0), 1)) AS kda,
                   ROUND(AVG(p.player_damage), 0) AS damage_per_game,
                   ROUND(AVG(p.net_worth), 0) AS souls_per_game,
                   SUM(p.player_damage) AS damage,
                   SUM(p.net_worth) AS souls, SUM(m.duration_s) AS seconds
              FROM players p
              JOIN matches m ON m.match_id = p.match_id
              LEFT JOIN users u ON u.account_id = p.account_id
             WHERE p.hero_id = ? AND p.account_id IS NOT NULL{fragment}
             GROUP BY p.account_id
             ORDER BY games DESC
             LIMIT 10
            """,
            where_params,
        ).fetchall()

    def per_minute(total: Any, seconds: Any) -> Optional[float]:
        return _per_minute(total, seconds)

    per_hero = [
        {
            "hero_id": int(row[0]),
            "hero_name": hero_names.get(str(int(row[0])), f"Hero {row[0]}"),
            "games": row[1],
            "wins": row[2] or 0,
            "decided": row[3] or 0,
            "win_rate": (row[2] / row[3]) if row[3] else None,
            "pick_rate": (row[1] / total_matches) if total_matches else None,
            "kda": row[4],
            "damage_per_min": per_minute(row[5], row[7]),
            "souls_per_min": per_minute(row[6], row[7]),
            "deaths_per_min": per_minute(row[8], row[7]),
            "damage_per_game": (row[5] / row[1]) if row[1] else None,
            "souls_per_game": (row[6] / row[1]) if row[1] else None,
            "deaths_per_game": (row[8] / row[1]) if row[1] else None,
            "kills_per_game": (row[9] / row[1]) if row[1] else None,
            "assists_per_game": (row[10] / row[1]) if row[1] else None,
        }
        for row in per_hero_rows
    ]
    me = next((row for row in per_hero if row["hero_id"] == hero_id), None)

    def mean_of(key: str) -> Optional[float]:
        values = [row[key] for row in per_hero if row[key] is not None]
        return sum(values) / len(values) if values else None

    def rank_of(key: str) -> Optional[Dict[str, Any]]:
        ranked = sorted(
            (row for row in per_hero if row[key] is not None),
            key=lambda row: row[key],
            reverse=True,
        )
        for index, row in enumerate(ranked, start=1):
            if row["hero_id"] == hero_id:
                return {"rank": index, "of": len(ranked), "value": row[key]}
        return None

    games = len(mine)
    losses = sum(1 for row in mine if _match_won(row[1], row[10], row[2]) is False)
    wins = sum(1 for row in mine if _match_won(row[1], row[10], row[2]) is True)

    # Items: id -> whether the hero won with it, its buy times, and its slot.
    catalog = _item_catalog()
    item_stats: Dict[int, Dict[str, Any]] = {}
    games_with_items = set()
    for match_id, item_id, game_time_s in item_rows:
        try:
            key = int(item_id)
        except (TypeError, ValueError):
            continue
        games_with_items.add(match_id)
        bucket = item_stats.setdefault(key, {"games": set(), "times": []})
        bucket["games"].add(match_id)
        if game_time_s is not None:
            bucket["times"].append(float(game_time_s))

    def median(values: List[float]) -> Optional[float]:
        if not values:
            return None
        ordered = sorted(values)
        middle = len(ordered) // 2
        if len(ordered) % 2:
            return ordered[middle]
        return (ordered[middle - 1] + ordered[middle]) / 2

    by_slot: Dict[str, List[Dict[str, Any]]] = {"weapon": [], "vitality": [], "spirit": []}
    for item_id, bucket in item_stats.items():
        meta = catalog.get(item_id)
        if not meta or meta.get("type") == "ability":
            continue
        slot = meta.get("slot")
        if slot not in by_slot:
            continue
        bought = len(bucket["games"])
        by_slot[slot].append(
            {
                "item_id": item_id,
                "item_name": meta["name"],
                "tier": meta["tier"],
                "slot": slot,
                "icon": meta["icon"],
                "games": bought,
                "share": bought / games if games else None,
                "median_time_s": median(bucket["times"]),
            }
        )
    for entries in by_slot.values():
        entries.sort(key=lambda entry: (-entry["games"], entry["item_name"]))
        del entries[5:]

    def matchup_table(rows: List[Any]) -> List[Dict[str, Any]]:
        return [
            {
                "hero_id": int(row[0]),
                "hero_name": hero_names.get(str(int(row[0])), f"Hero {row[0]}"),
                "games": row[1],
                "wins": row[2] or 0,
                "decided": row[3] or 0,
                "win_rate": (row[2] / row[3]) if row[3] else None,
            }
            for row in rows
        ]

    lane_rows = [
        {
            "lane": lane,
            "assigned": lane_assigned.get(lane, 0),
            "actual": lane_actual.get(lane, 0),
        }
        for lane in (1, 4, 6)
    ]

    # A DENSE weekly series: a week the hero was not picked is a real zero, not a
    # missing row. Without this the bars would silently re-space the x-axis and a
    # rolling window would skip absent weeks instead of counting them.
    rows_by_week = {row[0]: row for row in weekly_rows}
    weekly_series: List[Dict[str, Any]] = []
    for week in sorted(week_totals):
        row = rows_by_week.get(week)
        # Deliberately NOT named `games`/`wins`/`decided`: those are the hero's own
        # totals further up and would be clobbered for the whole payload.
        week_games = row[1] if row else 0
        week_wins = (row[2] or 0) if row else 0
        week_decided = (row[3] or 0) if row else 0
        week_total = week_totals.get(week) or 0
        weekly_series.append(
            {
                "week": week,
                "games": week_games,
                "wins": week_wins,
                "decided": week_decided,
                "win_rate": (week_wins / week_decided) if week_decided else None,
                "pick_rate": (week_games / week_total) if week_total else None,
            }
        )

    return jsonify(
        {
            "hero_id": hero_id,
            "hero_name": hero_names.get(str(hero_id), f"Hero {hero_id}"),
            "scope": {"id": "league", "label": scope_label},
            "total_matches": total_matches,
            "games": games,
            "wins": wins,
            "losses": losses,
            "decided": wins + losses,
            "win_rate": (wins / (wins + losses)) if (wins + losses) else None,
            "league": {
                "heroes": len(per_hero),
                "win_rate": mean_of("win_rate"),
                "pick_rate": mean_of("pick_rate"),
                "kda": mean_of("kda"),
                "damage_per_min": mean_of("damage_per_min"),
                "souls_per_min": mean_of("souls_per_min"),
            },
            "rank": {
                "by_games": rank_of("games"),
                "by_wins": rank_of("wins"),
                "by_pick_rate": rank_of("pick_rate"),
                "by_win_rate": rank_of("win_rate"),
            },
            "per_hero": per_hero,
            "weekly": weekly_series,
            "recent": [
                {
                    "match_id": row[0],
                    "result": _match_won(row[1], row[7], row[2]),
                    "side": row[1] if row[1] in (0, 1) else None,
                    "kills": row[3],
                    "deaths": row[4],
                    "assists": row[5],
                    "duration_s": row[6],
                    "event_week": row[8],
                    "persona_name": row[9],
                    "account_id": row[10],
                    "team_a": row[11],
                    "team_b": row[12],
                    "team_a_side": row[13],
                    "event_game": row[14],
                    "played": row[15],
                }
                for row in recent_rows
            ],
            "combat": {
                **_combat_stats(combat),
                "kda": me["kda"] if me else None,
                "damage_per_min": me["damage_per_min"] if me else None,
                "souls_per_min": me["souls_per_min"] if me else None,
            },
            "league_combat": _combat_stats(combat_league),
            "items": {
                "games": games,
                "games_with_items": len(games_with_items),
                "slots": by_slot,
            },
            "ability_builds": _ability_builds(mine, slots, games),
            "matchups": {
                "against": matchup_table(matchup_rows["against"]),
                "with": matchup_table(matchup_rows["with"]),
            },
            "lane": {
                "rows": lane_rows,
                "total": lane_total or 0,
                "stayed": lane_stayed or 0,
                "stayed_share": (lane_stayed / lane_total) if lane_total else None,
            },
            "sides": [
                {
                    "team": row[0],
                    "games": row[1],
                    "wins": row[2] or 0,
                    "decided": row[3] or 0,
                    "win_rate": (row[2] / row[3]) if row[3] else None,
                }
                for row in side_rows
            ],
            "lengths": [
                {
                    "bucket": row[0],
                    "games": row[1],
                    "wins": row[2] or 0,
                    "decided": row[3] or 0,
                    "win_rate": (row[2] / row[3]) if row[3] else None,
                }
                for row in length_rows
            ],
            "souls": {
                "hero": [{"minute": row[0], "net_worth": row[1]} for row in souls_hero],
                "league": [{"minute": row[0], "net_worth": row[1]} for row in souls_league],
            },
            "records": records,
            "top_players": [
                {
                    "account_id": row[0],
                    "persona_name": row[1],
                    "avatar_url": row[2],
                    "games": row[3],
                    "wins": row[4] or 0,
                    "decided": row[5] or 0,
                    "win_rate": (row[4] / row[5]) if row[5] else None,
                    "kda": row[6],
                    "damage_per_game": row[7],
                    "souls_per_game": row[8],
                    "damage_per_min": per_minute(row[9], row[11]),
                    "souls_per_min": per_minute(row[10], row[11]),
                }
                for row in top_players
            ],
        }
    )


@bp.get("/players")
@cache.cached(timeout=900)  # Cache for 15 minutes
def get_players():
    """Return list of all players from match data with their match count, avatar, primary team, and win rate."""
    with get_ro_conn() as conn:
        cur = conn.execute(
            """
            SELECT 
                p.account_id,
                u.persona_name,
                u.avatar_url,
                COUNT(DISTINCT p.match_id) AS match_count,
                COALESCE((
                    SELECT tt.team_name
                    FROM (
                        SELECT
                            CASE WHEN p2.team = 0 THEN m.event_team_a ELSE m.event_team_b END AS team_name,
                            COUNT(*) AS cnt
                        FROM players p2
                        JOIN matches m ON m.match_id = p2.match_id
                        WHERE p2.account_id = p.account_id
                          AND CASE WHEN p2.team = 0 THEN m.event_team_a ELSE m.event_team_b END IS NOT NULL
                        GROUP BY team_name
                        ORDER BY cnt DESC
                        LIMIT 1
                    ) tt
                ), 'Unknown') AS team_name,
                us.winrate,
                us.wins,
                us.losses
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            LEFT JOIN user_stats us ON us.account_id = p.account_id
            WHERE p.account_id IS NOT NULL
            GROUP BY p.account_id, u.persona_name, u.avatar_url, us.winrate, us.wins, us.losses
            ORDER BY match_count DESC, u.persona_name ASC
            LIMIT 500
            """
        )
        players = _rows_to_dicts(cur)
        return jsonify({"players": players})


@bp.get("/series/<int:match_id>")
@cache.cached(timeout=1800)
def series_detail(match_id: int):
    """Return all matches in the same series as match_id (same team_a, team_b, event_title, event_week)."""
    with get_ro_conn() as conn:
        ref = conn.execute(
            "SELECT event_team_a, event_team_b, event_title, event_week FROM matches WHERE match_id = ?",
            (match_id,),
        ).fetchone()
        if not ref:
            return jsonify({"error": "Match not found"}), 404

        event_team_a, event_team_b, event_title, event_week = ref
        if not event_team_a or not event_team_b:
            return jsonify({"error": "No series data for this match"}), 404

        # All matches in the series
        cur = conn.execute(
            """
            SELECT match_id, event_game, event_team_a, event_team_b, event_team_a_ingame_side,
                   winning_team, duration_s, start_time, match_vod, event_region
            FROM matches
            WHERE event_team_a = ? AND event_team_b = ?
              AND event_title = ? AND event_week = ?
            ORDER BY event_game ASC
            """,
            (event_team_a, event_team_b, event_title, event_week),
        )
        matches = _rows_to_dicts(cur)

        # Fetch players for all matches
        match_ids = [m["match_id"] for m in matches]
        players_by_match: dict = {}
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            pcur = conn.execute(
                f"""
                SELECT p.match_id, p.team, p.hero_id, p.account_id,
                       p.kills, p.deaths, p.assists, p.result,
                       u.persona_name, u.avatar_url
                FROM players p
                LEFT JOIN users u ON u.account_id = p.account_id
                WHERE p.match_id IN ({placeholders})
                ORDER BY p.team, p.player_slot
                """,
                tuple(match_ids),
            )
            for row in _rows_to_dicts(pcur):
                row["hero_name"] = get_hero_name(row["hero_id"]) if row.get("hero_id") else None
                mid = row["match_id"]
                players_by_match.setdefault(mid, []).append(row)

        for m in matches:
            m["players"] = players_by_match.get(m["match_id"], [])

    # Look up series-level title from matches.json (e.g. "EU QUALIFIER", "CHALLENGER MATCH")
    series_title = ""
    try:
        mf = _matches_json_path()
        if mf.exists():
            with open(mf, encoding="utf-8-sig") as f:
                mdata = json.load(f)
            for s in mdata.get("series") or []:
                for week in s.get("weeks") or []:
                    if week.get("week") == event_week:
                        for game in week.get("games") or []:
                            if (game.get("team_a") or "").strip().lower() == (event_team_a or "").strip().lower() \
                               and (game.get("team_b") or "").strip().lower() == (event_team_b or "").strip().lower():
                                series_title = (game.get("title") or "").strip()
                                break
    except Exception:
        pass

    return jsonify({
        "event_title": event_title,
        "event_week": event_week,
        "event_team_a": event_team_a,
        "event_team_b": event_team_b,
        "series_title": series_title,
        "matches": matches,
    })


# The teams index. One row per team (case-folded), ordered by games played so the
# list opens on the teams the league actually revolves around.
#
# Two scopes are applied, both copied from `get_team_detail` so the two pages
# cannot drift apart:
#   * "Night Shift Open 1" is excluded — its rows carry no
#     `event_team_a_ingame_side`, so a side-dependent record is not derivable for
#     it. Teams that never played anything else keep their Open games.
#   * Matches with no player rows are placeholders (several feed ids are negative
#     bracket ids); they carry no data but would inflate the counts.
_TEAMS_SQL = """
WITH playable AS (
    SELECT DISTINCT match_id FROM players WHERE match_id IS NOT NULL
),
sides AS (
    SELECT m.event_team_a AS team_name,
           m.match_id,
           m.event_week,
           (m.event_title = 'Night Shift Open 1') AS is_open,
           CASE
               WHEN m.event_team_a_ingame_side IS NOT NULL AND m.winning_team IS NOT NULL
               THEN m.winning_team = m.event_team_a_ingame_side
           END AS won
    FROM matches m
    JOIN playable pl ON pl.match_id = m.match_id
    WHERE m.event_team_a IS NOT NULL AND m.event_team_a <> ''

    UNION ALL

    SELECT m.event_team_b,
           m.match_id,
           m.event_week,
           (m.event_title = 'Night Shift Open 1'),
           CASE
               WHEN m.event_team_a_ingame_side IS NOT NULL AND m.winning_team IS NOT NULL
               THEN m.winning_team <> m.event_team_a_ingame_side
           END
    FROM matches m
    JOIN playable pl ON pl.match_id = m.match_id
    WHERE m.event_team_b IS NOT NULL AND m.event_team_b <> ''
)
SELECT
    MIN(s.team_name) AS team_name,
    COUNT(DISTINCT s.match_id) AS matches,
    SUM(CASE WHEN s.won = 1 THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN s.won = 0 THEN 1 ELSE 0 END) AS losses,
    MAX(s.event_week) AS latest_week
FROM sides s
JOIN (
    SELECT LOWER(team_name) AS key,
           SUM(CASE WHEN NOT is_open THEN 1 ELSE 0 END) AS league_games
    FROM sides
    GROUP BY LOWER(team_name)
) scope ON scope.key = LOWER(s.team_name)
WHERE scope.league_games = 0 OR NOT s.is_open
GROUP BY LOWER(s.team_name)
ORDER BY matches DESC, LOWER(s.team_name) ASC
"""


@bp.get("/teams")
@cache.cached(timeout=3600)
def get_teams():
    """Every team with its league record and the week it last played.

    The scope deliberately mirrors `/team/<name>` so the list and a team's own
    page can never disagree: the "Night Shift Open 1" qualifier is ignored
    (unless that is all the team ever played, which keeps the pre-season entries
    visible) and placeholder matches with no player rows are dropped.

    `won` uses `event_team_a_ingame_side` + `winning_team` — the SQL twin of the
    team page's `team_result` — so an unscored match adds to the count but not to
    either side of the record. Verified: `wins + losses == matches` for all 67
    teams, and every figure matches the corresponding `/db/team` payload.
    """
    with get_ro_conn() as conn:
        cur = conn.execute(_TEAMS_SQL)
        return jsonify({"teams": _rows_to_dicts(cur)})


# Items above this shop tier cost 3200+ souls. The assets API exposes tiers
# rather than soul costs, and tier 3 is the 3200 tier.
MIN_SIGNATURE_ITEM_TIER = 3
SIGNATURE_ITEM_LIMIT = 3
# The player profile's Items & Build panel shows more than the roster card does.
SIGNATURE_ITEM_PROFILE_LIMIT = 6
BUILD_ORDER_LIMIT = 6

# ── Player × Hero ───────────────────────────────────────────────────────
# Ability point orders. A game spends 16 points: one unlock per ability plus its
# 1/2/5 AP upgrades, so the build grid is always 16 steps wide.
ABILITY_SLOTS = ("signature1", "signature2", "signature3", "signature4")
ABILITY_GRID_STEPS = 16
MAX_ABILITY_TIER = 3  # tier 3 is the 5 AP upgrade, the one the "max order" tracks
ABILITY_BUILD_LIMIT = 3  # the panel shows the three most common orders
# The rank block only renders while the player is inside the top N of the hero's
# pool, and win-rate standings need this many decided games.
RANK_TOP_N = 10
RANK_MIN_GAMES = 5

# A hero page's win flag, in SQL — the twin of `_match_won`: the in-game side
# decides when both sides are known, and the stored result is trusted only when
# they are not, so a hero-page baseline can never disagree with a match row.
MATCH_WON_SQL = (
    "(CASE WHEN p.team IN (0, 1) AND m.winning_team IN (0, 1) THEN p.team = m.winning_team "
    "WHEN p.result = 'Win' THEN 1 WHEN p.result = 'Loss' THEN 0 ELSE NULL END)"
)

# The Hero detail page describes the Night Shift league run as ONE scope. Individual
# weeks are not selectable: there are not enough games per hero per week for a
# weekly view to mean anything, so the page compares against the league average
# instead of against a narrower window.
# `LOWER(...)` because the feed keeps week 49 under an all-caps `NIGHT SHIFT`
# series and SQLite's `=` on TEXT is case-sensitive. The week number is only
# meaningful WITHIN a series -- week 1 holds both `Night Shift` and `Night Shift
# Open 1` -- so every scoped query has to constrain the title as well as the week.
NIGHT_SHIFT_TITLE_SQL = "LOWER(m.event_title) = 'night shift'"


def night_shift_scope(conn: sqlite3.Connection) -> Tuple[str, str]:
    """SQL fragment (leading ` AND ...`) plus human label for the league scope.

    The week range is DERIVED from the data rather than hard-coded. It used to be
    a literal `BETWEEN 1 AND 57`, which silently dropped the newest week from
    every hero panel the moment that week was ingested -- while the weekly series
    below, which never had the cap, carried on plotting it. The page then
    contradicted itself: a week-58 bar on the chart, week-58 games missing from
    every total. Deriving the bounds means a new week joins the scope by itself.

    `matches` is aliased `m` so the fragment drops into any query already joining it.
    """
    first, last = conn.execute(
        f"SELECT MIN(m.event_week), MAX(m.event_week) FROM matches m"
        f" WHERE {NIGHT_SHIFT_TITLE_SQL}"
    ).fetchone() or (None, None)
    first = int(first) if first is not None else 1
    last = int(last) if last is not None else first
    fragment = f" AND {NIGHT_SHIFT_TITLE_SQL} AND m.event_week BETWEEN {first} AND {last}"
    return fragment, f"Night Shift · Weeks {first}–{last}"


def _icon_key(value: str) -> str:
    """Punctuation-insensitive icon key.

    Shipped filenames and the asset API disagree on punctuation (Hunter's Aura
    is "hunter's_aura_psd.png" locally but "hunters_aura.png" upstream), so both
    sides are reduced to lowercase alphanumerics with & read as "and".
    """
    return re.sub(r"[^a-z0-9]", "", (value or "").lower().replace("&", "and"))


def _item_icon_index() -> Dict[str, str]:
    """'<slot>/<key>' and '*/<key>' -> shipped filename under public/images/items."""
    cached = cache.get("dlns_item_icon_index")
    if cached is not None:
        return cached

    index: Dict[str, str] = {}
    # current_app.root_path is backend/app, so parents[1] is the project root.
    root = Path(current_app.root_path).resolve().parents[1] / "public" / "images" / "items"
    try:
        for path in sorted(root.rglob("*.png")):
            rel = path.relative_to(root).as_posix()
            slot, _, filename = rel.partition("/")
            if not filename:
                continue
            stem = filename[:-4]
            if stem.endswith("_psd"):
                stem = stem[:-4]
            key = _icon_key(stem)
            if not key:
                continue
            index.setdefault(f"{slot}/{key}", rel)
            # The asset API's item category drifts from the folders shipped
            # here (Dispel Magic is "spirit" upstream, "vitality" here), so keep
            # a slot-agnostic fallback too.
            index.setdefault(f"*/{key}", rel)
    except OSError:
        current_app.logger.warning("Item icon folder unreadable: %s", root)

    if index:
        cache.set("dlns_item_icon_index", index, timeout=21600)
    return index


def _item_catalog() -> Dict[int, Dict[str, Any]]:
    """Shop item id -> {name, slot, tier, type, icon} (cached)."""
    cached = cache.get("dlns_item_catalog")
    if cached is not None:
        return cached

    try:
        resp = requests.get(
            ITEMS_URL,
            params={"language": "english"},
            timeout=5,
        )
        resp.raise_for_status()
        raw_catalog = resp.json()
    except Exception as exc:  # requests raises several types
        current_app.logger.warning("Item catalog unavailable: %s", exc)
        raw_catalog = []

    icons = _item_icon_index()
    catalog: Dict[int, Dict[str, Any]] = {}
    for item in raw_catalog if isinstance(raw_catalog, list) else []:
        item_id = item.get("id")
        if item_id is None:
            continue
        name = item.get("name") or ""
        class_name = item.get("class_name") or ""
        # Internal variants (e.g. upgrade_clip_size_fixed_t3) carry no display
        # name and are never real purchases, so keep them out of the catalog.
        if not name or name == class_name or name.startswith("upgrade_"):
            continue

        slot = item.get("item_slot_type") or ""
        shop_image = item.get("shop_image") or ""
        shop_base = shop_image.rsplit("/", 1)[-1].rsplit(".", 1)[0] if shop_image else ""

        # shop_image usually matches the shipped asset, but some items still
        # point at a legacy filename (Dispel Magic -> debuff_remover.png), so
        # fall back to the display name.
        candidates = []
        for key in (_icon_key(shop_base), _icon_key(name)):
            if key:
                candidates += [f"{slot}/{key}", f"*/{key}"]
        shipped = next((icons[key] for key in candidates if key in icons), None)

        catalog[int(item_id)] = {
            "name": name,
            "slot": slot,
            "tier": item.get("item_tier"),
            "type": item.get("type") or "",
            "icon": f"items/{shipped}" if shipped else None,
        }

    if catalog:
        cache.set("dlns_item_catalog", catalog, timeout=21600)
    return catalog


# ── Damage matrix labels ───────────────────────────────────────────────────
# `player_damage_sources.source` keeps the upstream damage_matrix source name
# verbatim, and those come in three flavours:
#   1. generic buckets — "Bullet", "Ability", "Melee", "Misc"
#   2. per-hero weapon sets — "citadel_weapon_mirage_set", "…_crit"
#   3. internal ability keys — "ability_flame_dash", "citadel_ability_storm_cloud"
# Only (3) needs translating, and those keys do NOT match the asset filenames in
# data/hero_meta.json (the game renamed most abilities after those assets were
# cut), so `_damage_source_index` offers progressively looser lookups: the exact
# asset key for the hero, the same key from any hero, then the hero's ability
# NAMES matched as token sets ("citadel_ability_lightning_ball" -> Lightning Ball).
# Item keys resolve exactly — the item catalog is keyed by the same class_name.
DAMAGE_GROUP_ORDER = ("abilities", "weapon", "items", "melee", "other")
DAMAGE_GROUP_LABELS = {
    "abilities": "Abilities",
    "weapon": "Weapon",
    "items": "Items",
    "melee": "Melee",
    "other": "Other",
}
# The panel lists the biggest ability sources; the rest is rolled into one row.
MAX_DAMAGE_ABILITY_ROWS = 5
# Sources that mean headshot/crit damage rather than a weapon, an item or a kit
# ability. `_crit` suffixes are matched by pattern; these are exact names.
_DAMAGE_HEADSHOT_SOURCES = {"headshot", "upgrade_headhunter", "upgrade_headshot_booster"}
_DAMAGE_ITEM_PREFIXES = ("upgrade_", "item_", "mods_")
_DAMAGE_SOURCE_PREFIXES = (
    "citadel_ability_",
    "ability_",
    "citadel_weapon_",
    "citadel_",
    "weapon_",
)


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
    """The upstream item + ability catalogue, verbatim (cached briefly)."""
    cached = cache.get("dlns_items_list")
    if cached is not None:
        return cached

    raw: List[Any] = []
    try:
        resp = requests.get(ITEMS_URL, params={"language": "english"}, timeout=5)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as exc:  # requests raises several types
        current_app.logger.warning("Item catalog unavailable: %s", exc)
    raw = raw if isinstance(raw, list) else []
    if raw:
        cache.set("dlns_items_list", raw, timeout=600)
    return raw


def _heroes_raw() -> List[Any]:
    """The upstream hero catalogue, verbatim (cached briefly).

    Carries the `signature1..4` item slots, which is the only place that maps a
    hero to its four levelable abilities in a stable order.
    """
    cached = cache.get("dlns_heroes_list")
    if cached is not None:
        return cached

    raw: List[Any] = []
    try:
        resp = requests.get(HEROES_URL, params={"language": "english"}, timeout=5)
        resp.raise_for_status()
        raw = resp.json()
    except Exception as exc:  # requests raises several types
        current_app.logger.warning("Hero catalog unavailable: %s", exc)
    raw = raw if isinstance(raw, list) else []
    if raw:
        cache.set("dlns_heroes_list", raw, timeout=600)
    return raw


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
            key = _icon_key(stem)
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
            icon = icons.get(_icon_key(entry.get("class_name") or name))
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


def _hero_aggregate(rows: List[Any]) -> Dict[str, Any]:
    """Per-game averages over (kills, deaths, assists, souls, damage, seconds, won).

    KDA is the MEAN OF PER-GAME KDA and the per-minute figures average the games
    that have them, so a hero page's "vs own" and "vs league" numbers are built
    the same way as the hero pool table on the player page.
    """
    kdas: List[float] = []
    souls: List[float] = []
    damage: List[float] = []
    for kills, deaths, assists, net_worth, player_damage, duration, _won in rows:
        kdas.append(((kills or 0) + (assists or 0)) / max(deaths or 0, 1))
        if duration and duration > 0 and net_worth is not None:
            souls.append(net_worth * 60 / duration)
        if duration and duration > 0 and player_damage is not None:
            damage.append(player_damage * 60 / duration)

    def mean(values: List[float]) -> Optional[float]:
        return sum(values) / len(values) if values else None

    return {
        "kda": mean(kdas),
        "souls_per_min": mean(souls),
        "damage_per_min": mean(damage),
    }


def _hero_standings(
    per_player: Dict[int, Dict[str, int]],
    account_id: int,
    top_n: int = RANK_TOP_N,
    min_games: int = RANK_MIN_GAMES,
) -> Dict[str, Any]:
    """Where one player sits in a hero's pool, by games and by win rate.

    Ties share the better rank (the count of players strictly ahead, plus one),
    and the win-rate table only lists players with `min_games` decided games —
    "1 win, 0 losses" must not top it.
    """
    mine = per_player.get(account_id)
    by_games = None
    if mine:
        ahead = sum(1 for entry in per_player.values() if entry["games"] > mine["games"])
        by_games = {"rank": ahead + 1, "of": len(per_player), "value": mine["games"]}

    rated = [
        (account, entry)
        for account, entry in per_player.items()
        if entry["wins"] + entry["losses"] >= min_games
    ]
    by_win_rate = None
    if mine and mine["wins"] + mine["losses"] >= min_games:
        decided = mine["wins"] + mine["losses"]
        rate = mine["wins"] / decided
        ahead = sum(
            1
            for _, entry in rated
            if entry["wins"] / (entry["wins"] + entry["losses"]) > rate
        )
        by_win_rate = {
            "rank": ahead + 1,
            "of": len(rated),
            "value": rate,
            "min_games": min_games,
        }

    return {
        "eligible": bool(
            (by_games and by_games["rank"] <= top_n)
            or (by_win_rate and by_win_rate["rank"] <= top_n)
        ),
        "by_games": by_games,
        "by_win_rate": by_win_rate,
        "pool": [
            {
                "account_id": account,
                "games": entry["games"],
                "wins": entry["wins"],
                "losses": entry["losses"],
                "is_player": account == account_id,
            }
            for account, entry in sorted(
                per_player.items(), key=lambda kv: (-kv[1]["games"], kv[0])
            )
        ],
    }


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


def _damage_source_index() -> Dict[str, Any]:
    """Ability lookups for the damage matrix, built from data/hero_meta.json."""
    cached = cache.get("dlns_damage_source_index")
    if cached is not None:
        return cached

    meta_path = Path(current_app.root_path).parent.parent / "data" / "hero_meta.json"
    raw: Dict[str, Any] = {}
    try:
        with meta_path.open(encoding="utf-8") as handle:
            raw = json.load(handle)
    except (OSError, ValueError) as exc:
        current_app.logger.warning("Ability index unavailable: %s", exc)

    by_hero: Dict[str, Dict[str, str]] = {}
    tokens_by_hero: Dict[str, List[Any]] = {}
    prefixes_by_hero: Dict[str, set] = {}
    any_key: Dict[str, str] = {}

    for hero_id, hero in (raw if isinstance(raw, dict) else {}).items():
        keys: Dict[str, str] = {}
        tokens: List[Any] = []
        prefixes: set = set()
        for ability in (hero or {}).get("abilities") or []:
            name = ability.get("name")
            if not name:
                continue
            image = (ability.get("image") or "").replace("/", "\\")
            stem = re.sub(r"_psd\.png$", "", image.split("\\")[-1]).lower()
            if stem:
                keys[stem] = name
                any_key.setdefault(stem, name)
                # The first word of a kit's asset names is the hero's internal
                # prefix ("vampirebat_lovebites", "priest_flashbang"), which the
                # damage keys reuse.
                prefixes.add(stem.split("_")[0])
            words = frozenset(
                re.findall(r"[a-z0-9]+", re.sub(r"['\u2019]s\b", "", name.lower()))
            )
            if words:
                tokens.append((words, name))
        by_hero[str(hero_id)] = keys
        tokens_by_hero[str(hero_id)] = tokens
        prefixes_by_hero[str(hero_id)] = prefixes

    index: Dict[str, Any] = {
        "by_hero": by_hero,
        "any": any_key,
        "tokens": tokens_by_hero,
        "prefixes": prefixes_by_hero,
    }
    if raw:
        cache.set("dlns_damage_source_index", index, timeout=21600)
    return index


def _titleise_damage_source(key: str) -> str:
    """Best-effort name for a source the catalogs do not know.

    "shiv_defer_damage" -> "Shiv Defer Damage", "UnknownAbility" -> "Unknown Ability".
    """
    spaced = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", key or "")
    return spaced.replace("_", " ").strip().title()


def _classify_damage_source(
    source: str,
    hero_id: Any,
    index: Dict[str, Any],
    item_names: Dict[str, str],
) -> tuple:
    """-> (group id, row label, row sub-label). The one place these rules live."""
    low = (source or "").lower()
    key = low
    for prefix in _DAMAGE_SOURCE_PREFIXES:
        if key.startswith(prefix):
            key = key[len(prefix):]
            break
    key = re.sub(r"_(crit|amp)$", "", key).strip()

    hero_keys = index["by_hero"].get(str(hero_id), {})
    if key in hero_keys:
        return "abilities", hero_keys[key], ""
    if key in index["any"]:
        return "abilities", index["any"][key], ""

    words = set(key.split("_"))
    best = None
    for name_words, name in index["tokens"].get(str(hero_id), []):
        if name_words <= words and (best is None or len(name) > len(best)):
            best = name
    if best:
        return "abilities", best, ""

    if "_crit" in low:
        return "weapon", "Headshots / crits", ""
    if low in _DAMAGE_HEADSHOT_SOURCES:
        return "weapon", "Headshots / crits", ""
    if low == "bullet" or low.startswith("citadel_weapon"):
        return "weapon", "Bullets", "body"
    if (low == "melee" or "melee" in low) and not low.startswith(_DAMAGE_ITEM_PREFIXES):
        return "melee", "Melee", "light + heavy"
    if source == "Ability":
        return "abilities", "Abilities", "unattributed"
    if low.startswith(_DAMAGE_ITEM_PREFIXES):
        return "items", item_names.get(source) or _titleise_damage_source(key), ""
    if low == "misc":
        return "other", "Misc", "unattributed"

    # Anything left is ability damage the catalogs cannot name, so it is named as
    # well as possible: drop the hero's own internal prefix when the key carries
    # one ("vampirebat_lovebites" -> Lovebites) and then prettify.
    parts = key.split("_")
    if len(parts) > 1 and parts[0] in index["prefixes"].get(str(hero_id), set()):
        parts = parts[1:]
    return "abilities", _titleise_damage_source("_".join(parts)), ""


@bp.get("/team/<path:team_name>/weeks")
@cache.cached(timeout=1800)
def team_weeks_api(team_name: str):
    """Week axis for one team: the weeks it played plus the league's weeks.

    `/db/team/<name>` already computes both, but it carries the whole roster,
    item catalogue and hero usage (145 KB for a busy team). The player page's
    tenure timeline needs one call per team, so this is the same scoping with
    only the weeks in the payload.
    """
    EXCLUDE_OPEN_SQL = "(m.event_title IS NULL OR m.event_title <> 'Night Shift Open 1')"
    with get_ro_conn() as conn:
        has_non_open_match = conn.execute(
            f"""
            SELECT 1 FROM matches m
            WHERE {EXCLUDE_OPEN_SQL}
              AND (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?))
            LIMIT 1
            """,
            (team_name, team_name),
        ).fetchone()
        scope_sql = EXCLUDE_OPEN_SQL if has_non_open_match else "1 = 1"

        team_weeks = [
            row[0]
            for row in conn.execute(
                f"""
                SELECT DISTINCT m.event_week
                FROM matches m
                WHERE (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?))
                  AND m.event_week IS NOT NULL
                  AND EXISTS (SELECT 1 FROM players p WHERE p.match_id = m.match_id)
                  AND ({scope_sql})
                """,
                (team_name, team_name),
            )
            if row[0] is not None
        ]

        league_weeks = [
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT m.event_week FROM matches m "
                "WHERE m.event_week IS NOT NULL AND m.match_id > 0 "
                f"AND ({EXCLUDE_OPEN_SQL})"
            )
            if row[0] is not None
        ]

    return jsonify(
        {
            "team_name": team_name,
            "weeks": sorted(team_weeks),
            "league_weeks": sorted(league_weeks),
        }
    )


@bp.get("/team/<path:team_name>")
@cache.cached(timeout=1800)
def get_team_detail(team_name: str):
    """Return team detail: roster with per-player stats, records, pacing, hero
    pool/history and the league baseline used by the Overview and Players tabs."""
    with get_ro_conn() as conn:
        canonical_row = conn.execute(
            """
            SELECT MIN(event_team_a) FROM matches
            WHERE LOWER(event_team_a) = LOWER(?) AND event_team_a IS NOT NULL
            """,
            (team_name,),
        ).fetchone()
        if canonical_row and canonical_row[0]:
            team_name = canonical_row[0]
        else:
            canonical_row2 = conn.execute(
                """
                SELECT MIN(event_team_b) FROM matches
                WHERE LOWER(event_team_b) = LOWER(?) AND event_team_b IS NOT NULL
                """,
                (team_name,),
            ).fetchone()
            if canonical_row2 and canonical_row2[0]:
                team_name = canonical_row2[0]

        # "Night Shift Open 1" is a separate qualifier event whose rows carry no
        # event_team_a_ingame_side, so the side-unknown fallback below would
        # count BOTH teams' players for it. Ignore that event, unless doing so
        # would leave the team with nothing at all to show.
        EXCLUDE_OPEN_SQL = "(m.event_title IS NULL OR m.event_title <> 'Night Shift Open 1')"
        has_non_open_match = conn.execute(
            f"""
            SELECT 1 FROM matches m
            WHERE {EXCLUDE_OPEN_SQL}
              AND (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?))
            LIMIT 1
            """,
            (team_name, team_name),
        ).fetchone()
        SCOPE_SQL = EXCLUDE_OPEN_SQL if has_non_open_match else "1 = 1"

        # Matches with no player rows are placeholders (several feed ids are
        # negative bracket placeholders). They carry no data but do inflate
        # match counts, so the match list below drops them.
        playable_ids = {
            row[0]
            for row in conn.execute(
                """
                SELECT DISTINCT p.match_id
                FROM players p
                JOIN matches m ON m.match_id = p.match_id
                WHERE LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?)
                """,
                (team_name, team_name),
            )
        }

        # Use event_team_a_ingame_side to restrict to players on the correct side.
        # When team is team_a: their in-game side = event_team_a_ingame_side → p.team = event_team_a_ingame_side
        # When team is team_b: their in-game side = 1 - event_team_a_ingame_side → p.team != event_team_a_ingame_side
        # Fallback (no ingame_side data): include all players from matching matches.
        ON_TEAM_SQL = f"""
                ((LOWER(m.event_team_a) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team = m.event_team_a_ingame_side)
                OR
                (LOWER(m.event_team_b) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team != m.event_team_a_ingame_side)
                OR
                (m.event_team_a_ingame_side IS NULL AND (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?))))
                AND ({SCOPE_SQL})
        """

        cur = conn.execute(
            f"""
            SELECT
                p.account_id,
                u.persona_name,
                u.avatar_url,
                COUNT(DISTINCT m.match_id) AS appearances,
                MAX(m.event_week) AS last_week,
                MIN(m.event_week) AS first_week,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) AS wins,
                SUM(CASE WHEN p.result = 'Loss' THEN 1 ELSE 0 END) AS losses,
                ROUND(AVG(CAST(p.kills AS REAL)), 1) AS avg_kills,
                ROUND(AVG(CAST(p.deaths AS REAL)), 1) AS avg_deaths,
                ROUND(AVG(CAST(p.assists AS REAL)), 1) AS avg_assists,
                ROUND(AVG(CAST(p.kills + p.assists AS REAL) / MAX(p.deaths, 1)), 2) AS kda,
                ROUND(AVG(CASE WHEN m.duration_s > 0 THEN CAST(p.net_worth AS REAL) * 60.0 / m.duration_s END)) AS nw_per_min,
                ROUND(AVG(CASE WHEN m.duration_s > 0 THEN CAST(p.player_damage AS REAL) * 60.0 / m.duration_s END)) AS dmg_per_min,
                ROUND(AVG(p.net_worth)) AS nw_per_game,
                ROUND(AVG(p.player_damage)) AS dmg_per_game
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.account_id IS NOT NULL
              AND ({ON_TEAM_SQL})
            GROUP BY p.account_id, u.persona_name, u.avatar_url
            ORDER BY appearances DESC, u.persona_name ASC
            LIMIT 200
            """,
            (team_name, team_name, team_name, team_name),
        )
        players = _rows_to_dicts(cur)
        # The per-player win/loss split reads `players.result`, the same field the
        # hero-pick wins already trust. It is the player's OWN result, which is the
        # only per-player signal stored — the team-level record is derived from the
        # sides instead, so the two can differ on a side-less match.

        # Hero picks per player: feeds the signature heroes on the roster card
        # and the per-player cells of the hero usage matrix.
        cur_sig = conn.execute(
            f"""
            SELECT
                p.account_id,
                p.hero_id,
                COUNT(*) AS games,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) AS wins
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.account_id IS NOT NULL AND p.hero_id IS NOT NULL
              AND ({ON_TEAM_SQL})
            GROUP BY p.account_id, p.hero_id
            ORDER BY games DESC
            """,
            (team_name, team_name, team_name, team_name),
        )
        from ..heroes import get_all_hero_names
        all_names = get_all_hero_names()

        signature_heroes: Dict[int, List[Dict[str, Any]]] = {}
        player_hero_stats: Dict[int, Dict[int, Dict[str, int]]] = {}
        for account_id, hero_id, games, wins in cur_sig.fetchall():
            wins = wins or 0
            player_hero_stats.setdefault(account_id, {})[hero_id] = {
                "games": games,
                "wins": wins,
            }
            bucket = signature_heroes.setdefault(account_id, [])
            if len(bucket) < 3:
                bucket.append({
                    "hero_id": hero_id,
                    "hero_name": all_names.get(str(hero_id), f"Hero {hero_id}"),
                    "games": games,
                    "wins": wins,
                    "win_rate": round(wins / games * 100) if games else None,
                })
        for player in players:
            player["signature_heroes"] = signature_heroes.get(player["account_id"], [])

        # Signature items: most-bought 3200+ soul items per player. Raw purchase
        # events are stored, so only unsold entries count as bought.
        item_catalog = _item_catalog()
        cur_items = conn.execute(
            f"""
            SELECT
                p.account_id,
                json_extract(entry.value, '$.item_id') AS item_id,
                COUNT(DISTINCT p.match_id) AS games
            FROM players p
            JOIN matches m ON m.match_id = p.match_id,
                 json_each(p.raw_items_json) AS entry
            WHERE p.account_id IS NOT NULL
              AND p.raw_items_json IS NOT NULL
              AND ({ON_TEAM_SQL})
              AND json_extract(entry.value, '$.item_id') IS NOT NULL
              AND COALESCE(json_extract(entry.value, '$.sold_time_s'), 0) = 0
            GROUP BY p.account_id, item_id
            ORDER BY games DESC
            """,
            (team_name, team_name, team_name, team_name),
        )
        signature_items: Dict[int, List[Dict[str, Any]]] = {}
        for account_id, item_id, games in cur_items.fetchall():
            meta = item_catalog.get(int(item_id))
            if not meta or meta["type"] == "ability":
                continue
            if (meta["tier"] or 0) < MIN_SIGNATURE_ITEM_TIER:
                continue
            bucket = signature_items.setdefault(account_id, [])
            if len(bucket) >= SIGNATURE_ITEM_LIMIT:
                continue
            bucket.append({
                "item_id": int(item_id),
                "item_name": meta["name"],
                "slot": meta["slot"],
                "tier": meta["tier"],
                "icon": meta["icon"],
                "games": games,
            })
        for player in players:
            player["items"] = signature_items.get(player["account_id"], [])

        cur2 = conn.execute(
            f"""
            SELECT
                m.match_id, m.event_game, m.event_week, m.event_title,
                m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                m.winning_team, m.duration_s, m.start_time, m.match_vod
            FROM matches m
            WHERE (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?))
              AND {SCOPE_SQL}
            ORDER BY m.start_time DESC
            """,
            (team_name, team_name),
        )
        matches = [m for m in _rows_to_dicts(cur2) if m["match_id"] in playable_ids]

        # Per-game hero lineups for the Series tab, in the order the scoreboard
        # reads: lane by lane (York, Greenwich, Broadway), then in-game slot.
        # heroes_a / heroes_b are aligned with event_team_a / event_team_b so the
        # caller never has to work out which side is which.
        lineups: Dict[int, Dict[int, List[Any]]] = {}
        if matches:
            match_ids = [m["match_id"] for m in matches]
            placeholders = ",".join("?" * len(match_ids))
            hero_rows = conn.execute(
                f"""
                SELECT p.match_id, p.team, p.hero_id, p.lane, p.lane_real, p.player_slot
                FROM players p
                WHERE p.match_id IN ({placeholders}) AND p.hero_id IS NOT NULL
                """,
                tuple(match_ids),
            ).fetchall()
            for mid, side, hero_id, lane, lane_real, slot in hero_rows:
                # lane_real corrects early-game lane swaps; fall back to the
                # lane the game assigned, exactly as the scoreboard does.
                effective = lane_real if lane_real is not None else lane
                try:
                    rank = LANE_ORDER.index(int(effective))
                except (TypeError, ValueError):
                    rank = len(LANE_ORDER)  # unknown lane sorts last
                lineups.setdefault(mid, {}).setdefault(int(side), []).append(
                    (rank, slot if slot is not None else 99, int(hero_id))
                )

        for m in matches:
            team_a_side = m.get("event_team_a_ingame_side")
            if team_a_side in (0, 1):
                sides = {"heroes_a": team_a_side, "heroes_b": 1 - team_a_side}
            else:
                sides = {"heroes_a": None, "heroes_b": None}
            for key, side in sides.items():
                m[key] = (
                    [
                        {"hero_id": hero_id, "hero_name": get_hero_name(hero_id)}
                        for _, _, hero_id in sorted(lineups.get(m["match_id"], {}).get(side, []))
                    ]
                    if side is not None
                    else []
                )

        # Latest week the team actually played, matching the filtered list.
        max_week = max(
            (m["event_week"] for m in matches if m["event_week"] is not None),
            default=None,
        )

        # Roster timeline axis: the weeks the league actually ran, clipped to the
        # team's own span. Derived from the fixtures rather than a numeric
        # first..last range so that a genuine bye week (one with no fixtures
        # anywhere) cannot render as an empty column that breaks every player's
        # bar at once and reads as a mass roster change. The team's own weeks are
        # unioned in so a week the team played is never dropped. Net effect: a
        # break in a bar always means "the team played, this player did not".
        team_weeks = {
            m["event_week"] for m in matches if m["event_week"] is not None
        }
        league_weeks = {
            row[0]
            for row in conn.execute(
                "SELECT DISTINCT m.event_week FROM matches m "
                "WHERE m.event_week IS NOT NULL AND m.match_id > 0 "
                f"AND ({EXCLUDE_OPEN_SQL})"
            )
            if row[0] is not None
        }
        if team_weeks:
            first_week, last_week = min(team_weeks), max(team_weeks)
            roster_weeks = sorted(
                week
                for week in (league_weeks | team_weeks)
                if first_week <= week <= last_week
            )
        else:
            roster_weeks = []

        # Weeks each player turned out, driving the timeline bars.
        axis = set(roster_weeks)
        cur_player_weeks = conn.execute(
            f"""
            SELECT p.account_id, m.event_week
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.account_id IS NOT NULL AND m.event_week IS NOT NULL
              AND ({ON_TEAM_SQL})
            GROUP BY p.account_id, m.event_week
            """,
            (team_name, team_name, team_name, team_name),
        )
        weeks_by_player: Dict[int, List[int]] = {}
        for account_id, week in cur_player_weeks.fetchall():
            if week in axis:
                weeks_by_player.setdefault(account_id, []).append(week)
        for player in players:
            player["weeks"] = sorted(weeks_by_player.get(player["account_id"], []))

        cur3 = conn.execute(
            f"""
            SELECT
                p.hero_id,
                COUNT(*) AS picks,
                SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) AS wins
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.hero_id IS NOT NULL
              AND ({ON_TEAM_SQL})
            GROUP BY p.hero_id
            ORDER BY picks DESC
            """,
            (team_name, team_name, team_name, team_name),
        )
        hero_picks_raw = _rows_to_dicts(cur3)

        total_picks_row = conn.execute(
            f"""
            SELECT COUNT(*)
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.hero_id IS NOT NULL AND ({ON_TEAM_SQL})
            """,
            (team_name, team_name, team_name, team_name),
        ).fetchone()
        total_picks = total_picks_row[0] if total_picks_row else 0

        hero_picks = []
        for row in hero_picks_raw:
            picks = row["picks"] or 0
            wins = row["wins"] or 0
            hero_picks.append({
                "hero_id": row["hero_id"],
                "hero_name": all_names.get(str(row["hero_id"]), f"Hero {row['hero_id']}"),
                "picks": picks,
                "wins": wins,
                "win_rate": round(wins / picks * 100) if picks else None,
                "pick_share": round(picks / total_picks * 100, 1) if total_picks else 0.0,
            })

        # ── Records, form, pacing (all derived from the match history) ──────
        team_lower = team_name.lower()

        def team_result(match: Dict[str, Any]):
            """True when this team won, False when they lost, None if unscored."""
            side = match.get("event_team_a_ingame_side")
            if side is None or match.get("winning_team") is None:
                return None
            is_team_a = (match.get("event_team_a") or "").lower() == team_lower
            return match["winning_team"] == side if is_team_a else match["winning_team"] != side

        # `matches` is ordered by start_time DESC, so the head is the newest game.
        scored = [(m, r) for m, r in ((m, team_result(m)) for m in matches) if r is not None]

        game_wins = sum(1 for _, won in scored if won)
        game_losses = len(scored) - game_wins

        # Series = same opponents / title / week. Majority of games decides it.
        series_map: Dict[str, List[bool]] = {}
        for match, won in scored:
            key = "||".join([
                (match.get("event_team_a") or "").lower(),
                (match.get("event_team_b") or "").lower(),
                match.get("event_title") or "",
                str(match.get("event_week")),
            ])
            series_map.setdefault(key, []).append(won)
        series_wins = sum(1 for games in series_map.values() if sum(games) * 2 > len(games))
        series_losses = sum(1 for games in series_map.values() if sum(games) * 2 < len(games))

        # Last 10 games, oldest first so the strip reads left → right.
        form = [
            {"match_id": match["match_id"], "result": "W" if won else "L"}
            for match, won in scored[:10]
        ][::-1]

        team_durations = [m["duration_s"] for m, _ in scored if m.get("duration_s")]
        avg_s = round(sum(team_durations) / len(team_durations)) if team_durations else None

        # Baseline = the whole Night Shift series (every week, every team).
        baseline_row = conn.execute(
            """
            SELECT ROUND(AVG(duration_s)), COUNT(*)
            FROM matches
            WHERE event_title = 'Night Shift' AND duration_s IS NOT NULL
            """
        ).fetchone()
        baseline_avg_s = baseline_row[0] if baseline_row else None
        baseline_games = (baseline_row[1] or 0) if baseline_row else 0
        delta_s = (
            baseline_avg_s - avg_s
            if avg_s is not None and baseline_avg_s is not None
            else None
        )

        longest_win = None
        for match, won in scored:
            if not won or not match.get("duration_s"):
                continue
            if longest_win is None or match["duration_s"] > longest_win["duration_s"]:
                is_team_a = (match.get("event_team_a") or "").lower() == team_lower
                longest_win = {
                    "match_id": match["match_id"],
                    "duration_s": match["duration_s"],
                    "opponent": match.get("event_team_b") if is_team_a else match.get("event_team_a"),
                    "event_week": match.get("event_week"),
                }

        length_buckets = [
            {"label": "< 25 min", "min_s": 0, "max_s": 1500},
            {"label": "25–35 min", "min_s": 1500, "max_s": 2100},
            {"label": "35+ min", "min_s": 2100, "max_s": None},
        ]
        for bucket in length_buckets:
            games = [
                won
                for match, won in scored
                if match.get("duration_s") is not None
                and match["duration_s"] >= bucket["min_s"]
                and (bucket["max_s"] is None or match["duration_s"] < bucket["max_s"])
            ]
            bucket["games"] = len(games)
            bucket["wins"] = sum(1 for won in games if won)
            bucket["losses"] = len(games) - bucket["wins"]

        # League baseline for the players-tab leaderboard: every player-game in
        # the Night Shift series, all teams and weeks.
        league_row = conn.execute(
            """
            SELECT
                ROUND(AVG(CAST(p.kills + p.assists AS REAL) / MAX(p.deaths, 1)), 2) AS kda,
                ROUND(AVG(p.net_worth)) AS net_worth,
                ROUND(AVG(p.player_damage)) AS damage
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE m.event_title = 'Night Shift'
            """
        ).fetchone()
        league_baseline = {
            "kda": league_row[0] if league_row else None,
            "net_worth": league_row[1] if league_row else None,
            "damage": league_row[2] if league_row else None,
        }

        # Hero usage matrix: every hero the team has picked becomes a column,
        # busiest first. The league only ever sees ~38 distinct heroes, so the
        # matrix stays a manageable width.
        usage_heroes = hero_picks
        usage_hero_ids = {hero["hero_id"] for hero in usage_heroes}
        hero_usage = {
            "heroes": [
                {
                    "hero_id": hero["hero_id"],
                    "hero_name": hero["hero_name"],
                    "picks": hero["picks"],
                    "wins": hero["wins"],
                    "win_rate": hero["win_rate"],
                }
                for hero in usage_heroes
            ],
            "rows": [
                {
                    "account_id": player["account_id"],
                    "cells": {
                        str(hero_id): stats
                        for hero_id, stats in player_hero_stats.get(player["account_id"], {}).items()
                        if hero_id in usage_hero_ids
                    },
                }
                for player in players
            ],
        }

        return jsonify({
            "team_name": team_name,
            "max_week": max_week,
            "roster_weeks": roster_weeks,
            "league_weeks": sorted(league_weeks),
            "total_matches": len(matches),
            "players": players,
            "matches": matches,
            "hero_picks": hero_picks,
            "record": {
                "games": {"wins": game_wins, "losses": game_losses},
                "series": {"wins": series_wins, "losses": series_losses},
            },
            "form": form,
            "durations": {
                "avg_s": avg_s,
                "games": len(team_durations),
                "baseline_avg_s": baseline_avg_s,
                "baseline_games": baseline_games,
                "baseline_label": "Night Shift",
                "delta_s": delta_s,
                "longest_win": longest_win,
                "buckets": length_buckets,
            },
            "leaderboard": {"league": league_baseline},
            "hero_usage": hero_usage,
        })


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
        computed.append(payload)
    computed.sort(key=lambda event: str(event.get("region") or ""))
    return computed


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

        # Pull vod_link (week-level), per-series match_vod, and per-game match_vod from matches.json
        vod_link: str | None = None
        vod_links: list = []
        series_vods: dict = {}  # key: "team_a__team_b" -> vod url
        game_vods: dict = {}    # key: str(match_id) -> vod url
        try:
            matches_file = _matches_json_path()
            with open(matches_file, encoding="utf-8-sig") as f:
                mdata = json.load(f)
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

        return jsonify({
            "week": week,
            "event_title": event_title,
            "stats": stats,
            "matches": matches,
            "brackets": _week_brackets(event_title, week),
            "all_weeks": all_weeks,
            "vod_link": vod_link,
            "vod_links": vod_links,
            "series_vods": series_vods,
            "game_vods": game_vods,
        })
