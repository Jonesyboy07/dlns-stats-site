from __future__ import annotations

"""/db routes: items.

`/items/<id>/stats` feeds the item page (one item, broken down by buy time,
hero, player and match); `/items/stats` feeds the Items index: for one Night
Shift week range and region
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

import html
import json
import re
import statistics
from typing import Any, Dict, Iterable, List, Optional

from flask import jsonify, request

from ...cache import cache
from ...heroes import get_hero_name
from ...utils import stats_summary as ss
from .core import _item_catalog, _items_raw, _rows_to_dicts, bp, get_ro_conn, uncacheable
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


# ── Item page ───────────────────────────────────────────────────────────

BUY_BUCKET_S = 300  # 5-minute buckets of first-buy time
BUY_BUCKETS = 7  # 0-5 ... 25-30, then 30+
BUY_LIST_LIMIT = 50  # individual buys are sent while an item has this few games
TOP_PLAYERS_LIMIT = 20
RECENT_MATCHES_LIMIT = 10
MAX_BONUSES = 6

_TAG_RE = re.compile(r"<[^>]+>")
_SPACE_RE = re.compile(r"\s+")
# Values the asset API uses for "not set": no charge delay, no cooldown.
_EMPTY_VALUES = {"", "0", "0.0", "-1", "-1.0"}


def _plain_text(markup: Any) -> str:
    """Upstream descriptions are HTML fragments; the page shows plain text."""
    if not isinstance(markup, str):
        return ""
    return _SPACE_RE.sub(" ", html.unescape(_TAG_RE.sub("", markup))).strip()


def _format_bonus(prop: Dict[str, Any]) -> Optional[str]:
    raw = prop.get("value")
    text = str(raw).strip() if raw is not None else ""
    if text in _EMPTY_VALUES:
        return None
    try:
        number: Optional[float] = float(text)
        text = f"{number:g}"
    except ValueError:
        number = None
    if number is not None and number > 0 and "{s:sign}" in str(prop.get("prefix") or ""):
        text = f"+{text}"
    return f"{text}{prop.get('postfix') or ''}"


def item_text(raw_item: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """An upstream item's description (plain text) and up to six stat bonuses.

    Bonuses are the properties the in-game tooltip names, elevated and important
    ones first, then the rest, then an active item's cooldown; a label shown
    twice (the two halves of "Incoming Healing") is kept once.
    """
    if not isinstance(raw_item, dict):
        return {"description": "", "bonuses": []}

    sections = raw_item.get("tooltip_sections")
    first: List[str] = []
    rest: List[str] = []
    texts: List[str] = []
    for section in sections if isinstance(sections, list) else []:
        for attr in section.get("section_attributes") or []:
            first += list(attr.get("elevated_properties") or []) + list(attr.get("important_properties") or [])
            rest += list(attr.get("properties") or [])
            if attr.get("loc_string"):
                texts.append(attr["loc_string"])

    described = raw_item.get("description")
    description = _plain_text(described.get("desc") if isinstance(described, dict) else None) or _plain_text(" ".join(texts))

    props = raw_item.get("properties")
    props = props if isinstance(props, dict) else {}
    order = first + rest + (["AbilityCooldown"] if raw_item.get("is_active_item") else [])
    bonuses: List[Dict[str, str]] = []
    seen: set = set()
    for key in order:
        prop = props.get(key)
        if not isinstance(prop, dict) or key in seen:
            continue
        seen.add(key)
        label = str(prop.get("label") or "").strip()
        value = _format_bonus(prop)
        if not label or value is None or any(b["label"] == label for b in bonuses):
            continue
        bonuses.append({"label": label, "value": value})
        if len(bonuses) == MAX_BONUSES:
            break
    return {"description": description, "bonuses": bonuses}


def _raw_item(item_id: int) -> Optional[Dict[str, Any]]:
    for item in _items_raw():
        if isinstance(item, dict) and item.get("id") == item_id:
            return item
    return None


def _tally(rows: Dict[Any, Dict[str, Any]], key: Any, won: bool, **fields: Any) -> Dict[str, Any]:
    row = rows.setdefault(key, {**fields, "games": 0, "wins": 0})
    row["games"] += 1
    row["wins"] += 1 if won else 0
    return row


def item_breakdown(players: Iterable[Dict[str, Any]], item_id: int, items: Dict[int, Any]) -> Dict[str, Any]:
    """One item over a set of player rows: totals, buy-time buckets, heroes, players, matches.

    Rows need `match_id`, `account_id`, `hero_id`, `result` and `raw_items_json`,
    plus `persona_name` and `start_time` for display. Hero and player shares count
    only player-games with purchase data, like the index's pick rate. `builds`
    (match, account pairs) is for the damage lookup and is not sent to the client.
    """
    player_games = 0
    hero_games: Dict[Any, int] = {}
    account_games: Dict[Any, int] = {}
    builds: List[Dict[str, Any]] = []
    for player in players:
        entries = _parse_purchases(player.get("raw_items_json"))
        if not entries:
            continue
        player_games += 1
        hero_games[player.get("hero_id")] = hero_games.get(player.get("hero_id"), 0) + 1
        account_games[player.get("account_id")] = account_games.get(player.get("account_id"), 0) + 1
        held = _player_items(entries, items).get(item_id)
        if held is not None:
            builds.append({**player, "won": player.get("result") == "Win", "buy_s": held["first_s"], "kept": held["kept"]})

    times = [b["buy_s"] for b in builds if b["buy_s"] is not None]
    buckets = [{"start_s": i * BUY_BUCKET_S, "purchases": 0, "wins": 0} for i in range(BUY_BUCKETS)]
    heroes: Dict[Any, Dict[str, Any]] = {}
    people: Dict[Any, Dict[str, Any]] = {}
    for build in builds:
        if build["buy_s"] is not None:
            bucket = buckets[min(int(build["buy_s"] // BUY_BUCKET_S), BUY_BUCKETS - 1)]
            bucket["purchases"] += 1
            bucket["wins"] += 1 if build["won"] else 0
        _tally(heroes, build.get("hero_id"), build["won"], hero_id=build.get("hero_id"))
        person = _tally(people, build.get("account_id"), build["won"], account_id=build.get("account_id"), name=None)
        person["name"] = person["name"] or build.get("persona_name")

    def hero_name(hero_id: Any) -> Optional[str]:
        return get_hero_name(hero_id) if hero_id is not None else None

    hero_rows = sorted(
        ({**h, "name": hero_name(h["hero_id"]), "hero_games": hero_games[h["hero_id"]]} for h in heroes.values()),
        key=lambda h: (-h["games"], -h["wins"], str(h["name"] or "")),
    )
    player_rows = sorted(
        ({**p, "player_games": account_games[p["account_id"]]} for p in people.values()),
        key=lambda p: (-p["games"], -p["wins"], str(p["name"] or "")),
    )[:TOP_PLAYERS_LIMIT]

    latest = sorted(builds, key=lambda b: (str(b.get("start_time") or ""), b.get("match_id") or 0), reverse=True)
    recent = [
        {
            "match_id": b.get("match_id"),
            "start_time": b.get("start_time"),
            "hero_id": b.get("hero_id"),
            "hero_name": hero_name(b.get("hero_id")),
            "account_id": b.get("account_id"),
            "player_name": b.get("persona_name"),
            "won": b["won"],
            "buy_s": b["buy_s"],
        }
        for b in latest[:RECENT_MATCHES_LIMIT]
    ]
    buys = sorted(
        ({"buy_s": b["buy_s"], "won": b["won"], "match_id": b.get("match_id")} for b in builds if b["buy_s"] is not None),
        key=lambda b: b["buy_s"],
    )

    return {
        "player_games": player_games,
        "totals": {
            "games": len(builds),
            "wins": sum(1 for b in builds if b["won"]),
            "sold": sum(1 for b in builds if not b["kept"]),
            "median_buy_s": statistics.median(times) if times else None,
        },
        "buy_timing": buckets,
        "buys": buys if len(builds) <= BUY_LIST_LIMIT else None,
        "heroes": hero_rows,
        "players": player_rows,
        "recent": recent,
        "builds": [(b.get("match_id"), b.get("account_id")) for b in builds],
    }


def _chunks(values: List[Any], size: int = 500):
    for start in range(0, len(values), size):
        yield values[start : start + size]


def _item_damage(conn, class_name: str, builds: List[tuple]) -> Optional[Dict[str, Any]]:
    """Hero damage the item dealt in the games it was built, or None for a non-damage item.

    `share` is that damage over the same builders' total hero damage in those games.
    """
    if not class_name or not builds:
        return None
    built = set(builds)
    match_ids = sorted({match_id for match_id, _ in built})
    total = 0
    dealt: set = set()
    for chunk in _chunks(match_ids):
        marks = ",".join("?" * len(chunk))
        for match_id, account_id, damage in conn.execute(
            f"SELECT match_id, account_id, damage FROM player_damage_sources WHERE source = ? AND match_id IN ({marks})",
            (class_name, *chunk),
        ):
            if (match_id, account_id) in built and damage:
                total += damage
                dealt.add((match_id, account_id))
    if not dealt:
        return None
    hero_damage = 0
    for chunk in _chunks(match_ids):
        marks = ",".join("?" * len(chunk))
        for match_id, account_id, damage in conn.execute(
            f"SELECT match_id, account_id, player_damage FROM players WHERE match_id IN ({marks})", tuple(chunk)
        ):
            if (match_id, account_id) in dealt and damage:
                hero_damage += damage
    return {"total": total, "per_game": total / len(built), "share": total / hero_damage if hero_damage else None}


def _scoped_item_page_players(conn, event_title: str, first_week: int, last_week: int, match_ids: set) -> List[Dict[str, Any]]:
    cur = conn.execute(
        """
        SELECT p.match_id, p.account_id, p.hero_id, p.result, p.raw_items_json,
               u.persona_name, COALESCE(m.start_time, m.created_at) AS start_time
          FROM players p
          JOIN matches m ON m.match_id = p.match_id
          LEFT JOIN users u ON u.account_id = p.account_id
         WHERE LOWER(m.event_title) = LOWER(?) AND m.event_week BETWEEN ? AND ?
        """,
        (event_title, first_week, last_week),
    )
    return [row for row in _rows_to_dicts(cur) if row["match_id"] in match_ids]


def _item_header(item_id: int, meta: Dict[str, Any]) -> Dict[str, Any]:
    return {
        "id": item_id,
        "name": meta.get("name"),
        "class_name": meta.get("class_name") or "",
        "slot": meta.get("slot") or "",
        "tier": meta.get("tier"),
        "cost": meta.get("cost"),
        "shopable": meta.get("shopable", True),
        "icon": meta.get("icon"),
        "image": meta.get("image"),
        **item_text(_raw_item(item_id)),
    }


@bp.get("/items/<int:item_id>/stats")
@cache.cached(timeout=1800, query_string=True)
def item_stats(item_id: int):  # type: ignore
    """The item page for ?weeks=a-b&region=: totals, buy timing, heroes, players, recent games, damage."""
    event_title = _stats_event_title()
    items = purchasable_items(_item_catalog())
    if not items:
        return uncacheable(jsonify({"error": "Item catalogue unavailable"})), 503
    meta = items.get(item_id)
    if meta is None:
        return jsonify({"error": "Item not found"}), 404

    response = {
        "event_title": event_title,
        "range": None,
        "region": "All",
        "matches": 0,
        "player_games": 0,
        "item": _item_header(item_id, meta),
        "totals": {"games": 0, "wins": 0, "sold": 0, "median_buy_s": None},
        "buy_timing": [],
        "buys": [],
        "heroes": [],
        "players": [],
        "recent": [],
        "damage": None,
    }
    with get_ro_conn() as conn:
        rows, regions = _stats_matches(conn, event_title)
        if not rows:
            return jsonify(response)
        (start, end), region = _stats_filters(rows, _region_order(regions))
        scope = ss.scoped(rows, regions, region, (start, end))
        players = _scoped_item_page_players(conn, event_title, start, end, {m["match_id"] for m in scope})
        breakdown = item_breakdown(players, item_id, items)
        damage = _item_damage(conn, response["item"]["class_name"], breakdown.pop("builds"))

    response.update(breakdown, range=[start, end], region=region or "All", matches=len(scope), damage=damage)
    return jsonify(response)


# ── Item cards (data for @deadlock-api/ui `dl-item-card`) ─────────────────────

MAX_CARD_IDS = 200


def _card_image(item: Dict[str, Any]) -> Optional[str]:
    """The art dl-item-card picks for a build-path icon (its `getImageSrc`)."""
    for key in ("shop_image_webp", "shop_image", "image_webp", "image"):
        value = item.get(key)
        if value:
            return value
    return None


def _card_ref(item: Dict[str, Any]) -> Dict[str, Any]:
    return {"name": item.get("name") or item.get("class_name") or "", "image": _card_image(item)}


def item_cards(raw_items: Iterable[Any], ids: Iterable[int]) -> Dict[str, Dict[str, Any]]:
    """Everything a dl-item-card needs to render without fetching the catalogue.

    Keyed by item id (as a string, for JSON): the upstream item verbatim, plus
    what it is built from (`components`) and what it builds into (`parents`) in
    the `{name, image}` shape the card's `componentItemsData` /
    `parentItemsData` props take. Unknown ids are left out.
    """
    items = [item for item in raw_items if isinstance(item, dict)]
    by_id = {item.get("id"): item for item in items if isinstance(item.get("id"), int)}
    by_class = {item.get("class_name"): item for item in items if item.get("class_name")}

    cards: Dict[str, Dict[str, Any]] = {}
    for item_id in ids:
        item = by_id.get(item_id)
        if item is None:
            continue
        class_name = item.get("class_name")
        components = [
            _card_ref(by_class[name])
            for name in (item.get("component_items") or [])
            if name in by_class
        ]
        parents = [
            _card_ref(other)
            for other in items
            if class_name and class_name in (other.get("component_items") or [])
        ]
        cards[str(item_id)] = {"item": item, "components": components, "parents": parents}
    return cards


def _parse_ids(raw: Optional[str]) -> List[int]:
    ids: List[int] = []
    for part in (raw or "").split(","):
        part = part.strip()
        if part.isdigit():
            value = int(part)
            if value > 0 and value not in ids:
                ids.append(value)
    return ids[:MAX_CARD_IDS]


@bp.get("/items/cards")
@cache.cached(timeout=1800, query_string=True)
def items_cards():  # type: ignore
    """`?ids=1,2,3` -> {"items": {id: {item, components, parents}}}.

    Lets the client render deadlock-api item cards and tooltips from our cached
    catalogue instead of each visitor downloading the full ~6 MB item list.
    At most MAX_CARD_IDS ids per request.
    """
    ids = _parse_ids(request.args.get("ids"))
    if not ids:
        return jsonify({"items": {}})
    raw = _items_raw()
    if not raw:
        return uncacheable(jsonify({"items": {}, "error": "Item catalogue unavailable"})), 503
    return jsonify({"items": item_cards(raw, ids)})
