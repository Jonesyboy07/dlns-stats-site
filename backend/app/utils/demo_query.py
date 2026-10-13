"""Demo-event extraction through deadlock-api's hosted demo query service.

The match metadata feed carries no *timed* neutral-camp, destructable or power-up
events — only end-of-match counts (`neutral_kills`, `power_up_buffs`) — so those rows in
the timeline have to come from the demo. deadlock-api runs a service that parses a demo
server-side and answers SQL over ~950 event/entity tables:

    POST /v1/matches/demo/query   {match_id, query, format}  -> job_id
    GET  /v1/matches/demo/query/{job_id}                     -> result_url
    GET  /v1/matches/demo/schema?match_id=                   -> tables + columns

Two constraints shape this module:

* The service fetches the demo itself and only accepts a `match_id`, so it works only
  while Valve still hosts the replay. `demo_status()` reports that, and returns no
  `replay_salt` for matches that never had one (every recent custom-lobby match we
  checked). A demo the project archives itself cannot be submitted.
* Entity tables are per-tick *deltas*, not events: `delta_type` is `create`, `update` or
  `delete`, so "a camp was punched" is a `delete` row. Event tables (`BossKilledEvent`,
  `SoulBagPickupEvent`, …) are already one row per occurrence.

Everything is tick-based. The demo runs at 64 ticks/second and game time has a per-match
offset, so `calibrate_clock()` derives `gametime = tick / rate + offset` from
`BossKilledEvent`, the one table carrying both, rather than assuming `tick / 64`.
"""

from __future__ import annotations

import json
import time
from typing import Any, Dict, List, Mapping, Optional, Sequence

import requests

DEMO_QUERY_URL = "https://api.deadlock-api.com/v1/matches/demo/query"
DEMO_SCHEMA_URL = "https://api.deadlock-api.com/v1/matches/demo/schema"
MATCH_SALTS_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/salts"

# Confirmed from consecutive BossKilledEvent rows; only used if calibration fails.
DEFAULT_TICK_RATE = 64.0

_JOB_POLL_SECONDS = 4
_JOB_TIMEOUT_SECONDS = 180


def _zstd_decompress(payload: bytes) -> bytes:
    """Decompress a zstd payload, using whichever binding is available."""
    try:
        from compression import zstd  # Python 3.14+

        return zstd.decompress(payload)
    except ImportError:
        pass
    try:
        import zstandard  # optional dependency

        return zstandard.ZstdDecompressor().decompress(payload)
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise RuntimeError(
            "Reading demo query results needs zstd support: run on Python 3.14+ or "
            "install the `zstandard` package."
        ) from exc


def demo_status(match_id: int, timeout: int = 10) -> Dict[str, Any]:
    """What the demo service can fetch for a match.

    `replay_salt` is what a demo URL is built from; when it is null the match never
    published a replay and no demo stage can run for it.
    """
    resp = requests.get(MATCH_SALTS_URL.format(match_id=match_id), timeout=timeout)
    if resp.status_code == 404:
        return {"match_id": match_id, "available": False, "reason": "unknown to the API"}
    resp.raise_for_status()
    payload = resp.json()
    return {
        "match_id": match_id,
        "available": bool(payload.get("demo_url")),
        "replay_salt": payload.get("replay_salt"),
        "demo_url": payload.get("demo_url"),
        "metadata_url": payload.get("metadata_url"),
    }


def submit_query(match_id: int, query: str, fmt: str = "ndjson", timeout: int = 30) -> str:
    """Queue `query` over a match's demo and return the job id.

    Raises RuntimeError with the service's own message, which is where "No demo
    available" and "Failed to download demo" come from.
    """
    resp = requests.post(
        DEMO_QUERY_URL,
        json={"match_id": match_id, "query": query, "format": fmt},
        timeout=timeout,
    )
    payload: Dict[str, Any] = {}
    try:
        payload = resp.json()
    except ValueError:
        pass
    if resp.status_code not in (200, 202) or "job_id" not in payload:
        raise RuntimeError(
            f"demo query rejected for match {match_id} (HTTP {resp.status_code}): "
            f"{payload.get('error') or resp.text[:200]}"
        )
    return str(payload["job_id"])


