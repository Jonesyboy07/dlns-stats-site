from __future__ import annotations

"""/db routes: teams."""

from typing import Any, Dict, List
from flask import jsonify

from ...cache import cache
from ...heroes import get_hero_name
from .core import (
    MIN_SIGNATURE_ITEM_TIER,
    _item_catalog,
    _rows_to_dicts,
    bp,
    get_ro_conn,
)


# DLNS's 3-lane map, in scoreboard order: York, Broadway, Greenwich. Mirrors
# LANE_ORDER in MatchDetail.jsx so hero lineups read identically in both places.
LANE_ORDER = (1, 4, 6)


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


SIGNATURE_ITEM_LIMIT = 3


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
        from ...heroes import get_all_hero_names
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
        # reads: lane by lane (York, Broadway, Greenwich), then in-game slot.
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
