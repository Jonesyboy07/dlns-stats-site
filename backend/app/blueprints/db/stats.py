from __future__ import annotations

"""/db routes: stats."""

from typing import Any, Dict, List
from flask import jsonify, request

from ...cache import cache
from ...heroes import get_hero_name
from ...utils import stats_summary as ss
from ....steam_news import iso_to_epoch, news_for_games
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

    # Matches ingested but not yet recorded in the authored schedule (brackets.json,
    # or legacy matches.json) would otherwise vanish from pages that group matches
    # through this map — the home page skips any match without a detail row. Fill
    # those in from the database so a new week still appears once its games are in.
    try:
        with get_ro_conn() as conn:
            sql = (
                "SELECT match_id, event_title, event_week, event_team_a, event_team_b, "
                "event_game, event_subtitle, match_vod FROM matches "
                "WHERE event_week IS NOT NULL "
                "AND event_title IS NOT NULL AND TRIM(event_title) != ''"
            )
            params: tuple[Any, ...] = ()
            if event_title_filter_lc:
                sql += " AND LOWER(event_title) = ?"
                params = (event_title_filter_lc,)
            cur = conn.execute(sql, params)
            for row in _rows_to_dicts(cur):
                key = str(row["match_id"])
                if key in details:
                    continue
                result.setdefault(key, row["event_week"])
                details[key] = {
                    "series": row["event_title"],
                    "week": row["event_week"],
                    "team_a": row["event_team_a"],
                    "team_b": row["event_team_b"],
                    "game": row["event_game"],
                    "series_title": (row["event_subtitle"] or "").strip(),
                    "match_vod": row["match_vod"] or "",
                }
    except Exception:
        # The authored schedule is still a usable answer if the DB is unavailable.
        pass

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


# ── Redesigned stats page ──
# `/stats/periods` feeds the Period picker (weeks, their match counts and the
# patches they were played on); `/stats/summary` feeds the headline and the
# Overview tab for one week range and region. Both read Night Shift by default.

_STATS_MATCH_SQL = """
    SELECT match_id, event_week, event_region, event_team_a, event_team_b,
           winning_team, duration_s, start_time
    FROM matches
    WHERE LOWER(event_title) = LOWER(?) AND event_week IS NOT NULL AND match_id > 0
    ORDER BY event_week ASC, COALESCE(start_time, '') ASC, match_id ASC
"""


def _stats_event_title() -> str:
    return (request.args.get("event_title") or "").strip() or "Night Shift"


def _stats_matches(conn, event_title: str):
    rows = _rows_to_dicts(conn.execute(_STATS_MATCH_SQL, (event_title,)))
    return rows, ss.resolve_regions(rows)


def _region_order(regions: Dict[int, Any]) -> List[str]:
    return sorted({region for region in regions.values() if region})


def _stats_filters(rows: List[Dict[str, Any]], region_names: List[str]):
    """The requested ?weeks= range (default: the last two weeks) and region (None = all)."""
    last_week = max(row["event_week"] for row in rows)
    weeks = ss.parse_weeks(request.args.get("weeks")) or (max(last_week - 1, 1), last_week)
    requested = ss.normalize_region(request.args.get("region"))
    return weeks, requested if requested in region_names else None


def _stats_players(conn, event_title: str, first_week: int, last_week: int) -> Dict[int, List[Dict[str, Any]]]:
    """Player rows of the event's matches in a week range, grouped by match."""
    cur = conn.execute(
        """
        SELECT p.match_id, p.account_id, p.hero_id, p.result,
               p.kills, p.deaths, p.assists, p.player_damage, p.obj_damage,
               p.player_healing, p.net_worth, p.last_hits, p.denies, u.persona_name
        FROM players p
        JOIN matches m ON m.match_id = p.match_id
        LEFT JOIN users u ON u.account_id = p.account_id
        WHERE LOWER(m.event_title) = LOWER(?) AND m.event_week BETWEEN ? AND ?
        """,
        (event_title, first_week, last_week),
    )
    players_by_match: Dict[int, List[Dict[str, Any]]] = {}
    for player in _rows_to_dicts(cur):
        players_by_match.setdefault(player["match_id"], []).append(player)
    return players_by_match


