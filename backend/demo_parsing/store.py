"""Writing a parsed demo into the database, and the packed series format.

A match's demo rows are always replaced together in one transaction, so a re-parse (a
boon upgrade, a fixed demo) can never leave half of an old result behind, and the
match_demo_parse row says which parser version produced what is there.

Series format (match_player_series.data): for each field in `fields` order, the
`sample_count` values as little-endian int32 *deltas* (the first value, then each
change), concatenated and zlib-compressed. Deltas matter: souls climb steadily and K/D/A
barely move, so most deltas are tiny and compress to almost nothing (~37 KB a match).
"""

from __future__ import annotations

import json
import sqlite3
import sys
import zlib
from array import array
from datetime import datetime, timezone
from typing import Dict, List, Optional, Sequence

_TABLES = ("match_player_series", "match_kill_assists", "match_hero_damage", "match_demo_events")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def pack_series(columns: Sequence[Sequence[int]]) -> bytes:
    """Columns of equal length -> one compressed blob (see module docstring)."""
    raw = array("i")
    for column in columns:
        previous = 0
        for value in column:
            raw.append(int(value) - previous)
            previous = int(value)
    if sys.byteorder == "big":  # pragma: no cover - every supported host is little-endian
        raw.byteswap()
    return zlib.compress(raw.tobytes(), 9)


def unpack_series(blob: bytes, fields: Sequence[str], sample_count: int) -> Dict[str, List[int]]:
    """The inverse of pack_series, as `{field: values}`."""
    raw = array("i")
    raw.frombytes(zlib.decompress(blob))
    if sys.byteorder == "big":  # pragma: no cover
        raw.byteswap()
    if len(raw) != len(fields) * sample_count:
        raise ValueError(f"series holds {len(raw)} values, expected {len(fields)} x {sample_count}")
    out: Dict[str, List[int]] = {}
    for index, field in enumerate(fields):
        running = 0
        values = []
        for delta in raw[index * sample_count:(index + 1) * sample_count]:
            running += delta
            values.append(running)
        out[field] = values
    return out


def mark_status(
    conn: sqlite3.Connection,
    match_id: int,
    status: str,
    *,
    source: Optional[str] = None,
    error: Optional[str] = None,
    parser_version: Optional[str] = None,
) -> None:
    """Record an attempt that produced no data ('no_demo' / 'failed').

    Earlier good rows are left alone: a failed re-parse should not wipe a working result.
    """
    conn.execute(
        """
        INSERT INTO match_demo_parse (match_id, status, source, parser_version, attempted_at, error)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(match_id) DO UPDATE SET
          status = CASE WHEN match_demo_parse.status = 'ok' THEN 'ok' ELSE excluded.status END,
          source = COALESCE(excluded.source, match_demo_parse.source),
          attempted_at = excluded.attempted_at,
          error = excluded.error
        """,
        (match_id, status, source, parser_version, _now(), (error or "")[:2000] or None),
    )
    conn.commit()


def write_result(conn: sqlite3.Connection, match_id: int, result: dict, *, source: str) -> Dict[str, int]:
    """Replace `match_id`'s demo rows with the worker's `result`. Returns row counts."""
    fields = list(result["fields"])
    sample_count = int(result["sample_count"])
    step_s = int(result.get("step_s") or 1)
    by_account = {p["account_id"]: p for p in result.get("players", []) if p.get("account_id") is not None}

    series_rows = []
    for account_key, columns in (result.get("series") or {}).items():
        account_id = int(account_key)
        if len(columns) != len(fields) or any(len(column) != sample_count for column in columns):
            raise ValueError(f"series for {account_id} does not match fields x sample_count")
        player = by_account.get(account_id, {})
        series_rows.append((
            match_id, account_id, player.get("hero_id"), player.get("team"),
            step_s, sample_count, ",".join(fields), pack_series(columns),
        ))

    kill_rows = [
        (match_id, index, float(kill["time_s"]), kill.get("victim_account_id"), kill.get("killer_account_id"),
         json.dumps(kill.get("assister_account_ids") or []))
        for index, kill in enumerate(result.get("kills") or [])
    ]
    damage_rows = [(match_id, int(s), int(a), int(v), int(d)) for s, a, v, d in (result.get("damage") or [])]
    event_rows = [
        (match_id, index, event["kind"], float(event["time_s"]), event.get("team"), event.get("account_id"),
         event.get("name"), event.get("x"), event.get("y"), event.get("z"))
        for index, event in enumerate(result.get("events") or [])
    ]

    with conn:  # one transaction: all of the new result, or none of it
        for table in _TABLES:
            conn.execute(f"DELETE FROM {table} WHERE match_id=?", (match_id,))
        conn.executemany(
            "INSERT INTO match_player_series (match_id, account_id, hero_id, team, step_s, sample_count, fields, data) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            series_rows,
        )
        conn.executemany(
            "INSERT INTO match_kill_assists (match_id, kill_index, time_s, victim_account_id, killer_account_id, "
            "assister_account_ids) VALUES (?, ?, ?, ?, ?, ?)",
            kill_rows,
        )
        conn.executemany(
            "INSERT INTO match_hero_damage (match_id, time_s, attacker_account_id, victim_account_id, damage) "
            "VALUES (?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET damage = damage + excluded.damage",
            damage_rows,
        )
        conn.executemany(
            "INSERT INTO match_demo_events (match_id, event_index, kind, time_s, team, account_id, name, x, y, z) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            event_rows,
        )
        now = _now()
        conn.execute(
            """
            INSERT INTO match_demo_parse (match_id, status, source, parser, parser_version, demo_build,
                                          duration_s, attempted_at, parsed_at, error)
            VALUES (?, 'ok', ?, ?, ?, ?, ?, ?, ?, NULL)
            ON CONFLICT(match_id) DO UPDATE SET
              status = 'ok', source = excluded.source, parser = excluded.parser,
              parser_version = excluded.parser_version, demo_build = excluded.demo_build,
              duration_s = excluded.duration_s, attempted_at = excluded.attempted_at,
              parsed_at = excluded.parsed_at, error = NULL
            """,
            (match_id, source, result.get("parser"), result.get("parser_version"), result.get("demo_build"),
             result.get("duration_s"), now, now),
        )

    return {
        "series": len(series_rows),
        "kills": len(kill_rows),
        "damage": len(damage_rows),
        "events": len(event_rows),
    }
