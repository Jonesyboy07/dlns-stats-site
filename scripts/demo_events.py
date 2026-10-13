#!/usr/bin/env python3
"""Prototype: pull neutral-camp, destructable and buff events from a match's demo.

    python scripts/demo_events.py 115744978
    python scripts/demo_events.py 115744978 --json

Prints what the demo query service returns and cross-checks the derived times against
the metadata feed's own objective timings, which come from a different pipeline.

Note that the service fetches the demo itself and only accepts a match id, so it only
works while Valve still hosts the replay — `demo_status` reports that up front, and
matches that never published a replay cannot be read at all.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import requests

from backend.app.utils.demo_query import EVENT_SOURCES, demo_status, extract_events

METADATA_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/metadata"
SAMPLES = 8


def metadata_objectives(match_id: int) -> dict:
    """The metadata feed's objective/mid-boss timings, for cross-checking the demo.

    The endpoint wraps the match payload in `match_info`, the same shape the ingest
    script unwraps in `fetch_match_metadata`.
    """
    try:
        resp = requests.get(METADATA_URL.format(match_id=match_id), timeout=20)
        resp.raise_for_status()
        payload = resp.json()
    except Exception as exc:  # noqa: BLE001 - the cross-check is optional
        return {"error": str(exc)}

    match_info = payload.get("match_info") or payload
    objectives = [
        {"label": "objective", "time_s": o.get("destroyed_time_s"), "team": o.get("team")}
        for o in match_info.get("objectives") or []
        if o.get("destroyed_time_s")
    ]
    mid_boss = [
        {"label": "mid_boss", "time_s": b.get("destroyed_time_s"), "team": b.get("team_claimed")}
        for b in match_info.get("mid_boss") or []
        if b.get("destroyed_time_s")
    ]
    return {"objectives": objectives, "mid_boss": mid_boss}


def nearest(reference: float, candidates) -> float | None:
    if not candidates:
        return None
    return min(abs(reference - c) for c in candidates)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("match_id", type=int)
    parser.add_argument("--json", action="store_true", help="dump the raw extraction instead of a report")
    parser.add_argument("--sources", default="", help="comma-separated subset of: " + ", ".join(EVENT_SOURCES))
    args = parser.parse_args()

    status = demo_status(args.match_id)
    if args.json:
        payload = {"status": status}
        if status.get("available"):
            payload["extraction"] = extract_events(args.match_id, [s for s in args.sources.split(",") if s] or None)
        print(json.dumps(payload, indent=2, default=str))
        return 0

    print(f"match {args.match_id}")
    if not status.get("available"):
        print(f"  demo: NOT AVAILABLE ({status.get('reason') or 'no replay published'})")
        print(f"        replay_salt={status.get('replay_salt')!r} demo_url={status.get('demo_url')!r}")
        print("\nThe demo query service downloads the replay itself, so without one there is")
        print("nothing to query — this is why archived project replays cannot be read here.")
        return 1
    print(f"  demo: {status['demo_url']}")

    result = extract_events(args.match_id, [s for s in args.sources.split(",") if s] or None)
    clock = result["clock"]
    print(f"  clock: tick_rate={clock['tick_rate']:.4f} offset={clock['offset_s']:.2f}s ({clock['source']})")

    for name, rows in result["events"].items():
        label = EVENT_SOURCES[name]["label"]
        if not rows:
            print(f"\n{label}: none recorded")
            continue
        times = [r["time_s"] for r in rows if r["time_s"] is not None]
        print(f"\n{label}: {len(rows)} events" + (f", {min(times):.0f}s–{max(times):.0f}s" if times else ""))
        for row in rows[:SAMPLES]:
            extra = {k: v for k, v in row.items() if k not in ("time_s",) and v is not None}
            print(f"   {row['time_s']:8.1f}s  {extra}")
        if len(rows) > SAMPLES:
            print(f"   … {len(rows) - SAMPLES} more")
    for name, err in (result.get("errors") or {}).items():
        print(f"\n{name}: FAILED — {err[:160]}")

    # Independent cross-check: the metadata feed times objectives from its own pipeline.
    meta = metadata_objectives(args.match_id)
    if "error" not in meta:
        demo_times = [r["time_s"] for r in result["events"].get("objective", []) if r.get("time_s") is not None]
        print("\ncross-check vs the metadata feed")
        for group in ("mid_boss", "objectives"):
            deltas = [nearest(m["time_s"], demo_times) for m in meta[group]]
            deltas = [d for d in deltas if d is not None]
            if deltas:
                print(f"   {group:10} n={len(meta[group]):2}  nearest demo objective off by "
                      f"min {min(deltas):.1f}s / max {max(deltas):.1f}s")
            else:
                print(f"   {group:10} n={len(meta[group]):2}  no matching demo rows")
    else:
        print(f"\ncross-check unavailable: {meta['error'][:120]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