def _with_hero_names(entries: List[Dict[str, Any]], key: str, name_key: str) -> List[Dict[str, Any]]:
    for entry in entries:
        hero = entry.get(key)
        entry[name_key] = get_hero_name(hero) if hero is not None else None
    return entries


def _week_update(matches: List[Dict[str, Any]]) -> Any:
    """The game update a week's games were played under, as the week page shows it."""
    games = []
    for match in matches:
        start = iso_to_epoch(match.get("start_time"))
        if start is not None:
            games.append((start, start + int(match.get("duration_s") or 0)))
    return news_for_games(games).get("update") if games else None


@bp.get("/stats/periods")
@cache.cached(timeout=1800, query_string=True)
def stats_periods():
    """Every week of the event with its match count, and the patches over them."""
    event_title = _stats_event_title()
    with get_ro_conn() as conn:
        rows, regions = _stats_matches(conn, event_title)
    if not rows:
        return jsonify({"event_title": event_title, "regions": [], "weeks": [], "patches": []})

    by_week: Dict[int, List[Dict[str, Any]]] = {}
    for row in rows:
        by_week.setdefault(row["event_week"], []).append(row)
    region_names = _region_order(regions)

    weeks = []
    week_updates = []
    for week in range(min(by_week), max(by_week) + 1):
        games = by_week.get(week, [])
        counts = {name: 0 for name in region_names}
        for game in games:
            region = regions.get(game["match_id"])
            if region in counts:
                counts[region] += 1
        weeks.append({"week": week, "matches": len(games), "regions": counts})
        week_updates.append((week, _week_update(games)))

    return jsonify(
        {
            "event_title": event_title,
            "regions": region_names,
            "weeks": weeks,
            "patches": ss.group_patches(week_updates),
        }
    )


def _longest(matches: List[Dict[str, Any]]) -> Any:
    timed = [m for m in matches if (m.get("duration_s") or 0) > 0]
    return max(timed, key=lambda m: (m["duration_s"], -m["match_id"]), default=None)


