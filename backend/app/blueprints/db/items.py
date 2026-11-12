from __future__ import annotations

"""/db routes: items.

`/items/stats` feeds the Items index: for one Night Shift week range and region
(the same `?weeks=&region=` filter, and the same defaults, as the stats page)
it returns every shop item that was bought, with its games, wins, sales and
median first-buy time. Rates are left to the client, which also applies the
"min games" threshold, so changing that threshold never needs a refetch.

Counting rules (one entry in `players.raw_items_json` is one purchase):
- An item counts once per player-game, however many times it was bought.
- A player-game counts as `sold` when every purchase of the item was later sold
  (a non-zero `sold_time_s`), so the player finished the game without it.
- The buy time is the first purchase in that game.
- Player-games without purchase data are left out of the denominator, so a
  match that has not been backfilled does not drag every pick rate down.
"""

import json
import statistics
from typing import Any, Dict, Iterable, List, Optional

from flask import jsonify

from ...cache import cache
from ...utils import stats_summary as ss
from .core import _item_catalog, _rows_to_dicts, bp, get_ro_conn, uncacheable
from .stats import _region_order, _stats_event_title, _stats_filters, _stats_matches


def purchasable_items(catalog: Dict[int, Dict[str, Any]]) -> Dict[int, Dict[str, Any]]:
    """The catalogue's shop upgrades: abilities and ability points are left out."""
    return {item_id: meta for item_id, meta in catalog.items() if meta.get("type") == "upgrade"}


def _parse_purchases(raw: Optional[str]) -> List[Dict[str, Any]]:
    try:
        entries = json.loads(raw or "[]")
    except (TypeError, ValueError):
        return []
    return [entry for entry in entries if isinstance(entry, dict)] if isinstance(entries, list) else []


def _player_items(entries: Iterable[Dict[str, Any]], items: Dict[int, Any]) -> Dict[int, Dict[str, Any]]:
    """One player-game's items: item id -> {first buy time, still held at the end}."""
    out: Dict[int, Dict[str, Any]] = {}
    for entry in entries:
        try:
            item_id = int(entry.get("item_id"))
        except (TypeError, ValueError):
            continue
        if item_id not in items:
            continue
        slot = out.setdefault(item_id, {"first_s": None, "kept": False})
        bought_at = entry.get("game_time_s")
        if isinstance(bought_at, (int, float)) and (slot["first_s"] is None or bought_at < slot["first_s"]):
            slot["first_s"] = bought_at
        if not entry.get("sold_time_s"):
            slot["kept"] = True
    return out


def item_usage(players: Iterable[Dict[str, Any]], items: Dict[int, Any]) -> Dict[str, Any]:
    """Games, wins, sales and buy times per item over a set of player rows.

    Each row needs `raw_items_json` and `result` (`Win`/`Loss`). Returns
    `{"player_games": n, "items": {item_id: {games, wins, sold, times}}}`.
    """
    player_games = 0
    usage: Dict[int, Dict[str, Any]] = {}
    for player in players:
        entries = _parse_purchases(player.get("raw_items_json"))
        if not entries:
            continue
        player_games += 1
        won = player.get("result") == "Win"
        for item_id, held in _player_items(entries, items).items():
            bucket = usage.setdefault(item_id, {"games": 0, "wins": 0, "sold": 0, "times": []})
            bucket["games"] += 1
            bucket["wins"] += 1 if won else 0
            bucket["sold"] += 0 if held["kept"] else 1
            if held["first_s"] is not None:
                bucket["times"].append(held["first_s"])
    return {"player_games": player_games, "items": usage}


def item_rows(usage: Dict[int, Dict[str, Any]], items: Dict[int, Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The index's rows: catalogue fields plus counts, most-bought first."""
    rows = []
    for item_id, bucket in usage.items():
        meta = items[item_id]
        times = bucket["times"]
        rows.append(
            {
                "id": item_id,
                "name": meta.get("name"),
                "slot": meta.get("slot") or "",
                "tier": meta.get("tier"),
                "cost": meta.get("cost"),
                "shopable": meta.get("shopable", True),
                "icon": meta.get("icon"),
                "image": meta.get("image"),
                "games": bucket["games"],
                "wins": bucket["wins"],
                "sold": bucket["sold"],
                "median_buy_s": statistics.median(times) if times else None,
            }
        )
    rows.sort(key=lambda row: (-row["games"], str(row["name"] or "")))
    return rows


def _scoped_item_players(conn, event_title: str, first_week: int, last_week: int, match_ids: set) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT p.match_id, p.result, p.raw_items_json
          FROM players p
          JOIN matches m ON m.match_id = p.match_id
         WHERE LOWER(m.event_title) = LOWER(?) AND m.event_week BETWEEN ? AND ?
        """,
        (event_title, first_week, last_week),
    )
    return [row for row in _rows_to_dicts(cur) if row["match_id"] in match_ids]


@bp.get("/items/stats")
@cache.cached(timeout=1800, query_string=True)
def items_stats():  # type: ignore
    """The Items index for ?weeks=a-b&region=: per-item games, wins, sales, buy time."""
    event_title = _stats_event_title()
    empty = {"event_title": event_title, "range": None, "region": "All", "matches": 0, "player_games": 0, "items": []}

    items = purchasable_items(_item_catalog())
    if not items:
        # Upstream catalogue unavailable: say so without caching the empty answer.
        return uncacheable(jsonify({**empty, "error": "Item catalogue unavailable"}))

    with get_ro_conn() as conn:
        rows, regions = _stats_matches(conn, event_title)
        if not rows:
            return jsonify(empty)
        (start, end), region = _stats_filters(rows, _region_order(regions))
        scope = ss.scoped(rows, regions, region, (start, end))
        players = _scoped_item_players(conn, event_title, start, end, {m["match_id"] for m in scope})

    usage = item_usage(players, items)
    return jsonify(
        {
            "event_title": event_title,
            "range": [start, end],
            "region": region or "All",
            "matches": len(scope),
            "player_games": usage["player_games"],
            "items": item_rows(usage["items"], items),
        }
    )
