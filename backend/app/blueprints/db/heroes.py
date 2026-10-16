from __future__ import annotations

"""/db routes: heroes."""

import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
import requests
from flask import current_app, jsonify

from ...cache import cache
from ....constants import ITEMS_URL
from .core import (
    _ability_builds,
    _hero_ability_slots,
    _item_catalog,
    _items_raw,
    _match_won,
    _rows_to_dicts,
    bp,
    get_ro_conn,
    uncacheable,
)


@bp.get("/heroes")
@cache.cached(timeout=21600)  # Cache for 6 hours
def get_heroes():
    """Return hero ID to name mapping for JavaScript."""
    from ...heroes import _load_if_needed, _names, _lock
    
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
    item_catalog = _items_raw()
    if not item_catalog:
        return uncacheable(jsonify({"items": []}))

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
    from ...heroes import get_all_hero_names

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
