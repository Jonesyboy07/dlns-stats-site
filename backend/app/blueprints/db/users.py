from __future__ import annotations

"""/db routes: users."""

import json
import re
import sqlite3
from pathlib import Path
from typing import Any, Dict, List, Optional
from urllib.parse import quote
from flask import current_app, jsonify, request

from ...cache import cache
from ...heroes import get_hero_name
from .core import (
    MIN_SIGNATURE_ITEM_TIER,
    _ability_builds,
    _hero_ability_slots,
    _item_catalog,
    _item_class_names,
    _match_won,
    _rows_to_dicts,
    bp,
    get_ro_conn,
)


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
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.net_worth, p.last_hits, p.denies, p.creep_kills, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, p.level, p.lane, p.lane_real, m.duration_s, m.winning_team, m.game_mode, m.match_mode, m.start_time, m.game_version, m.created_at, m.event_title, m.event_week, m.event_game, m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.match_vod "
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
            "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.net_worth, p.last_hits, p.denies, p.creep_kills, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, p.level, p.lane, p.lane_real, m.duration_s, m.winning_team, m.start_time, m.game_version, m.created_at, m.event_week, m.event_game, m.event_team_a, m.event_team_b, m.event_team_a_ingame_side, m.match_vod "
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
    from ...heroes import get_all_hero_names

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
    from ...heroes import get_all_hero_names

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
            from ...heroes import get_all_hero_names

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


# The player profile's Items & Build panel shows more than the roster card does.
SIGNATURE_ITEM_PROFILE_LIMIT = 6


BUILD_ORDER_LIMIT = 6


# The rank block only renders while the player is inside the top N of the hero's
# pool, and win-rate standings need this many decided games.
RANK_TOP_N = 10


RANK_MIN_GAMES = 5


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
