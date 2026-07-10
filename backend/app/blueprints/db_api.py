from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import quote

import requests

from flask import Blueprint, current_app, jsonify, request
from ..cache import cache
from dotenv import load_dotenv
from ..heroes import get_hero_name

load_dotenv()
bp = Blueprint("dlns_db_api", __name__, url_prefix="/db")
_replay_file_cache_lock = threading.Lock()


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
    params: dict[str, str] = {}
    if path:
        params["path"] = path
    resp = requests.get(url, params=params, timeout=10)
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
        return {"version": 1, "entries": {}}
    try:
        with path.open("r", encoding="utf-8") as f:
            raw = json.load(f)
        if isinstance(raw, dict):
            entries = raw.get("entries")
            if isinstance(entries, dict):
                return {"version": 1, "entries": entries}
    except Exception:
        current_app.logger.warning("Replay URL file cache unreadable: %s", path)
    return {"version": 1, "entries": {}}


def _write_replay_file_cache(payload: dict[str, Any]) -> None:
    path = _replay_file_cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    tmp_path.replace(path)


def _get_persisted_replay(match_id: int) -> dict[str, Any] | None:
    now = int(time.time())
    key = str(match_id)
    with _replay_file_cache_lock:
        cache_payload = _load_replay_file_cache()
        entries = cache_payload.get("entries") or {}
        entry = entries.get(key)
        if not isinstance(entry, dict):
            return None
        expires_at = int(entry.get("expires_at") or 0)
        replay = entry.get("replay")
        if expires_at <= now or not isinstance(replay, dict):
            entries.pop(key, None)
            cache_payload["entries"] = entries
            _write_replay_file_cache(cache_payload)
            return None
        return replay


def _set_persisted_replay(match_id: int, replay: dict[str, Any], ttl_seconds: int) -> None:
    now = int(time.time())
    key = str(match_id)
    with _replay_file_cache_lock:
        cache_payload = _load_replay_file_cache()
        entries = cache_payload.get("entries") or {}
        entries[key] = {
            "cached_at": now,
            "expires_at": now + max(1, int(ttl_seconds)),
            "replay": replay,
        }
        cache_payload["entries"] = entries
        _write_replay_file_cache(cache_payload)


def _replay_match_item(match_id: int, max_dirs: int = 3000) -> tuple[dict[str, Any] | None, int]:
    """Return (matched_item, visited_dir_count) by recursively walking the public share API."""
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
        match_ids = [m["match_id"] for m in matches]
        if match_ids:
            placeholders = ",".join("?" * len(match_ids))
            pcur = conn.execute(
                f"SELECT p.match_id, p.team, p.hero_id, u.persona_name, p.account_id "
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


@bp.get("/matches/<int:match_id>/adjacent")
@cache.cached(timeout=900)
def match_adjacent(match_id: int):  # type: ignore
    with get_ro_conn() as conn:
        cur_row = conn.execute(
            "SELECT start_time, winning_team, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, duration_s FROM matches WHERE match_id = ?",
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
        "previous_match_id": prev_row[0] if prev_row else None,
        "next_match_id": next_row[0] if next_row else None,
    })


@bp.get("/matches/<int:match_id>/replay")
def match_replay(match_id: int):
    """Resolve a replay ZIP for a match and return a direct filebrowser download URL."""
    # Match IDs in DB can be placeholders (negative). Replays are only meaningful for positive IDs.
    if match_id <= 0:
        return jsonify({"ok": False, "error": "invalid_match_id"}), 400

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
    if isinstance(cached_replay, dict) and cached_replay.get("download_url"):
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

    persisted_replay = _get_persisted_replay(match_id)
    if isinstance(persisted_replay, dict) and persisted_replay.get("download_url"):
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

    item, visited_dirs = _replay_match_item(match_id)
    if not item:
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
    _set_persisted_replay(match_id, replay_payload, ttl_seconds)

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
            "SELECT p.*, u.persona_name FROM players p "
            "LEFT JOIN users u ON u.account_id = p.account_id "
            "WHERE p.match_id = ? ORDER BY p.team, p.player_slot",
            (match_id,),
        )
        data = _rows_to_dicts(cur)
        
        
        return jsonify({"players": data})


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
                "https://assets.deadlock-api.com/v2/items",
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
                "https://assets.deadlock-api.com/v2/items",
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
            "SELECT p.*, u.persona_name FROM players p "
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
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.last_hits, p.denies, p.creep_kills, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, m.duration_s, m.winning_team, m.game_mode, m.match_mode, m.start_time, m.created_at, m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.event_week "
            "FROM players p JOIN matches m ON m.match_id = p.match_id WHERE p.account_id = ? ORDER BY m.created_at DESC",
            (account_id,),
        )
        data = _rows_to_dicts(cur)
        
        # Enhance with hero names
        for match in data:
            if match.get('hero_id'):
                match['hero_name'] = get_hero_name(match['hero_id'])
        
        return jsonify({"matches": data})

