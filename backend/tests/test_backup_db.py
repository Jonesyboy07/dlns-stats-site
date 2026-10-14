"""Tests for scripts/backup_db.py.

The database is not in git, so this script is the only automatic protection for the
stats: a copy has to be verified before it is trusted, a failed run has to leave
nothing behind that looks like a backup, and pruning must never delete the hand-made
``dlns.backup_before_<label>.sqlite3`` files that sit in the same directory.
"""

import importlib.util
import shutil
import sqlite3
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

_SPEC = importlib.util.spec_from_file_location(
    'backup_db', Path(__file__).resolve().parents[2] / 'scripts' / 'backup_db.py'
)
backup_db = importlib.util.module_from_spec(_SPEC)
sys.modules['backup_db'] = backup_db
_SPEC.loader.exec_module(backup_db)


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix='dlns-backup-'))
        self.db_path = self.tmpdir / 'data' / 'dlns.sqlite3'
        self.db_path.parent.mkdir(parents=True)
        self.out_dir = self.tmpdir / '_cache'
        conn = sqlite3.connect(self.db_path)
        conn.execute('CREATE TABLE matches (match_id INTEGER PRIMARY KEY, event_week INTEGER)')
        conn.executemany('INSERT INTO matches VALUES (?, ?)', [(1, 57), (2, 58), (3, 59)])
        conn.commit()
        conn.close()

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _copies(self):
        return sorted(self.out_dir.glob('dlns.auto_*.sqlite3'))

    def test_writes_a_verified_copy(self):
        path = backup_db.backup(self.db_path, self.out_dir, log=lambda _: None)
        self.assertTrue(path.exists())
        self.assertEqual(path.parent, self.out_dir)
        rows = sqlite3.connect(f'file:{path.as_posix()}?mode=ro', uri=True).execute(
            'SELECT match_id FROM matches ORDER BY match_id').fetchall()
        self.assertEqual(rows, [(1,), (2,), (3,)])

    def test_a_missing_database_is_an_error(self):
        with self.assertRaises(FileNotFoundError):
            backup_db.backup(self.tmpdir / 'nope.sqlite3', self.out_dir, log=lambda _: None)
        self.assertEqual(self._copies(), [])
        self.assertFalse(self.out_dir.exists())

    def test_keeps_only_the_newest_copies(self):
        self.out_dir.mkdir(parents=True)
        for i in range(4):
            (self.out_dir / f'dlns.auto_2025010{i}.sqlite3').write_bytes(b'old copy')
        latest = backup_db.backup(self.db_path, self.out_dir, keep=2, log=lambda _: None)
        names = [p.name for p in self._copies()]
        self.assertEqual(len(names), 2)
        self.assertIn(latest.name, names)
        self.assertIn('dlns.auto_20250103.sqlite3', names)
        self.assertNotIn('dlns.auto_20250100.sqlite3', names)

    def test_hand_made_backups_are_left_alone(self):
        manual = self.out_dir / 'dlns.backup_before_ns59_commit.sqlite3'
        self.out_dir.mkdir(parents=True)
        manual.write_bytes(b'previous copy')
        (self.out_dir / 'dlns.auto_20250100.sqlite3').write_bytes(b'old copy')
        backup_db.backup(self.db_path, self.out_dir, keep=1, log=lambda _: None)
        self.assertTrue(manual.exists())
        self.assertEqual(manual.read_bytes(), b'previous copy')
        autos = [p.name for p in self._copies()]
        self.assertEqual(len(autos), 1)
        self.assertNotIn('dlns.auto_20250100.sqlite3', autos)

    def test_a_failed_verification_leaves_no_file_behind(self):
        backup_db.backup(self.db_path, self.out_dir, log=lambda _: None)
        with mock.patch.object(backup_db, '_verify', side_effect=RuntimeError('quick_check failed')):
            with self.assertRaises(RuntimeError):
                backup_db.backup(self.db_path, self.out_dir, log=lambda _: None)
        self.assertEqual(list(self.out_dir.glob('*.tmp')), [])
        self.assertEqual(len(self._copies()), 1)

    def test_a_corrupt_source_leaves_no_file_behind(self):
        corrupt = self.tmpdir / 'corrupt.sqlite3'
        corrupt.write_bytes(b'this is not a database')
        with self.assertRaises(sqlite3.DatabaseError):
            backup_db.backup(corrupt, self.out_dir, log=lambda _: None)
        self.assertEqual(list(self.out_dir.glob('*.tmp')), [])
        self.assertEqual(self._copies(), [])

    def test_a_database_without_the_matches_table_still_backs_up(self):
        empty = self.tmpdir / 'fresh.sqlite3'
        conn = sqlite3.connect(empty)
        conn.execute('CREATE TABLE something_else (x INTEGER)')
        conn.commit()
        conn.close()
        path = backup_db.backup(empty, self.out_dir, log=lambda _: None)
        self.assertTrue(path.exists())

    def test_keep_must_be_positive(self):
        with self.assertRaises(ValueError):
            backup_db.backup(self.db_path, self.out_dir, keep=0, log=lambda _: None)

    def test_default_dir_is_cache_beside_the_data_dir(self):
        self.assertEqual(backup_db.default_backup_dir(self.db_path), self.tmpdir / '_cache')

    def test_db_path_arg_wins_over_the_environment(self):
        import os
        old = os.environ.get('DB_PATH')
        os.environ['DB_PATH'] = str(self.tmpdir / 'from-env.sqlite3')
        try:
            self.assertEqual(backup_db.resolve_db_path(str(self.db_path)), self.db_path)
            self.assertEqual(backup_db.resolve_db_path(), self.tmpdir / 'from-env.sqlite3')
        finally:
            if old is None:
                os.environ.pop('DB_PATH', None)
            else:
                os.environ['DB_PATH'] = old


class MainTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix='dlns-backup-main-'))
        self.db_path = self.tmpdir / 'dlns.sqlite3'
        conn = sqlite3.connect(self.db_path)
        conn.execute('CREATE TABLE matches (match_id INTEGER PRIMARY KEY)')
        conn.execute('INSERT INTO matches VALUES (1)')
        conn.commit()
        conn.close()
        self.out_dir = self.tmpdir / 'out'

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_returns_zero_and_prints_the_copy(self):
        import contextlib, io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = backup_db.main(['--db', str(self.db_path), '--dir', str(self.out_dir), '--keep', '1'])
        self.assertEqual(code, 0)
        self.assertIn('backed up', out.getvalue())
        self.assertEqual(len(list(self.out_dir.glob('dlns.auto_*.sqlite3'))), 1)

    def test_quiet_reports_nothing_on_success(self):
        import contextlib, io
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            code = backup_db.main(['--db', str(self.db_path), '--dir', str(self.out_dir), '--quiet'])
        self.assertEqual(code, 0)
        self.assertEqual(out.getvalue(), '')

    def test_returns_one_and_reports_a_failure(self):
        import contextlib, io
        err = io.StringIO()
        with contextlib.redirect_stderr(err):
            code = backup_db.main(['--db', str(self.tmpdir / 'missing.sqlite3'), '--dir', str(self.out_dir)])
        self.assertEqual(code, 1)
        self.assertIn('backup failed', err.getvalue())


if __name__ == '__main__':
    unittest.main()
