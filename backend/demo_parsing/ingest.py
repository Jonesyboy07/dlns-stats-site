"""The `-demoparse` sweep: pick matches, then find -> download -> extract -> parse -> store.

Each match is recorded in match_demo_parse whatever happens, so the next sweep skips
finished work:

  ok       parsed; skipped unless re-parsing, or a different parser version made it
  no_demo  neither source had a demo; re-checked every sweep, because a replay can be
           uploaded to the share later (the check is a local index lookup)
  failed   found but could not be downloaded or parsed; retried only with reparse

Valve is only asked about recent matches (`valve_max_age_days`): it deletes demos within
weeks, and asking about every old match would be hundreds of pointless API calls.
"""

from __future__ import annotations

import os
import shutil
import sqlite3
import tempfile
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional

from . import parse as demo_parse
from . import source as demo_source
from . import store as demo_store

DEFAULT_VALVE_MAX_AGE_DAYS = 30


def default_replay_index_path() -> Path:
    """The index the web app maintains: REPLAY_INDEX_FILE_CACHE_PATH, else `_cache/`."""
    configured = os.environ.get("REPLAY_INDEX_FILE_CACHE_PATH")
    return Path(configured) if configured else Path.cwd() / "_cache" / "replay_index.json"


def select_matches(
    conn: sqlite3.Connection,
    *,
    only_match_id: Optional[int] = None,
    since_week: Optional[int] = None,
    reparse: bool = False,
    parser_version: Optional[str] = None,
) -> List[int]:
    """Matches to attempt this sweep, newest first. Placeholders (no player rows) never.

    With `parser_version`, an 'ok' parse made by any other version is picked up again, so
    upgrading boon re-runs exactly what the old version produced.
    """
    if only_match_id is not None:
        return [int(only_match_id)]

    clauses = ["m.match_id > 0", "EXISTS (SELECT 1 FROM players p WHERE p.match_id = m.match_id)"]
    params: List[object] = []
    if since_week is not None:
        clauses.append("m.event_week >= ?")
        params.append(int(since_week))
    if not reparse:
        version_clause = ""
        if parser_version:
            version_clause = " AND COALESCE(d.parser_version, '') = ?"
            params.append(parser_version)
        clauses.append(
            "NOT EXISTS (SELECT 1 FROM match_demo_parse d WHERE d.match_id = m.match_id AND "
            f"(d.status = 'failed' OR (d.status = 'ok'{version_clause})))"
        )
    sql = (
        "SELECT m.match_id FROM matches m WHERE " + " AND ".join(clauses)
        + " ORDER BY COALESCE(m.start_time, '') DESC, m.match_id DESC"
    )
    return [row[0] for row in conn.execute(sql, params)]


def _is_recent(start_time: Optional[str], max_age_days: int) -> bool:
    if not start_time:
        return False
    try:
        started = datetime.fromisoformat(str(start_time).replace("Z", "+00:00"))
    except ValueError:
        return False
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    return datetime.now(timezone.utc) - started <= timedelta(days=max_age_days)


