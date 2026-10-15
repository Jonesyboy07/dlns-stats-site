"""Snapshot the SQLite database, keeping the newest few copies.

The database is the only copy of every match, week and player row, and git ignores it
(``data/dlns.sqlite3``), so this is the one thing standing between a bad write and the
stats. SQLite's backup API takes a consistent snapshot of a database that is being
served, so this is safe to run while the site is up.

    python scripts/backup_db.py                 # -> _cache/dlns.auto_<stamp>.sqlite3
    python scripts/backup_db.py --keep 14
    python scripts/backup_db.py --db data/dlns.sqlite3 --dir D:\\backups --quiet

Each copy is verified (``PRAGMA quick_check`` plus a match-row count against the source)
before it replaces the temporary file, so a failed backup never leaves a half-written
file behind for someone to trust later.
"""

from __future__ import annotations

import argparse
import os
import sqlite3
import sys
import time
from pathlib import Path
from typing import Callable, Optional

# Only this script's own files are pruned, so hand-made backups like
# ``dlns.backup_before_<label>.sqlite3`` are never deleted by a scheduled run.
PREFIX = 'dlns.auto_'
SUFFIX = '.sqlite3'
DEFAULT_KEEP = 7
DEFAULT_DB = './data/dlns.sqlite3'


def resolve_db_path(explicit: Optional[str] = None) -> Path:
    """Explicit path, else ``DB_PATH``, else the usual ``./data/dlns.sqlite3``."""
    return Path(explicit or os.environ.get('DB_PATH') or DEFAULT_DB).expanduser()


def default_backup_dir(db_path: Path) -> Path:
    """``_cache`` beside the data directory, where this project keeps its backups."""
    return db_path.resolve().parent.parent / '_cache'


def _verify(conn: sqlite3.Connection, expected_matches: Optional[int]) -> None:
    result = conn.execute('PRAGMA quick_check').fetchone()
    if not result or result[0] != 'ok':
        raise RuntimeError(f'quick_check failed: {result[0] if result else "no result"}')
    if expected_matches is None:
        return
    found = conn.execute('SELECT COUNT(*) FROM matches').fetchone()[0]
    if found != expected_matches:
        raise RuntimeError(f'row count mismatch: source {expected_matches}, copy {found}')


def backup(db_path: Path, out_dir: Path, keep: int = DEFAULT_KEEP,
           log: Callable[[str], None] = print) -> Path:
    """Write a verified copy of ``db_path`` into ``out_dir`` and prune old ones.

    Returns the new file's path. Raises when the database is missing or the copy does
    not verify, having removed the temporary file first.
    """
    if not db_path.exists():
        raise FileNotFoundError(f'no database at {db_path}')
    if keep < 1:
        raise ValueError('--keep must be at least 1')
    out_dir.mkdir(parents=True, exist_ok=True)

    stamp = time.strftime('%Y%m%d-%H%M%S', time.gmtime())
    target = out_dir / f'{PREFIX}{stamp}{SUFFIX}'
    tmp = target.with_name(f'{target.name}.tmp')

    source = sqlite3.connect(f'file:{db_path.resolve().as_posix()}?mode=ro', uri=True, timeout=30)
    try:
        try:
            expected: Optional[int] = source.execute('SELECT COUNT(*) FROM matches').fetchone()[0]
        except sqlite3.OperationalError:
            expected = None  # no matches table yet: nothing to compare counts against
        if tmp.exists():
            tmp.unlink()
        dest = sqlite3.connect(tmp)
        try:
            with dest:
                source.backup(dest)
            _verify(dest, expected)
        finally:
            dest.close()
    except BaseException:
        for leftover in (tmp, tmp.with_name(f'{tmp.name}-wal'), tmp.with_name(f'{tmp.name}-shm')):
            if leftover.exists():
                leftover.unlink()
        raise
    finally:
        source.close()

    tmp.replace(target)
    size_mb = target.stat().st_size / 1_048_576
    log(f'backed up {db_path.name} -> {target} ({size_mb:.1f} MB, {expected} matches)')

    for old in sorted(out_dir.glob(f'{PREFIX}*{SUFFIX}'))[:-keep]:
        try:
            old.unlink()
            log(f'pruned {old.name}')
        except OSError as e:  # a locked file is not worth failing the backup over
            log(f'could not prune {old.name}: {e}')
    return target


def main(argv: Optional[list] = None) -> int:
    parser = argparse.ArgumentParser(description='Snapshot the DLNS database.')
    parser.add_argument('--db', help='database file (default: DB_PATH or ./data/dlns.sqlite3)')
    parser.add_argument('--dir', help='where to keep copies (default: _cache beside the data dir)')
    parser.add_argument('--keep', type=int, default=DEFAULT_KEEP, help=f'copies to keep (default {DEFAULT_KEEP})')
    parser.add_argument('--quiet', action='store_true', help='only report failures')
    args = parser.parse_args(argv)

    log: Callable[[str], None] = (lambda _: None) if args.quiet else print
    db_path = resolve_db_path(args.db)
    out_dir = Path(args.dir).expanduser() if args.dir else default_backup_dir(db_path)
    try:
        backup(db_path, out_dir, args.keep, log)
    except Exception as e:
        print(f'backup failed: {e}', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
