from __future__ import annotations

"""/db routes: stats."""

from typing import Any, Dict, List
from flask import jsonify, request

from ...cache import cache
from .core import (
    _rows_to_dicts,
    _schedule_data,
    bp,
    get_ro_conn,
)


@bp.get("/weeks")
@cache.cached(timeout=3600, query_string=True)
def weeks_map():  # type: ignore
    event_title_filter = (request.args.get("event_title") or "").strip()
    event_title_filter_lc = event_title_filter.lower()
    try:
        data = _schedule_data()
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