@bp.get("/users/<int:account_id>/matches/paged")
@cache.cached(timeout=900, query_string=True)
def user_matches_paged_api(account_id: int):
    order = (request.args.get("order") or "desc").lower()
    order = "asc" if order == "asc" else "desc"
    res = (request.args.get("res") or "").lower()  # win|loss|''
    teamf = request.args.get("team") or ""
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
    if teamf in ("0", "1"):
        conds.append("p.team = ?")
        params.append(int(teamf))

    where = " WHERE p.account_id = ?" + (" AND " + " AND ".join(conds) if conds else "")
    with get_ro_conn() as conn:
        ccur = conn.execute(
            "SELECT COUNT(1) FROM players p JOIN matches m ON m.match_id = p.match_id" + where,
            tuple(params)
        )
        total = ccur.fetchone()[0]
        cur = conn.execute(
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.creep_kills, p.last_hits, p.denies, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, m.duration_s, m.winning_team, m.start_time, m.created_at "
            "FROM players p JOIN matches m ON m.match_id = p.match_id" + where +
            f" ORDER BY COALESCE(m.start_time, m.created_at) {'ASC' if order == 'asc' else 'DESC'} LIMIT ? OFFSET ?",
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
    return jsonify({"results": results})

@bp.get("/heroes")
@cache.cached(timeout=21600)  # Cache for 6 hours
def get_heroes():
    """Return hero ID to name mapping for JavaScript."""
    from ..heroes import _load_if_needed, _names, _lock
    
    with _lock:
        _load_if_needed()
        # Return the heroes dict directly - this will be the flat ID->name mapping
        return jsonify(_names)


@bp.get("/heroes/<int:hero_id>/stats")
@cache.cached(timeout=1800)
def hero_stats(hero_id: int):
    """Return aggregated stats for a specific hero across all matches."""
    with get_ro_conn() as conn:
        cur = conn.execute(
            """
            SELECT
                COUNT(*) as games_played,
                SUM(CASE WHEN result = 'Win' THEN 1 ELSE 0 END) as wins,
                ROUND(AVG(kills), 2) as avg_kills,
                ROUND(AVG(deaths), 2) as avg_deaths,
                ROUND(AVG(assists), 2) as avg_assists,
                ROUND(AVG(CAST(kills + assists AS REAL) / MAX(deaths, 1)), 2) as avg_kda,
                ROUND(AVG(player_damage), 0) as avg_damage,
                ROUND(AVG(obj_damage), 0) as avg_obj_damage,
                ROUND(AVG(player_healing), 0) as avg_healing,
                ROUND(AVG(net_worth), 0) as avg_souls,
                MAX(kills) as max_kills,
                MAX(player_damage) as max_damage,
                MAX(player_healing) as max_healing,
                MAX(obj_damage) as max_obj_damage
            FROM players
            WHERE hero_id = ?
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
                "https://assets.deadlock-api.com/v2/items",
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
                       u.persona_name
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

    return jsonify({
        "event_title": event_title,
        "event_week": event_week,
        "event_team_a": event_team_a,
        "event_team_b": event_team_b,
        "matches": matches,
    })


@bp.get("/teams")
@cache.cached(timeout=3600)
def get_teams():
    """Return list of all unique team names with match counts."""
    with get_ro_conn() as conn:
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
            GROUP BY LOWER(team_name)
            ORDER BY LOWER(team_name) ASC
            """
        )
        return jsonify({"teams": _rows_to_dicts(cur)})


@bp.get("/team/<path:team_name>")
@cache.cached(timeout=1800)
def get_team_detail(team_name: str):
    """Return team detail: players sorted by appearances and full match history."""
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

        row = conn.execute(
            """
            SELECT MAX(event_week) FROM matches
            WHERE (LOWER(event_team_a) = LOWER(?) OR LOWER(event_team_b) = LOWER(?)) AND event_week IS NOT NULL
            """,
            (team_name, team_name),
        ).fetchone()
        max_week = row[0] if row else None

        # Use event_team_a_ingame_side to restrict to players on the correct side.
        # When team is team_a: their in-game side = event_team_a_ingame_side → p.team = event_team_a_ingame_side
        # When team is team_b: their in-game side = 1 - event_team_a_ingame_side → p.team != event_team_a_ingame_side
        # Fallback (no ingame_side data): include all players from matching matches.
        cur = conn.execute(
            """
            SELECT
                p.account_id,
                u.persona_name,
                COUNT(DISTINCT m.match_id) AS appearances,
                MAX(m.event_week) AS last_week,
                MIN(m.event_week) AS first_week
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.account_id IS NOT NULL
              AND (
                (LOWER(m.event_team_a) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team = m.event_team_a_ingame_side)
                OR
                (LOWER(m.event_team_b) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team != m.event_team_a_ingame_side)
                OR
                (m.event_team_a_ingame_side IS NULL AND (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?)))
              )
            GROUP BY p.account_id, u.persona_name
            ORDER BY appearances DESC, u.persona_name ASC
            LIMIT 200
            """,
            (team_name, team_name, team_name, team_name),
        )
        players = _rows_to_dicts(cur)

        cur2 = conn.execute(
            """
            SELECT
                m.match_id, m.event_game, m.event_week, m.event_title,
                m.event_team_a, m.event_team_b, m.event_team_a_ingame_side,
                m.winning_team, m.duration_s, m.start_time
            FROM matches m
            WHERE LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?)
            ORDER BY m.start_time DESC
            """,
            (team_name, team_name),
        )
        matches = _rows_to_dicts(cur2)

        cur3 = conn.execute(
            """
            SELECT
                p.hero_id,
                COUNT(*) AS picks
            FROM players p
            JOIN matches m ON m.match_id = p.match_id
            WHERE p.hero_id IS NOT NULL
              AND (
                (LOWER(m.event_team_a) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team = m.event_team_a_ingame_side)
                OR
                (LOWER(m.event_team_b) = LOWER(?) AND m.event_team_a_ingame_side IS NOT NULL AND p.team != m.event_team_a_ingame_side)
                OR
                (m.event_team_a_ingame_side IS NULL AND (LOWER(m.event_team_a) = LOWER(?) OR LOWER(m.event_team_b) = LOWER(?)))
              )
            GROUP BY p.hero_id
            ORDER BY picks DESC
            LIMIT 20
            """,
            (team_name, team_name, team_name, team_name),
        )
        hero_picks_raw = _rows_to_dicts(cur3)

        from ..heroes import get_all_hero_names
        all_names = get_all_hero_names()
        hero_picks = [
            {
                "hero_id": row["hero_id"],
                "hero_name": all_names.get(str(row["hero_id"]), f"Hero {row['hero_id']}"),
                "picks": row["picks"],
            }
            for row in hero_picks_raw
        ]

        return jsonify({
            "team_name": team_name,
            "max_week": max_week,
            "total_matches": len(matches),
            "players": players,
            "matches": matches,
            "hero_picks": hero_picks,
        })


@bp.get("/nightshift/<int:week>")
@cache.cached(timeout=1800)
def nightshift_week(week: int):
    """Return all matches and summary stats for a given Night Shift week."""
    event_title = request.args.get("event_title", "Night Shift")
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
            WHERE event_title = ? AND event_week = ?
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
                m.start_time
            FROM matches m
            WHERE m.event_title = ? AND m.event_week = ?
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
                       p.account_id, u.persona_name
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

        # Neighbouring weeks so the page can offer prev/next navigation
        neighbours = conn.execute(
            """
            SELECT DISTINCT event_week FROM matches
            WHERE event_title = ? AND event_week IS NOT NULL
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
            "all_weeks": all_weeks,
            "vod_link": vod_link,
            "vod_links": vod_links,
            "series_vods": series_vods,
            "game_vods": game_vods,
        })
