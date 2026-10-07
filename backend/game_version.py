"""Map a match timestamp to the Deadlock game version (build number).

SteamTracking/GameTracking-Deadlock commits every game update with a message
that starts with the build number, e.g. "6759 | 17 files | M ...". The version
active at a timestamp is the build number of the latest such commit at or
before it.

The whole commit history is pulled in one go with a commits-only git fetch (no
trees or blobs, under 1 MB, no API rate limit) and reduced to a
timestamp -> version table stored on disk in data/_cache/ (git-ignored).
Lookups read that table and only sync again when asked about a time newer than
the last sync.
"""
from __future__ import annotations

import bisect
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, List, Optional, Tuple

REPO_URL = "https://github.com/SteamTracking/GameTracking-Deadlock.git"
RESYNC_MIN_INTERVAL_S = 600
GIT_TIMEOUT_S = 120

_VERSION_RE = re.compile(r"^\s*(\d+)\s*\|")


def default_cache_dir() -> Path:
    override = os.getenv("GAME_VERSION_CACHE_DIR")
    return Path(override) if override else Path.cwd() / "data" / "_cache"


def iso_to_epoch(value: Any) -> Optional[int]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def parse_commit_version(message: str) -> Optional[int]:
    m = _VERSION_RE.match(message or "")
    return int(m.group(1)) if m else None


def _git(git_dir: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "--git-dir", str(git_dir), *args],
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=GIT_TIMEOUT_S,
        env={**os.environ, "GIT_TERMINAL_PROMPT": "0"},
        check=True,
    )
    return result.stdout


class GameVersionResolver:
    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self.cache_dir = Path(cache_dir) if cache_dir else default_cache_dir()
        self.table_path = self.cache_dir / "game_versions.json"
        self.git_dir = self.cache_dir / "GameTracking-Deadlock.git"
        self._lock = threading.Lock()
        # Ascending [(epoch, version)]; synced_at is when the table was last built.
        self._table: List[Tuple[int, int]] = []
        self._synced_at = 0
        self._last_attempt = 0.0
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.table_path.read_text(encoding="utf-8"))
            self._table = sorted((int(t), int(v)) for t, v in data.get("commits", []))
            self._synced_at = int(data.get("synced_at", 0))
        except (OSError, ValueError, TypeError):
            self._table, self._synced_at = [], 0

    def _save(self) -> None:
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.table_path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps({"synced_at": self._synced_at, "commits": self._table}),
                encoding="utf-8",
            )
            os.replace(tmp, self.table_path)
        except OSError:
            pass

    def sync(self) -> bool:
        """Pull the full commit history and rebuild the on-disk table."""
        self._last_attempt = time.time()
        try:
            if not (self.git_dir / "HEAD").exists():
                self.cache_dir.mkdir(parents=True, exist_ok=True)
                subprocess.run(
                    ["git", "init", "--bare", "--quiet", str(self.git_dir)],
                    check=True, capture_output=True, timeout=GIT_TIMEOUT_S,
                )
                _git(self.git_dir, "remote", "add", "origin", REPO_URL)
            # Commits only: no trees or blobs, so this stays tiny.
            _git(self.git_dir, "fetch", "--quiet", "--filter=tree:0", "origin", "HEAD")
            log = _git(self.git_dir, "log", "FETCH_HEAD", "--format=%ct%x09%s")
        except (OSError, subprocess.SubprocessError):
            return False
        fetched_at = int(time.time())
        commits = set()
        for line in log.splitlines():
            stamp, _, subject = line.partition("\t")
            version = parse_commit_version(subject)
            if version is not None and stamp.isdigit():
                commits.add((int(stamp), version))
        if not commits:
            return False
        self._table = sorted(commits)
        self._synced_at = fetched_at
        self._save()
        return True

    def version_at(self, ts: Optional[int]) -> Optional[int]:
        if ts is None:
            return None
        with self._lock:
            stale = not self._table or ts > self._synced_at
            if stale and time.time() - self._last_attempt >= RESYNC_MIN_INTERVAL_S:
                self.sync()
            idx = bisect.bisect_right(self._table, (ts, float("inf"))) - 1
            return self._table[idx][1] if idx >= 0 else None

    def version_at_iso(self, value: Any) -> Optional[int]:
        return self.version_at(iso_to_epoch(value))


_default_resolver: Optional[GameVersionResolver] = None
_default_lock = threading.Lock()


def get_resolver() -> GameVersionResolver:
    global _default_resolver
    with _default_lock:
        if _default_resolver is None:
            _default_resolver = GameVersionResolver()
        return _default_resolver


def resolve_game_version(timestamp_iso: Any) -> Optional[int]:
    return get_resolver().version_at_iso(timestamp_iso)
