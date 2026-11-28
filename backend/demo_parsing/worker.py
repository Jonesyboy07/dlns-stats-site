"""Parse one Deadlock demo with boon and write the result as JSON.

    python -I worker.py <match.dem> <out.json>

Runs in its own process (see parse.py): a 300 MB demo that crashes, hangs or runs out of
memory must not take the ingester down with it. It is deliberately self-contained --
no imports from the site -- so it can run under any interpreter that has boon, including
a separate environment pinned to an older boon for older demos (DEMO_PYTHON).

The output is plain data, already in the site's terms: 32-bit account ids, teams 0/1,
match-clock seconds. Its shape is RESULT_VERSION; store.py reads it.
"""

from __future__ import annotations

import json
import math
import sys
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

RESULT_VERSION = 1

# Valve's 64-bit Steam id minus this is the 32-bit account id the site stores.
STEAM64_OFFSET = 76561197960265728

# The per-second series, in packed order. `souls` is boon's gold_net_worth (souls +
# spent souls), which matches the metadata API's net_worth snapshots.
SERIES_FIELDS: Tuple[str, ...] = ("souls", "kills", "deaths", "assists", "hero_damage", "level")
_SOURCE_COLUMNS = {
    "souls": "gold_net_worth",
    "kills": "kills",
    "deaths": "deaths",
    "assists": "assists",
    "hero_damage": "hero_damage",
    "level": "level",
}

# boon datasets this needs; everything else is left unparsed to keep runs short.
DATASETS = ("player_ticks", "kills", "damage", "mid_boss", "breakables")


def team_of(team_num: Optional[int]) -> Optional[int]:
    """boon's team_num 2/3 as the site's 0/1. Spectators (1) and neutrals (4) are None."""
    if team_num == 2:
        return 0
    if team_num == 3:
        return 1
    return None


def account_of(steam_id: Optional[int]) -> Optional[int]:
    """A 64-bit Steam id as the site's 32-bit account id."""
    if steam_id is None:
        return None
    value = int(steam_id)
    return value - STEAM64_OFFSET if value >= STEAM64_OFFSET else value


def fill_grid(
    samples: Iterable[Tuple[int, Sequence[Optional[int]]]],
    length: int,
    field_count: int,
) -> List[List[int]]:
    """Per-second samples onto a dense 0..length-1 grid, one list per field.

    `samples` are `(second, values)` pairs; when several share a second the LAST wins
    (the value held at the end of that second). Missing seconds and missing values carry
    the previous value forward; everything starts at 0, since a match starts at nothing.
    Seconds outside the grid are ignored.
    """
    by_second: Dict[int, Sequence[Optional[int]]] = {}
    for second, values in samples:
        if 0 <= second < length:
            by_second[second] = values
    columns: List[List[int]] = [[] for _ in range(field_count)]
    last = [0] * field_count
    for second in range(length):
        values = by_second.get(second)
        if values is not None:
            for index in range(field_count):
                if values[index] is not None:
                    last[index] = int(values[index])
        for index in range(field_count):
            columns[index].append(last[index])
    return columns


def grid_length(regulation_seconds: float) -> int:
    """Samples from 0:00 through the last whole second of the match, inclusive."""
    return max(1, int(math.floor(float(regulation_seconds))) + 1)


def _parser_version() -> str:
    try:
        from importlib.metadata import version

        return version("boon-deadlock")
    except Exception:  # noqa: BLE001 - metadata missing in an unusual install
        return "unknown"