@bp.get("/stats/summary")
@cache.cached(timeout=1800, query_string=True)
def stats_summary():
    """Headline and Overview aggregates for ?weeks=a-b&region=All|EU|NA.

    `weeks` defaults to the event's last two weeks. The headline's change lines
    compare the range's last week with the week before it, whether or not that
    week is inside the range.
    """
    event_title = _stats_event_title()
    with get_ro_conn() as conn:
        rows, regions = _stats_matches(conn, event_title)
        region_names = _region_order(regions)
        if not rows:
            return jsonify({"event_title": event_title, "regions": region_names, "range": None})

        first_week = min(row["event_week"] for row in rows)
        (start, end), region = _stats_filters(rows, region_names)
        # Players for the range plus the week the change lines look back to.
        players_by_match = _stats_players(conn, event_title, min(start, end - 1), end)

    in_range, latest_w, previous_w = (start, end), (end, end), (end - 1, end - 1)

    def block(name):
        return {
            "range": ss.summarize(ss.scoped(rows, regions, name, in_range), players_by_match),
            "latest": ss.summarize(ss.scoped(rows, regions, name, latest_w), players_by_match),
            "previous": ss.summarize(ss.scoped(rows, regions, name, previous_w), players_by_match),
        }

    headline = {"All": block(None)}
    for name in region_names:
        headline[name] = block(name)

    scope = ss.scoped(rows, regions, region, in_range)
    timed = [m for m in scope if (m.get("duration_s") or 0) > 0]
    shortest = min(timed, key=lambda m: (m["duration_s"], m["match_id"]), default=None)
    longest = _longest(scope)
    ref = lambda m: ss.game_ref(m, regions.get(m["match_id"]) if m else None)  # noqa: E731

    heroes = sorted(
        (
            {"hero_id": hero, "name": get_hero_name(hero), "picks": entry["picks"], "wins": entry["wins"]}
            for hero, entry in ss.hero_rates(scope, players_by_match).items()
        ),
        key=lambda h: (-h["picks"], h["hero_id"]),
    )

    latest = ss.scoped(rows, regions, region, latest_w)
    previous = ss.scoped(rows, regions, region, previous_w)
    riser = ss.biggest_riser(latest, previous, players_by_match)
    if riser:
        riser["name"] = get_hero_name(riser["hero_id"])
    record = ss.record_set(scope, players_by_match, end)
    if record and record.get("hero_id") is not None:
        record["hero_name"] = get_hero_name(record["hero_id"])
    # Per region, or the whole event when no match has a region yet.
    swing_regions = [region] if region else region_names or ["All"]
    scope_of = lambda name: None if name == "All" else name  # noqa: E731
    swing = ss.side_swing(
        {name: ss.scoped(rows, regions, scope_of(name), latest_w) for name in swing_regions},
        {name: ss.scoped(rows, regions, scope_of(name), previous_w) for name in swing_regions},
        end,
    )

    return jsonify(
        {
            "event_title": event_title,
            "regions": region_names,
            "region": region or "All",
            "range": [start, end],
            "latest_week": end,
            "previous_week": end - 1,
            "headline": headline,
            "side": {
                "amber_wins": sum(1 for m in scope if m.get("winning_team") == 0),
                "sapphire_wins": sum(1 for m in scope if m.get("winning_team") == 1),
                "trend": [
                    point
                    for point in ss.side_trend(ss.scoped(rows, regions, region), end)
                    if point["week"] >= first_week
                ],
            },
            "length": {
                "games": len(timed),
                "average": round(sum(m["duration_s"] for m in timed) / len(timed)) if timed else None,
                "shortest": ref(shortest),
                "longest": ref(longest),
                "buckets": ss.duration_buckets([m["duration_s"] for m in timed]),
            },
            "heroes": {"matches": len(scope), "list": heroes},
            "this_week": {
                "week": end,
                "riser": riser,
                "record": record,
                "longest": ref(_longest(latest)),
                "side_swing": swing,
            },
        }
    )


def _scoped_for_tab():
    """Matches and players for one ?weeks=&region= view, or None when the event is empty."""
    event_title = _stats_event_title()
    with get_ro_conn() as conn:
        rows, regions = _stats_matches(conn, event_title)
        if not rows:
            return event_title, None
        (start, end), region = _stats_filters(rows, _region_order(regions))
        players_by_match = _stats_players(conn, event_title, start, end)
    scope = ss.scoped(rows, regions, region, (start, end))
    return event_title, {"scope": scope, "players": players_by_match, "regions": regions, "range": [start, end], "region": region or "All"}


@bp.get("/stats/records-board")
@cache.cached(timeout=1800, query_string=True)
def stats_records_board():
    """The Records tab for ?weeks=a-b&region=: the top five games for each record."""
    event_title, view = _scoped_for_tab()
    if view is None:
        return jsonify({"event_title": event_title, "range": None, "records": []})
    cards = ss.record_cards(view["scope"], view["players"], view["regions"])
    for card in cards:
        if card["kind"] == "player":
            _with_hero_names(card["entries"], "hero_id", "hero_name")
    return jsonify({"event_title": event_title, "range": view["range"], "region": view["region"], "records": cards})


@bp.get("/stats/leaderboards")
@cache.cached(timeout=1800, query_string=True)
def stats_leaderboards():
    """The Leaderboards tab for ?weeks=a-b&region=: every stat, by Average and Total."""
    event_title, view = _scoped_for_tab()
    if view is None:
        return jsonify({"event_title": event_title, "range": None, "stats": {}})
    boards = ss.leaderboards(view["scope"], view["players"])
    for modes in boards.values():
        for rows in modes.values():
            _with_hero_names(rows, "top_hero_id", "top_hero_name")
    return jsonify(
        {
            "event_title": event_title,
            "range": view["range"],
            "region": view["region"],
            "min_games": ss.LEADER_MIN_GAMES,
            "stats": boards,
        }
    )
