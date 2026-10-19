from __future__ import annotations

"""/db routes: matches."""

import base64
import json
import sqlite3
import threading
import time
import zlib
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote
import requests
from flask import current_app, jsonify, request

from ...cache import cache
from ...heroes import get_hero_name
from ...utils.item_icons import item_icon_index, resolve_icon
from ....constants import ITEMS_URL
from ....game_version import resolve_game_version
from ....main import objective_lane, objective_name
from .core import (
    _build_replay_index_sync,
    _hero_ability_slots,
    _item_catalog,
    _item_class_names,
    _items_raw,
    _replay_download_base_url,
    _replay_index_path,
    _replay_index_write_lock,
    _replay_share_api_url,
    _rows_to_dicts,
    _schedule_data,
    bp,
    get_ro_conn,
    uncacheable,
)


_replay_file_cache_lock = threading.Lock()


def _cache_only_when_available(response):
    """Cache a route's answer only when it carries data.

    "Not recorded yet" is a normal state before a backfill, and caching it would leave
    the page showing the old answer for the whole timeout after the data lands, which
    reads as a backfill that did not work.
    """
    if response.status_code != 200:
        return False
    payload = response.get_json(silent=True)
    return bool(payload and payload.get("available"))


def _replay_scan_settings() -> tuple[int, float, float]:
    """Interactive scan limits: (max directories, total deadline, per-list timeout)."""
    config = current_app.config
    try:
        max_dirs = int(config.get("REPLAY_SCAN_MAX_DIRS", 100))
    except (TypeError, ValueError):
        max_dirs = 100
    try:
        deadline = float(config.get("REPLAY_SCAN_DEADLINE_SECONDS", 5.0))
    except (TypeError, ValueError):
        deadline = 5.0
    try:
        listing_timeout = float(config.get("REPLAY_LISTING_TIMEOUT_SECONDS", 3.0))
    except (TypeError, ValueError):
        listing_timeout = 3.0
    return max(1, max_dirs), max(0.1, deadline), max(0.5, listing_timeout)


def _fetch_replay_listing(
    path: str | None = None, timeout: float | None = None
) -> list[dict[str, Any]]:
    url = _replay_share_api_url()
    if path:
        # Filebrowser's public share API navigates by appending the folder path
        # to the share URL. (A ?path= query param is ignored by the server, which
        # would make the recursive scan never descend past the share root.)
        url = f"{url.rstrip('/')}/{quote(str(path).lstrip('/'), safe='/')}"
    if timeout is None:
        _, _, timeout = _replay_scan_settings()
    resp = requests.get(url, timeout=timeout)
    resp.raise_for_status()
    payload = resp.json()
    items = payload.get("items")
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []


def _build_replay_download_url(item_path: str) -> str:
    encoded_path = quote(item_path.lstrip("/"), safe="/")
    return f"{_replay_download_base_url()}/{encoded_path}"


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
            "retry_after_seconds": max(0, expires_at - now),
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


def _replay_match_item(
    match_id: int,
    max_dirs: int | None = None,
    deadline_seconds: float | None = None,
) -> tuple[dict[str, Any] | None, int, bool]:
    """Return (matched_item, visited_dir_count, scan_complete).

    Looks up a prebuilt replay index first (instant, no network). If the match
    is absent, it walks a bounded slice of the live share so newly uploaded
    replays can still be found without tying up a worker for minutes. The walk
    stops at the directory cap or total deadline, and reports whether it managed
    to inspect the whole tree.
    """
    payload = _load_replay_index()
    replays = payload.get("replays") or {}
    indexed = replays.get(str(match_id))
    if isinstance(indexed, dict):
        return indexed, 0, True

    configured_dirs, configured_deadline, listing_timeout = _replay_scan_settings()
    if max_dirs is None:
        max_dirs = configured_dirs
    if deadline_seconds is None:
        deadline_seconds = configured_deadline
    deadline = time.monotonic() + max(0.0, float(deadline_seconds))

    try:
        _schedule_index_refresh()
    except Exception:
        pass

    target_prefix = f"{match_id}"
    visited_dirs = 0
    seen_dirs: set[str] = set()
    stack: list[str] = [""]
    complete = True

    while stack and visited_dirs < max_dirs:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            complete = False
            break

        current_path = stack.pop()
        norm_path = (current_path or "").strip()
        if norm_path in seen_dirs:
            continue
        seen_dirs.add(norm_path)
        visited_dirs += 1

        try:
            items = _fetch_replay_listing(
                norm_path or None,
                timeout=max(0.25, min(listing_timeout, remaining)),
            )
        except Exception:
            # Ignore unreadable directories and continue scan, but remember that
            # the result is inconclusive so the negative cache stays short-lived.
            complete = False
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
            return item, visited_dirs, True

        for next_dir in sorted(dir_paths, reverse=True):
            if next_dir not in seen_dirs:
                stack.append(next_dir)

    if stack:
        complete = False
    current_app.logger.debug(
        "replay scan match=%s dirs=%s complete=%s", match_id, visited_dirs, complete
    )
    return None, visited_dirs, complete