def parse(path: str) -> dict:
    """Parse the demo at `path` into the result dict (see module docstring)."""
    import boon
    import polars as pl

    demo = boon.Demo(path, preload=False)
    demo.load(*DATASETS)

    # Match-clock seconds for every tick that appears, computed once per unique tick
    # and joined back, rather than assuming a fixed tick -> second formula.
    def seconds_of(frame: "pl.DataFrame") -> "pl.DataFrame":
        ticks = frame.select("tick").unique()
        mapping = ticks.with_columns(
            pl.Series("match_s", [demo.tick_to_match_seconds(int(t)) for t in ticks["tick"]], dtype=pl.Float64)
        )
        return frame.join(mapping, on="tick", how="left")

    length = grid_length(demo.regulation_seconds)

    players = []
    hero_to_account: Dict[int, Optional[int]] = {}
    for row in demo.players.iter_rows(named=True):
        if not row.get("hero_id"):
            continue  # spectators and casters
        account_id = account_of(row.get("steam_id"))
        hero_id = int(row["hero_id"])
        # Two players on one hero would make hero-keyed events ambiguous; drop the key.
        hero_to_account[hero_id] = None if hero_id in hero_to_account else account_id
        players.append({"account_id": account_id, "hero_id": hero_id, "team": team_of(row.get("team_num"))})

    # ---- per-second series -------------------------------------------------------
    ticks = demo.player_ticks.filter(pl.col("hero_id") > 0)
    ticks = seconds_of(ticks).with_columns(pl.col("match_s").floor().cast(pl.Int64).alias("second"))
    source_columns = [_SOURCE_COLUMNS[field] for field in SERIES_FIELDS]
    series: Dict[str, List[List[int]]] = {}
    for steam_id, frame in ticks.sort("tick").group_by("steam_id", maintain_order=True):
        account_id = account_of(steam_id[0] if isinstance(steam_id, tuple) else steam_id)
        if account_id is None:
            continue
        samples = (
            (row[0], row[1:])
            for row in frame.select(["second", *source_columns]).iter_rows()
        )
        series[str(account_id)] = fill_grid(samples, length, len(SERIES_FIELDS))

    # ---- kills with assisters -----------------------------------------------------
    kills = []
    for row in seconds_of(demo.kills).sort("tick").iter_rows(named=True):
        kills.append({
            "time_s": round(row["match_s"], 3),
            "victim_account_id": hero_to_account.get(row["victim_hero_id"]),
            "killer_account_id": hero_to_account.get(row["attacker_hero_id"]),
            "assister_account_ids": [
                account
                for account in (hero_to_account.get(hero) for hero in (row["assister_hero_ids"] or []))
                if account is not None
            ],
        })

    # ---- hero-on-hero damage per second ------------------------------------------------
    damage_rows = []
    hero_damage = demo.damage.filter((pl.col("attacker_hero_id") > 0) & (pl.col("victim_hero_id") > 0))
    if hero_damage.height:
        summed = (
            seconds_of(hero_damage)
            .with_columns(pl.col("match_s").floor().cast(pl.Int64).alias("second"))
            .group_by(["second", "attacker_hero_id", "victim_hero_id"])
            .agg(pl.col("damage").sum())
            .sort(["second", "attacker_hero_id", "victim_hero_id"])
        )
        for second, attacker, victim, amount in summed.iter_rows():
            attacker_account = hero_to_account.get(attacker)
            victim_account = hero_to_account.get(victim)
            if attacker_account is None or victim_account is None or second < 0:
                continue
            damage_rows.append([int(second), attacker_account, victim_account, int(amount)])

    # ---- timed events ---------------------------------------------------------------
    events = []
    for row in seconds_of(demo.mid_boss).sort("tick").iter_rows(named=True):
        kind = {"killed": "mid_boss_killed", "picked_up": "rejuv_pickup"}.get(row["event"])
        if kind is None:
            continue
        events.append({"kind": kind, "time_s": round(row["match_s"], 3), "team": team_of(row["team_num"]),
                       "account_id": None, "name": None, "x": None, "y": None, "z": None})
    for row in seconds_of(demo.breakables).sort("tick").iter_rows(named=True):
        events.append({"kind": "breakable", "time_s": round(row["match_s"], 3), "team": team_of(row["team_num"]),
                       "account_id": None, "name": row["subclass_name"],
                       "x": row["x"], "y": row["y"], "z": row["z"]})

    return {
        "result_version": RESULT_VERSION,
        "parser": "boon",
        "parser_version": _parser_version(),
        "match_id": demo.match_id,
        "demo_build": demo.build,
        "tick_rate": demo.tick_rate,
        "duration_s": float(demo.regulation_seconds),
        "step_s": 1,
        "sample_count": length,
        "fields": list(SERIES_FIELDS),
        "players": players,
        "series": series,
        "kills": kills,
        "damage": damage_rows,
        "events": events,
    }


def main(argv: Sequence[str]) -> int:
    if len(argv) != 3:
        print("usage: worker.py <match.dem> <out.json>", file=sys.stderr)
        return 2
    result = parse(argv[1])
    with open(argv[2], "w", encoding="utf-8") as handle:
        json.dump(result, handle, separators=(",", ":"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
