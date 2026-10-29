"""Aggregates for the redesigned stats page (`/stats`).

The page is driven by one filter: a Night Shift week range and a region. The
headline compares regions over that range and the range's last week with the
week before it; the Overview tab adds side balance, match length, hero pick vs
win rates and a few "this week" highlights.

Everything here is pure: no Flask, no database. Match rows come in as dicts with
the `matches` columns the route selects, players as dicts keyed by `match_id`.
Seconds stay seconds and rates stay 0-100 percentages; formatting is the page's.
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

# Weeks shown on the side-balance sparkline, ending at the range's last week.
TREND_WEEKS = 8

# Histogram bucket width for match length.
BUCKET_S = 300

# Single-game stats a "record set" highlight can name, in the order it prefers them.
RECORD_STATS: Tuple[Tuple[str, str], ...] = (
    ("kills", "Most kills"),
    ("assists", "Most assists"),
    ("player_damage", "Most player damage"),
    ("obj_damage", "Most objective damage"),
    ("player_healing", "Most healing"),
    ("net_worth", "Highest souls"),
)

# The Records tab's cards: every single-game best above, two more player stats,
# and the fastest and longest games.
RECORD_CARDS: Tuple[Tuple[str, str], ...] = RECORD_STATS + (
    ("last_hits", "Most last hits"),
    ("denies", "Most denies"),
)
RECORD_LIMIT = 5

# The Leaderboards tab: stats players are ranked on, the games a player needs to be
# ranked at all (in both Average and Total), and how many rows each table shows.
LEADER_STATS: Tuple[str, ...] = (
    "kills",
    "assists",
    "player_damage",
    "obj_damage",
    "player_healing",
    "net_worth",
    "last_hits",
    "denies",
    "kda",
)
LEADER_MIN_GAMES = 5
LEADER_LIMIT = 10


def normalize_region(value: Optional[str]) -> Optional[str]:
    region = (value or "").strip().upper()
    return region or None


def resolve_regions(rows: Iterable[Dict[str, Any]]) -> Dict[int, Optional[str]]:
    """Each match's region, with blanks filled in from the same week's teams.

    `event_region` is hand-authored and occasionally blank. A team plays in one
    region per week, so a blank row borrows the region of another match that
    week with either of its teams, the same inference the Night Shift index uses.
    """
    rows = list(rows)
    known: Dict[Tuple[Any, str], str] = {}
    for row in rows:
        region = normalize_region(row.get("event_region"))
        if not region:
            continue
        for team in (row.get("event_team_a"), row.get("event_team_b")):
            if team:
                known[(row.get("event_week"), team)] = region

    resolved: Dict[int, Optional[str]] = {}
    for row in rows:
        region = normalize_region(row.get("event_region"))
        if not region:
            week = row.get("event_week")
            region = known.get((week, row.get("event_team_a"))) or known.get(
                (week, row.get("event_team_b"))
            )
        resolved[row["match_id"]] = region
    return resolved


def parse_weeks(value: Optional[str]) -> Optional[Tuple[int, int]]:
    """`"60-61"` -> (60, 61), `"61"` -> (61, 61), anything else -> None."""
    text = (value or "").strip().replace("–", "-")
    if not text:
        return None
    parts = text.split("-")
    if len(parts) > 2:
        return None
    try:
        numbers = [int(part) for part in parts]
    except ValueError:
        return None
    start, end = numbers[0], numbers[-1]
    return (min(start, end), max(start, end))


def summarize(matches: Sequence[Dict[str, Any]], players_by_match: Dict[int, List[Dict[str, Any]]]) -> Optional[Dict[str, Any]]:
    """The five headline numbers for a set of matches, or None when it is empty."""
    if not matches:
        return None
    durations = [m["duration_s"] for m in matches if (m.get("duration_s") or 0) > 0]
    heroes, players = set(), set()
    for match in matches:
        for player in players_by_match.get(match["match_id"], []):
            if player.get("hero_id") is not None:
                heroes.add(player["hero_id"])
            if player.get("account_id") is not None:
                players.add(player["account_id"])
    return {
        "matches": len(matches),
        "avg_duration": round(sum(durations) / len(durations)) if durations else None,
        "amber_wins": sum(1 for m in matches if m.get("winning_team") == 0),
        "sapphire_wins": sum(1 for m in matches if m.get("winning_team") == 1),
        "unique_heroes": len(heroes),
        "unique_players": len(players),
    }


def duration_buckets(durations: Sequence[int], size: int = BUCKET_S) -> List[Dict[str, int]]:
    """Contiguous `size`-second buckets from the shortest game to the longest."""
    values = [int(d) for d in durations if d and d > 0]
    if not values:
        return []
    first, last = min(values) // size, max(values) // size
    counts = {index: 0 for index in range(first, last + 1)}
    for value in values:
        counts[value // size] += 1
    return [
        {"start_s": index * size, "end_s": (index + 1) * size, "count": counts[index]}
        for index in range(first, last + 1)
    ]


def game_ref(match: Optional[Dict[str, Any]], region: Optional[str] = None) -> Optional[Dict[str, Any]]:
    """The fields a callout needs to name a game."""
    if not match:
        return None
    return {
        "match_id": match["match_id"],
        "duration_s": match.get("duration_s"),
        "team_a": match.get("event_team_a"),
        "team_b": match.get("event_team_b"),
        "week": match.get("event_week"),
        "region": region,
    }


def side_trend(matches: Sequence[Dict[str, Any]], end_week: int, weeks: int = TREND_WEEKS) -> List[Dict[str, Any]]:
    """Amber win % per week for the `weeks` weeks ending at `end_week`."""
    by_week: Dict[int, List[Dict[str, Any]]] = {}
    for match in matches:
        by_week.setdefault(match.get("event_week"), []).append(match)
    trend = []
    for week in range(end_week - weeks + 1, end_week + 1):
        games = [m for m in by_week.get(week, []) if m.get("winning_team") in (0, 1)]
        amber = sum(1 for m in games if m["winning_team"] == 0)
        trend.append(
            {
                "week": week,
                "matches": len(games),
                "amber_pct": round(amber / len(games) * 100, 1) if games else None,
            }
        )
    return trend


def hero_rates(matches: Sequence[Dict[str, Any]], players_by_match: Dict[int, List[Dict[str, Any]]]) -> Dict[int, Dict[str, int]]:
    """Picks and wins per hero. A hero is picked at most once per match."""
    rates: Dict[int, Dict[str, int]] = {}
    for match in matches:
        for player in players_by_match.get(match["match_id"], []):
            hero = player.get("hero_id")
            if hero is None:
                continue
            entry = rates.setdefault(hero, {"picks": 0, "wins": 0})
            entry["picks"] += 1
            if player.get("result") == "Win":
                entry["wins"] += 1
    return rates


def biggest_riser(
    latest: Sequence[Dict[str, Any]],
    previous: Sequence[Dict[str, Any]],
    players_by_match: Dict[int, List[Dict[str, Any]]],
) -> Optional[Dict[str, Any]]:
    """The hero whose pick rate rose most from the previous week to the latest."""
    if not latest or not previous:
        return None
    now = hero_rates(latest, players_by_match)
    before = hero_rates(previous, players_by_match)
    best = None
    for hero, entry in now.items():
        pick = entry["picks"] / len(latest) * 100
        prev = before.get(hero, {}).get("picks", 0) / len(previous) * 100
        delta = pick - prev
        if delta <= 0:
            continue
        if best is None or delta > best["delta"] or (delta == best["delta"] and hero < best["hero_id"]):
            best = {"hero_id": hero, "pick_pct": round(pick, 1), "prev_pick_pct": round(prev, 1), "delta": round(delta, 1)}
    return best


def record_set(
    matches: Sequence[Dict[str, Any]],
    players_by_match: Dict[int, List[Dict[str, Any]]],
    week: int,
) -> Optional[Dict[str, Any]]:
    """The first range record (in `RECORD_STATS` order) that was set in `week`."""
    week_of = {m["match_id"]: m.get("event_week") for m in matches}
    rows = [p for m in matches for p in players_by_match.get(m["match_id"], [])]
    for stat, label in RECORD_STATS:
        scored = [p for p in rows if p.get(stat) is not None]
        if not scored:
            continue
        # Ties go to the earlier game, so a record "set" in the latest week is a new one.
        best = max(scored, key=lambda p: (p[stat], -p["match_id"]))
        if week_of.get(best["match_id"]) != week:
            continue
        return {
            "stat": stat,
            "label": label,
            "value": best[stat],
            "account_id": best.get("account_id"),
            "persona_name": best.get("persona_name"),
            "hero_id": best.get("hero_id"),
            "match_id": best["match_id"],
            "week": week,
        }
    return None


def _leader(amber: int, sapphire: int) -> Optional[str]:
    if amber > sapphire:
        return "amber"
    if sapphire > amber:
        return "sapphire"
    return None


def side_swing(
    latest_by_region: Dict[str, Sequence[Dict[str, Any]]],
    previous_by_region: Dict[str, Sequence[Dict[str, Any]]],
    week: int,
) -> Optional[Dict[str, Any]]:
    """A region's side result in the latest week next to the week before.

    Prefers a region whose leading side flipped; otherwise the first region (in
    the given order) that played in the latest week.
    """
    fallback = None
    for region, latest in latest_by_region.items():
        if not latest:
            continue
        amber = sum(1 for m in latest if m.get("winning_team") == 0)
        sapphire = sum(1 for m in latest if m.get("winning_team") == 1)
        previous = previous_by_region.get(region) or []
        prev = None
        if previous:
            prev = {
                "amber_wins": sum(1 for m in previous if m.get("winning_team") == 0),
                "sapphire_wins": sum(1 for m in previous if m.get("winning_team") == 1),
            }
        now_lead = _leader(amber, sapphire)
        prev_lead = _leader(prev["amber_wins"], prev["sapphire_wins"]) if prev else None
        swung = bool(now_lead and prev_lead and now_lead != prev_lead)
        entry = {
            "region": region,
            "week": week,
            "amber_wins": amber,
            "sapphire_wins": sapphire,
            "leader": now_lead,
            "previous": prev,
            "previous_leader": prev_lead,
            "swung": swung,
        }
        if swung:
            return entry
        if fallback is None:
            fallback = entry
    return fallback


def group_patches(week_updates: Sequence[Tuple[int, Optional[Dict[str, Any]]]]) -> List[Dict[str, Any]]:
    """Consecutive weeks played under the same game update, oldest first.

    `week_updates` is every week in order with the update its games came after
    (`steam_news.news_for_week`'s `update`), or None for a week with no games or
    no known update. A None week joins the patch running at the time, or the
    next one when it comes first, so every week belongs to exactly one band.
    """
    groups: List[Dict[str, Any]] = []
    pending: List[int] = []
    for week, update in week_updates:
        if update is None:
            if groups:
                groups[-1]["end_week"] = week
            else:
                pending.append(week)
            continue
        key = update.get("gid") or update.get("title")
        if groups and groups[-1]["key"] == key:
            groups[-1]["end_week"] = week
            continue
        start = pending[0] if pending and not groups else week
        pending = []
        groups.append(
            {
                "key": key,
                "name": (update.get("title") or "").strip() or (update.get("published_at") or "")[:10] or "Unknown patch",
                "url": update.get("url"),
                "published_at": update.get("published_at"),
                "start_week": start,
                "end_week": week,
            }
        )
    if not groups and pending:
        groups.append(
            {"key": None, "name": "Unknown patch", "url": None, "published_at": None, "start_week": pending[0], "end_week": pending[-1]}
        )
    for group in groups:
        group.pop("key", None)
    return groups


def scoped(
    matches: Sequence[Dict[str, Any]],
    regions: Dict[int, Optional[str]],
    region: Optional[str] = None,
    weeks: Optional[Tuple[int, int]] = None,
) -> List[Dict[str, Any]]:
    """Matches in a region (None = all) and an inclusive week range."""
    out = []
    for match in matches:
        if region and regions.get(match["match_id"]) != region:
            continue
        week = match.get("event_week")
        if weeks and (week is None or week < weeks[0] or week > weeks[1]):
            continue
        out.append(match)
    return out


def record_cards(
    matches: Sequence[Dict[str, Any]],
    players_by_match: Dict[int, List[Dict[str, Any]]],
    regions: Dict[int, Optional[str]],
    limit: int = RECORD_LIMIT,
) -> List[Dict[str, Any]]:
    """The Records tab: the top `limit` single games for each record, best first.

    Player records name the player, hero and game; the fastest and longest games
    name the two teams. Ties go to the earlier game, as `record_set` decides them.
    """
    week_of = {m["match_id"]: m.get("event_week") for m in matches}
    rows = [p for m in matches for p in players_by_match.get(m["match_id"], [])]
    cards = []
    for stat, label in RECORD_CARDS:
        scored = sorted(
            (p for p in rows if p.get(stat) is not None),
            key=lambda p: (-p[stat], p["match_id"]),
        )[:limit]
        cards.append(
            {
                "id": stat,
                "label": label,
                "kind": "player",
                "entries": [
                    {
                        "value": p[stat],
                        "account_id": p.get("account_id"),
                        "persona_name": p.get("persona_name"),
                        "hero_id": p.get("hero_id"),
                        "match_id": p["match_id"],
                        "week": week_of.get(p["match_id"]),
                        "region": regions.get(p["match_id"]),
                    }
                    for p in scored
                ],
            }
        )

    timed = [m for m in matches if (m.get("duration_s") or 0) > 0]
    for card_id, label, order in (
        ("fastest", "Fastest game", lambda m: (m["duration_s"], m["match_id"])),
        ("longest", "Longest game", lambda m: (-m["duration_s"], m["match_id"])),
    ):
        games = sorted(timed, key=order)[:limit]
        cards.append(
            {
                "id": card_id,
                "label": label,
                "kind": "game",
                "entries": [{**game_ref(m, regions.get(m["match_id"])), "value": m["duration_s"]} for m in games],
            }
        )
    return cards


def _game_kda(player: Dict[str, Any]) -> float:
    return ((player.get("kills") or 0) + (player.get("assists") or 0)) / max(1, player.get("deaths") or 0)


def leaderboards(
    matches: Sequence[Dict[str, Any]],
    players_by_match: Dict[int, List[Dict[str, Any]]],
    min_games: int = LEADER_MIN_GAMES,
    limit: int = LEADER_LIMIT,
) -> Dict[str, Dict[str, List[Dict[str, Any]]]]:
    """The Leaderboards tab: per stat, the top players by Average and by Total.

    Only players with `min_games` games in the matches are ranked, in both modes,
    so one big night cannot top the totals either. `avg` is per game; `total` is
    the sum, except for KDA, where it is the KDA over all the games together
    ((kills + assists) / deaths), since summed ratios mean nothing.
    """
    players: Dict[int, Dict[str, Any]] = {}
    for match in matches:
        for player in players_by_match.get(match["match_id"], []):
            account = player.get("account_id")
            if account is None:
                continue
            entry = players.setdefault(
                account,
                {"account_id": account, "persona_name": player.get("persona_name"), "games": 0, "heroes": {}, "rows": []},
            )
            entry["games"] += 1
            entry["persona_name"] = entry["persona_name"] or player.get("persona_name")
            hero = player.get("hero_id")
            if hero is not None:
                entry["heroes"][hero] = entry["heroes"].get(hero, 0) + 1
            entry["rows"].append(player)

    eligible = [p for p in players.values() if p["games"] >= min_games]
    for entry in eligible:
        heroes = entry["heroes"]
        entry["top_hero_id"] = min(heroes, key=lambda h: (-heroes[h], h)) if heroes else None

    def totals(entry, stat):
        rows = entry["rows"]
        if stat == "kda":
            kills = sum(r.get("kills") or 0 for r in rows)
            assists = sum(r.get("assists") or 0 for r in rows)
            deaths = sum(r.get("deaths") or 0 for r in rows)
            return sum(_game_kda(r) for r in rows) / len(rows), (kills + assists) / max(1, deaths)
        total = sum(r.get(stat) or 0 for r in rows)
        return total / len(rows), total

    boards: Dict[str, Dict[str, List[Dict[str, Any]]]] = {}
    for stat in LEADER_STATS:
        scored = []
        for entry in eligible:
            avg, total = totals(entry, stat)
            scored.append(
                {
                    "account_id": entry["account_id"],
                    "persona_name": entry["persona_name"],
                    "games": entry["games"],
                    "top_hero_id": entry["top_hero_id"],
                    "avg": round(avg, 2),
                    "total": round(total, 2) if stat == "kda" else total,
                }
            )
        boards[stat] = {
            mode: sorted(scored, key=lambda r: (-r[mode], -r["games"], r["account_id"]))[:limit]
            for mode in ("avg", "total")
        }
    return boards