@bp.get("/matches/tree")
@cache.cached(timeout=1800)
def matches_tree():
    """Return the title -> week -> set -> game tree, built from brackets.json."""
    try:
        return jsonify(_schedule_data())
    except Exception as e:
        return jsonify({"error": f"Failed to load schedule: {e}"}), 500


@bp.get("/matches/latest")
@cache.cached(timeout=300)
def latest_matches():  # type: ignore
    limit = int(current_app.config.get("API_LATEST_LIMIT", 50))
    with get_ro_conn() as conn:
        cur = conn.execute(
            "SELECT match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, start_time, game_version, created_at "
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
        conds.append("LOWER(m.event_title) = LOWER(?)")
        params.append(event_title)
    if event_week is not None:
        conds.append("m.event_week = ?")
        params.append(event_week)

    # Hero filter: resolve name to hero_ids, then JOIN players table
    if hero_filter:
        from ...heroes import get_all_hero_names
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
            f"SELECT {select_distinct}m.match_id, m.duration_s, m.winning_team, m.match_outcome, m.game_mode, m.match_mode, m.event_title, m.event_week, m.event_team_a, m.event_team_b, m.event_game, m.event_team_a_ingame_side, m.start_time, m.game_version, m.created_at {sql_base}{joins}{where} "
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
            from ...heroes import get_all_hero_names

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


@bp.get("/matches/<int:match_id>/version")
@cache.cached(timeout=600)
def match_game_version(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        row = conn.execute(
            "SELECT game_version, start_time FROM matches WHERE match_id = ?",
            (match_id,),
        ).fetchone()
    if row is None:
        return jsonify({"error": "match_not_found"}), 404
    version, start_time = row
    # Not yet backfilled: resolve from the local timestamp cache (read-only; the DB is not written).
    if version is None and start_time:
        version = resolve_game_version(start_time)
    return jsonify({"match_id": match_id, "game_version": version, "start_time": start_time})


@bp.get("/matches/<int:match_id>/adjacent")
@cache.cached(timeout=900)
def match_adjacent(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur_row = conn.execute(
            "SELECT start_time, winning_team, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, duration_s, match_vod, game_version FROM matches WHERE match_id = ?",
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
        "game_version": cur_row[10] if cur_row else None,
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
                    "retry_after_seconds": int(persisted_lookup.get("retry_after_seconds") or 0),
                    "error": "replay_not_found",
                    "message": "Replay was not found in replay_storage for this match ID.",
                }
            ), 404

    item, visited_dirs, scan_complete = _replay_match_item(match_id)
    if not item:
        try:
            partial_ttl = int(current_app.config.get("REPLAY_SCAN_PARTIAL_TTL_SECONDS", 300))
        except (TypeError, ValueError):
            partial_ttl = 300
        negative_ttl = ttl_seconds if scan_complete else min(ttl_seconds, max(1, partial_ttl))
        _set_persisted_replay_lookup(
            match_id,
            found=False,
            replay=None,
            ttl_seconds=negative_ttl,
            searched_dirs=visited_dirs,
        )
        return jsonify(
            {
                "ok": False,
                "match_id": match_id,
                "found": False,
                "cached": False,
                "scan_complete": scan_complete,
                "retry_after_seconds": negative_ttl,
                "searched_dirs": visited_dirs,
                "error": "replay_not_found",
                "message": (
                    "Replay was not found in replay_storage for this match ID."
                    if scan_complete
                    else "Replay was not found yet. The share index is refreshing; try again shortly."
                ),
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
            "scan_complete": scan_complete,
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
        # Lane provenance, so consumers never mix the two silently: `lane_source` names
        # the value in use (the inferred lane is preferred, the game-reported one is the
        # fallback) and `lane_agrees` says whether the two matched. Both are None-safe,
        # and `lane_agrees` is None whenever either side is missing.
        lane = p.get("lane")
        lane_real = p.get("lane_real")
        p["lane_source"] = (
            "inferred" if lane_real is not None else "assigned" if lane is not None else None
        )
        p["lane_agrees"] = None if lane is None or lane_real is None else lane_real == lane

    inferred = sum(1 for p in data if p["lane_source"] == "inferred")
    assigned = sum(1 for p in data if p["lane_source"] == "assigned")
    comparable = [p for p in data if p["lane_agrees"] is not None]
    return jsonify({
        "players": data,
        "lane_inference": {
            "inferred": inferred,
            "assigned": assigned,
            "unknown": len(data) - inferred - assigned,
            "comparable": len(comparable),
            "agree": sum(1 for p in comparable if p["lane_agrees"]),
        },
    })


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


@bp.get("/matches/<int:match_id>/events")
@cache.cached(timeout=3600, response_filter=_cache_only_when_available)
def match_events(match_id: int):  # type: ignore
    """Ordered match timeline: objective destructions, mid boss kills and deaths.

    Item purchases ride along in a separate `purchases` list: the metadata API logs
    every buy with its `game_time_s`, but a match carries a few hundred of them against
    a few dozen events, so merging the two would bury the timeline. Runes, neutral camps
    and sinner buffs are not here at all: the metadata API does not carry their
    timestamps, so they would need a demo-file query.
    """
    with get_ro_conn() as conn:
        objectives = conn.execute(
            "SELECT team, objective_id, destroyed_time_s, first_damage_time_s, "
            "player_damage, creep_damage, player_spirit_damage "
            "FROM match_objectives WHERE match_id = ? AND destroyed_time_s > 0 "
            "ORDER BY destroyed_time_s",
            (match_id,),
        ).fetchall()
        bosses = conn.execute(
            "SELECT boss_index, team_killed, team_claimed, destroyed_time_s "
            "FROM match_mid_boss WHERE match_id = ? ORDER BY boss_index",
            (match_id,),
        ).fetchall()
        deaths = conn.execute(
            "SELECT d.account_id, d.death_index, d.death_time_s, "
            "d.killer_player_slot, d.time_to_kill_s, d.death_duration_s, "
            "d.position_x, d.position_y, d.position_z, "
            "d.killer_position_x, d.killer_position_y, d.killer_position_z, "
            "p.player_slot, p.team, p.hero_id, u.persona_name "
            "FROM player_deaths d "
            "LEFT JOIN players p ON p.match_id = d.match_id AND p.account_id = d.account_id "
            "LEFT JOIN users u ON u.account_id = d.account_id "
            "WHERE d.match_id = ? "
            "ORDER BY d.death_time_s IS NULL, d.death_time_s, d.account_id, d.death_index",
            (match_id,),
        ).fetchall()
        row = conn.execute(
            "SELECT duration_s FROM matches WHERE match_id = ?", (match_id,)
        ).fetchone()
        listed = conn.execute(
            "SELECT p.account_id, p.player_slot, p.team, p.hero_id, "
            "u.persona_name, p.raw_items_json "
            "FROM players p "
            "LEFT JOIN users u ON u.account_id = p.account_id "
            "WHERE p.match_id = ? AND p.raw_items_json IS NOT NULL "
            "ORDER BY p.player_slot",
            (match_id,),
        ).fetchall()

    events: List[Dict[str, Any]] = []
    for (team, objective_id, destroyed_time_s, first_damage_time_s,
            player_damage, creep_damage, spirit_damage) in objectives:
        events.append({
            "type": "objective",
            "time_s": destroyed_time_s,
            "team": team,
            "objective_id": objective_id,
            "objective": objective_name(objective_id),
            "lane": objective_lane(objective_id),
            "first_damage_time_s": first_damage_time_s,
            "player_damage": player_damage,
            "creep_damage": creep_damage,
            "player_spirit_damage": spirit_damage,
        })
    for boss_index, team_killed, team_claimed, destroyed_time_s in bosses:
        events.append({
            "type": "mid_boss",
            "time_s": destroyed_time_s,
            "team": team_claimed,
            "boss_index": boss_index,
            "team_killed": team_killed,
            "team_claimed": team_claimed,
        })
    for (account_id, death_index, death_time_s, killer_slot, time_to_kill,
         death_duration_s, x, y, z, kx, ky, kz,
         player_slot, team, hero_id, persona_name) in deaths:
        events.append({
            "type": "death",
            "time_s": death_time_s,
            "team": team,
            "account_id": account_id,
            "death_index": death_index,
            "persona_name": persona_name,
            "player_slot": player_slot,
            "hero_id": hero_id,
            "killer_player_slot": killer_slot,
            "time_to_kill_s": time_to_kill,
            "death_duration_s": death_duration_s,
            "position": None if x is None and y is None and z is None else {"x": x, "y": y, "z": z},
            # Where the killer stood. Null for matches ingested before this was
            # captured, so the map can only draw kill lines when both ends exist.
            "killer_position": (
                None if kx is None and ky is None and kz is None else {"x": kx, "y": ky, "z": kz}
            ),
        })

    # Purchases, straight out of the metadata feed's per-player item log. That log also
    # carries one entry per hero-ability level, so the catalog is what separates a real
    # purchase from a level-up; the ids it does not know about are dropped with them.
    catalog = _item_catalog()
    purchases: List[Dict[str, Any]] = []
    for account_id, player_slot, team, hero_id, persona_name, raw_items_json in listed:
        try:
            entries = json.loads(raw_items_json)
        except (TypeError, ValueError):
            continue
        if not isinstance(entries, list):
            continue
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            item_id = entry.get("item_id")
            if item_id is None:
                continue
            try:
                item_id_int = int(item_id)
            except (TypeError, ValueError):
                continue
            meta = catalog.get(item_id_int)
            if not meta or meta.get("type") == "ability":
                continue
            purchases.append({
                "type": "purchase",
                "time_s": entry.get("game_time_s"),
                "team": team,
                "account_id": account_id,
                "player_slot": player_slot,
                "hero_id": hero_id,
                "persona_name": persona_name,
                "item_id": item_id_int,
                "item": meta.get("name"),
                "icon": meta.get("icon"),
                "image": meta.get("image"),
                "tier": meta.get("tier"),
                "slot": meta.get("slot"),
                # 0 means the player still owned it when the match ended.
                "sold_time_s": entry.get("sold_time_s") or None,
            })

    # Buys and sells land on the same second — a player sells a component to afford its
    # upgrade — so the slot is what keeps the order stable between requests.
    purchases.sort(key=lambda e: (e["time_s"] is None, e["time_s"] or 0, e["player_slot"] or 0))

    # Stable order: by time, then a fixed type order so simultaneous events read
    # the same way every request.
    type_order = {"objective": 0, "mid_boss": 1, "death": 2}
    events.sort(key=lambda e: (e["time_s"] is None, e["time_s"] or 0, type_order.get(e["type"], 9)))

    return jsonify({
        "match_id": match_id,
        "duration_s": row[0] if row else None,
        # False when the timeline rows have not been ingested for this match yet.
        "available": bool(objectives),
        "count": len(events),
        "counts": {
            "objectives": len(objectives),
            "mid_boss": len(bosses),
            "deaths": len(deaths),
            "purchases": len(purchases),
        },
        "events": events,
        "purchases": purchases,
    })


@bp.get("/matches/<int:match_id>/positions")
@cache.cached(timeout=3600, response_filter=_cache_only_when_available)
def match_positions(match_id: int):  # type: ignore
    """Per-player position trails for the map replay, one sample per second.

    Samples are stored in world coordinates, so the map's own world->image transform
    places them directly. They come back as base64 little-endian int16 with x and y
    interleaved: a whole match is ~100 KB this way against several hundred KB of JSON.
    """
    with get_ro_conn() as conn:
        rows = conn.execute(
            "SELECT t.player_slot, t.account_id, t.interval_s, t.sample_count, "
            "t.world_min_x, t.world_max_x, t.world_min_y, t.world_max_y, t.positions, "
            "p.team, p.hero_id, u.persona_name "
            "FROM match_player_paths t "
            "LEFT JOIN players p ON p.match_id = t.match_id AND p.player_slot = t.player_slot "
            "LEFT JOIN users u ON u.account_id = t.account_id "
            "WHERE t.match_id = ? ORDER BY t.player_slot",
            (match_id,),
        ).fetchall()
        row = conn.execute(
            "SELECT duration_s FROM matches WHERE match_id = ?", (match_id,)
        ).fetchone()

    players: List[Dict[str, Any]] = []
    extent: Optional[Dict[str, float]] = None
    interval_s: Optional[float] = None
    for (player_slot, account_id, player_interval, sample_count,
         min_x, max_x, min_y, max_y, positions, team, hero_id, persona_name) in rows:
        if interval_s is None:
            interval_s = player_interval
        if positions is None:
            continue
        if extent is None:
            extent = {"min_x": min_x, "max_x": max_x, "min_y": min_y, "max_y": max_y}
        else:
            extent["min_x"] = min(extent["min_x"], min_x)
            extent["max_x"] = max(extent["max_x"], max_x)
            extent["min_y"] = min(extent["min_y"], min_y)
            extent["max_y"] = max(extent["max_y"], max_y)
        players.append({
            "player_slot": player_slot,
            "account_id": account_id,
            "team": team,
            "hero_id": hero_id,
            "persona_name": persona_name,
            "sample_count": sample_count,
            "extent": {"min_x": min_x, "max_x": max_x, "min_y": min_y, "max_y": max_y},
            "positions": base64.b64encode(zlib.decompress(positions)).decode("ascii"),
        })

    return jsonify({
        "match_id": match_id,
        "duration_s": row[0] if row else None,
        "interval_s": interval_s,
        # False when the trails have not been ingested for this match yet.
        "available": bool(players),
        "count": len(players),
        "extent": extent,
        "players": players,
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
    # Item catalogue comes from the shared stale-while-revalidate loader.
    item_catalog = _items_raw()
    if not item_catalog:
        return uncacheable(jsonify({}))

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
    item_catalog = _items_raw()
    if not item_catalog:
        return uncacheable(jsonify({}))

    icons = item_icon_index()
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
            # The shipped art path, so the client never has to rebuild a filename
            # from the display name (which the game does not match).
            shipped = resolve_icon(item, icons)
            item_lookup[iid_int] = {
                "name": item.get("name", ""),
                "image": item.get("image", ""),
                "item_slot_type": item.get("item_slot_type", ""),
                "item_tier": item.get("item_tier"),
                "type": item_type,
                "icon": f"items/{shipped}" if shipped else None,
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
                    enriched_abilities.append({
                        **meta,
                        "ability_id": aid_int,
                        # Which of the hero's four abilities this is. The payload's own
                        # order is the order points were spent in, so a client cannot
                        # derive the slot from position.
                        "slot": _ability_slot(meta.get("hero"), aid_int),
                        "upgrades": upgrades,
                    })
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
                    enriched_abilities.append({
                        **meta,
                        "ability_id": aid_int,
                        "slot": _ability_slot(meta.get("hero"), aid_int),
                        "upgrades": upgrades,
                    })
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

    # Look up series-level title from brackets.json (e.g. "EU QUALIFIER", "CHALLENGER MATCH")
    series_title = ""
    try:
        mdata = _schedule_data()
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


def _ability_slot(hero_id: Any, ability_id: Any) -> Optional[int]:
    """A hero's ability as slot 1-4, or None when the catalogues cannot say.

    The match payload's abilities carry the hero they belong to, and
    `_hero_ability_slots` already holds the hero -> ability id -> slot mapping the
    damage-source groups use, so ordering a build grid costs no extra lookup.
    """
    try:
        hero = int(hero_id)
        ability = int(ability_id)
    except (TypeError, ValueError):
        return None
    hero_slots = _hero_ability_slots().get(hero) or {}
    return (hero_slots.get("slots") or {}).get(ability)