def wait_for_result(job_id: str, timeout: int = _JOB_TIMEOUT_SECONDS) -> str:
    """Poll a job until it finishes and return its result URL."""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        resp = requests.get(f"{DEMO_QUERY_URL}/{job_id}", timeout=30)
        resp.raise_for_status()
        payload = resp.json()
        status = payload.get("status")
        if status == "done":
            url = payload.get("result_url")
            if not url:
                raise RuntimeError(f"job {job_id} finished without a result URL")
            return str(url)
        if status not in ("queued", "running", "processing"):
            raise RuntimeError(f"job {job_id} failed: {json.dumps(payload)[:200]}")
        time.sleep(_JOB_POLL_SECONDS)
    raise TimeoutError(f"job {job_id} did not finish within {timeout}s")


def parse_result(raw: bytes) -> List[Dict[str, Any]]:
    """Parse a downloaded demo-query result.

    Results arrive as newline-delimited JSON, normally zstd-compressed. Parquet is
    rejected with a clear message rather than returning nonsense, since `fetch_rows`
    only ever asks for ndjson.
    """
    if raw[:4] == b"PAR1":
        raise RuntimeError("expected ndjson but got parquet; request format='ndjson'")
    if not raw.strip():
        return []
    body = raw if raw.lstrip()[:1] == b"{" else _zstd_decompress(raw)
    text = body.decode("utf-8", "replace").strip()
    if not text:
        return []
    if not text.startswith("{"):
        raise RuntimeError(f"unexpected result payload (first bytes: {raw[:4]!r})")
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def fetch_rows(result_url: str, timeout: int = 120) -> List[Dict[str, Any]]:
    """Download an ndjson(.zst) result and parse it into rows."""
    resp = requests.get(result_url, timeout=timeout)
    resp.raise_for_status()
    return parse_result(resp.content)


def query_rows(match_id: int, query: str, timeout: int = _JOB_TIMEOUT_SECONDS) -> List[Dict[str, Any]]:
    """Run one query end to end: submit, wait, download, parse."""
    return fetch_rows(wait_for_result(submit_query(match_id, query), timeout=timeout))


def calibrate_clock(match_id: int) -> Dict[str, float]:
    """Derive the per-match `gametime = tick / rate + offset` mapping.

    Fit from the two furthest-apart `BossKilledEvent` rows; a single row would pin the
    offset but not the rate, and assuming 64 would drift over a 40-minute match.
    """
    rows = query_rows(match_id, "SELECT tick, gametime FROM BossKilledEvent")
    points = [
        (float(r["tick"]), float(r["gametime"]))
        for r in rows
        if r.get("tick") is not None and r.get("gametime") is not None
    ]
    if len(points) >= 2:
        points.sort()
        (tick0, time0), (tick1, time1) = points[0], points[-1]
        if tick1 > tick0:
            rate = (tick1 - tick0) / (time1 - time0)
            return {"tick_rate": rate, "offset_s": time0 - tick0 / rate, "source": "BossKilledEvent"}
    if len(points) == 1:
        rate = DEFAULT_TICK_RATE
        return {"tick_rate": rate, "offset_s": points[0][1] - points[0][0] / rate, "source": "single row"}
    return {"tick_rate": DEFAULT_TICK_RATE, "offset_s": 0.0, "source": "default"}


def tick_seconds(tick: Any, clock: Mapping[str, float]) -> Optional[float]:
    """A demo tick as match seconds, via the calibrated clock."""
    if tick is None:
        return None
    return float(tick) / float(clock.get("tick_rate") or DEFAULT_TICK_RATE) + float(clock.get("offset_s") or 0.0)