def parse_match(
    conn: sqlite3.Connection,
    match_id: int,
    *,
    replay_index,
    download_base_url: Optional[str],
    work_root: Path,
    try_valve: bool,
    timeout_s: float,
    python: Optional[str],
    keep_files: bool = False,
    log: Callable[[str], None] = print,
) -> str:
    """Parse one match end to end; returns the status recorded ('ok'/'no_demo'/'failed')."""
    try:
        location = demo_source.find_demo(
            match_id, replay_index=replay_index, download_base_url=download_base_url, try_valve=try_valve,
        )
    except demo_source.DemoNotFound:
        # Only worth a line for a single named match; a sweep reports the count instead.
        if try_valve:
            log(f"[demoparse] {match_id}: no demo on the replay share or at Valve")
        demo_store.mark_status(conn, match_id, "no_demo")
        return "no_demo"

    work_dir = Path(tempfile.mkdtemp(prefix=f"demo-{match_id}-", dir=work_root))
    started = time.time()
    try:
        archive = demo_source.download(location.url, work_dir / "download.bin")
        demo = demo_source.extract_demo(archive, work_dir, match_id)
        archive.unlink(missing_ok=True)  # halve the disk footprint before parsing
        result = demo_parse.run_worker(demo, work_dir / "result.json", timeout_s=timeout_s, python=python)
        result_match = result.get("match_id")
        if result_match not in (None, 0) and int(result_match) != int(match_id):
            raise demo_parse.DemoParseError(f"demo is for match {result_match}, not {match_id}")
        # A parse that read nothing is a failure, not an empty success: recording it as
        # ok would blank souls on the page and stop later sweeps from retrying it.
        if not result.get("series"):
            raise demo_parse.DemoParseError("parser produced no player data")
        counts = demo_store.write_result(conn, match_id, result, source=location.source)
        log(
            f"[demoparse] {match_id}: ok from {location.source} in {time.time() - started:.0f}s "
            f"({counts['series']} players, {counts['kills']} kills, {counts['events']} events)"
        )
        return "ok"
    except demo_source.DemoNotFound as exc:
        log(f"[demoparse] {match_id}: no demo ({location.source}: {exc})")
        demo_store.mark_status(conn, match_id, "no_demo", source=location.source, error=str(exc))
        return "no_demo"
    except (demo_source.DemoFormatError, demo_parse.DemoParseError, OSError, ValueError) as exc:
        log(f"[demoparse] {match_id}: failed ({type(exc).__name__}: {exc})")
        demo_store.mark_status(conn, match_id, "failed", source=location.source, error=f"{type(exc).__name__}: {exc}")
        return "failed"
    except Exception as exc:  # noqa: BLE001 - network errors and the like: record and move on
        log(f"[demoparse] {match_id}: failed ({type(exc).__name__}: {exc})")
        demo_store.mark_status(conn, match_id, "failed", source=location.source, error=f"{type(exc).__name__}: {exc}")
        return "failed"
    finally:
        if keep_files:
            log(f"[demoparse] {match_id}: kept files in {work_dir}")
        else:
            shutil.rmtree(work_dir, ignore_errors=True)


def run_demo_parse(
    conn: sqlite3.Connection,
    *,
    only_match_id: Optional[int] = None,
    since_week: Optional[int] = None,
    reparse: bool = False,
    timeout_s: float = demo_parse.DEFAULT_TIMEOUT_S,
    keep_files: bool = False,
    replay_index_path: Optional[Path] = None,
    download_base_url: Optional[str] = None,
    work_root: Optional[Path] = None,
    python: Optional[str] = None,
    valve_max_age_days: int = DEFAULT_VALVE_MAX_AGE_DAYS,
    log: Callable[[str], None] = print,
) -> Dict[str, int]:
    """The whole sweep. Returns how many matches ended in each status."""
    index_path = Path(replay_index_path) if replay_index_path else default_replay_index_path()
    replay_index = demo_source.load_replay_index(index_path)
    base_url = download_base_url if download_base_url is not None else os.environ.get("REPLAY_DOWNLOAD_BASE_URL")
    root = Path(work_root or os.environ.get("DEMO_WORK_DIR") or tempfile.gettempdir())
    root.mkdir(parents=True, exist_ok=True)

    log(f"[demoparse] replay index: {len(replay_index)} replays ({index_path})")
    if not base_url:
        log("[demoparse] REPLAY_DOWNLOAD_BASE_URL is not set, so the replay share cannot be used.")

    match_ids = select_matches(conn, only_match_id=only_match_id, since_week=since_week, reparse=reparse)
    start_times = dict(conn.execute("SELECT match_id, start_time FROM matches"))
    log(f"[demoparse] {len(match_ids)} matches to check.")

    stats = {"ok": 0, "no_demo": 0, "failed": 0}
    for position, match_id in enumerate(match_ids, start=1):
        status = parse_match(
            conn,
            match_id,
            replay_index=replay_index,
            download_base_url=base_url,
            work_root=root,
            try_valve=only_match_id is not None or _is_recent(start_times.get(match_id), valve_max_age_days),
            timeout_s=timeout_s,
            python=python,
            keep_files=keep_files,
            log=log,
        )
        stats[status] += 1
        if position % 25 == 0:
            log(f"[demoparse] {position}/{len(match_ids)} checked ({stats})")

    log(f"[demoparse] Done: {stats['ok']} parsed, {stats['no_demo']} without a demo, {stats['failed']} failed.")
    return stats
