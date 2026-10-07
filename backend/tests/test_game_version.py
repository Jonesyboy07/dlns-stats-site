from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest import mock

from backend import game_version as gv


def _epoch(day: int) -> int:
    return int(datetime(2026, 1, day, tzinfo=timezone.utc).timestamp())


LOG = "\n".join(
    [
        f"{_epoch(20)}\t6003 | 4 files | M x",
        f"{_epoch(15)}\tbot sync without a number",
        f"{_epoch(10)}\t6002 | 9 files | M y",
        f"{_epoch(5)}\t6001 | 1 files | M z",
    ]
)


class GameVersionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _resolver(self):
        # Pretend git is unavailable except for a canned log, and fake the clone dir.
        r = gv.GameVersionResolver(self.dir)
        (r.git_dir).mkdir(parents=True)
        (r.git_dir / "HEAD").write_text("ref: refs/heads/main")
        return r

    def test_message_parsing(self):
        self.assertEqual(gv.parse_commit_version("6759 | 17 files | M a"), 6759)
        self.assertIsNone(gv.parse_commit_version("Update something"))

    def test_resolves_from_one_sync_and_persists(self):
        with mock.patch.object(gv, "_git", return_value=LOG) as git:
            r = self._resolver()
            self.assertEqual(r.version_at(_epoch(12)), 6002)
            self.assertEqual(r.version_at(_epoch(7)), 6001)
            self.assertEqual(r.version_at(_epoch(25)), 6003)
            self.assertEqual(git.call_count, 2)  # one fetch + one log

        # A fresh instance reads the table from disk and never calls git.
        with mock.patch.object(gv, "_git", side_effect=AssertionError("offline")):
            self.assertEqual(gv.GameVersionResolver(self.dir).version_at(_epoch(12)), 6002)

    def test_before_first_commit_is_none(self):
        with mock.patch.object(gv, "_git", return_value=LOG):
            self.assertIsNone(self._resolver().version_at(_epoch(2)))

    def test_failed_sync_returns_none_without_raising(self):
        with mock.patch.object(gv, "_git", side_effect=OSError("no git")):
            self.assertIsNone(self._resolver().version_at(_epoch(12)))


if __name__ == "__main__":
    unittest.main()