# --- Event sources -------------------------------------------------------------------
# Only the columns we render are selected: these tables have 100-180 columns each.
#
# Identifiers are double-quoted because the demo engine lowercases unquoted names and
# these columns really are mixed case (`CBodyComponent__m_vecX`, `m_iTeamNum`).
#
# Per-tick entity tables are PVS-scoped: `delta_type` is `create` when an entity first
# becomes visible, `update` while it is, `leave` when it goes out of view, and `delete`
# when the game actually removes it. Only `delete` means "destroyed", which is why the
# camp query below is built on it — a camp entity is deleted the moment it is punched.
#
# Not extractable, kept here as a note so it is not re-attempted: destructables.
# `CCitadel_BreakableProp` emits `create` (14,979) and `leave` (489) deltas but no
# `delete`, and `m_lifeState` never leaves 0, so a broken crate cannot be told apart
# from one that merely left the player's view. `CBreakableProp`, `CPropAnimatingBreakable`,
# `CCitadelItemPickup` and `CCitadel_Pickup_Currency` are empty in the demos checked.
EVENT_SOURCES: Dict[str, Dict[str, str]] = {
    "camp_punched": {
        "label": "Neutral camp punched",
        # A delete delta carries only the key, so the position and loot come from the
        # last `update` row for the same entity.
        "sql": (
            "WITH deleted AS ("
            "  SELECT entity_index, tick FROM CCitadelItemPunchableNeutralGold "
            "  WHERE delta_type = 'delete'"
            "), last_seen AS ("
            "  SELECT entity_index, \"CBodyComponent__m_vecX\" AS x, "
            "         \"CBodyComponent__m_vecY\" AS y, \"CBodyComponent__m_vecZ\" AS z, "
            "         \"m_eLootType\" AS loot_type, \"m_nCurrencyValue\" AS currency, "
            "         row_number() OVER (PARTITION BY entity_index ORDER BY tick DESC) AS rn "
            "  FROM CCitadelItemPunchableNeutralGold WHERE delta_type = 'update'"
            ") "
            "SELECT deleted.tick, deleted.entity_index, last_seen.x, last_seen.y, "
            "       last_seen.z, last_seen.loot_type, last_seen.currency "
            "FROM deleted JOIN last_seen "
            "  ON last_seen.entity_index = deleted.entity_index AND last_seen.rn = 1"
        ),
    },
    "soul_bag": {
        "label": "Soul bag / urn pickup",
        "sql": "SELECT tick, pickup_player, victim_player, killfeed_gold FROM SoulBagPickupEvent",
    },
    "objective": {
        "label": "Objective destroyed",
        "sql": (
            "SELECT tick, entity_killed_class, objective_team, entity_position "
            "FROM BossKilledEvent"
        ),
    },
    "buff": {
        "label": "Buff / aura applied",
        "sql": (
            "SELECT tick, entindex_target, modifier_type_id "
            "FROM AuraModifierAppliedEvent"
        ),
    },
}


def extract_events(match_id: int, sources: Optional[Sequence[str]] = None) -> Dict[str, Any]:
    """Pull the timeline events this prototype supports, with times in seconds.

    A source that errors is reported rather than raised, because table availability
    varies per match (`CBreakable` and `ModifierAppliedEvent` are empty in some demos).
    """
    clock = calibrate_clock(match_id)
    wanted = list(sources or EVENT_SOURCES)
    events: Dict[str, List[Dict[str, Any]]] = {}
    errors: Dict[str, str] = {}
    for name in wanted:
        source = EVENT_SOURCES.get(name)
        if not source:
            errors[name] = "unknown source"
            continue
        try:
            rows = query_rows(match_id, source["sql"])
        except Exception as exc:  # noqa: BLE001 - one bad table must not kill the run
            errors[name] = str(exc)
            continue
        for row in rows:
            row["time_s"] = tick_seconds(row.pop("tick", None), clock)
        rows.sort(key=lambda r: (r["time_s"] is None, r["time_s"]))
        events[name] = rows
    return {"match_id": match_id, "clock": clock, "events": events, "errors": errors}
