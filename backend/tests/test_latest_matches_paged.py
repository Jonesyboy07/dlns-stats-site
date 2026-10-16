import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class LatestMatchesPagedTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        with sqlite3.connect(os.environ["DB_PATH"]) as conn:
            conn.execute(
                """
                INSERT INTO matches (
                    match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, created_at
                ) VALUES (60000001, 1200, 0, 'NIGHT SHIFT', 60, 'Team A', 'Team B',
                          '2026-10-15T18:00:00Z')
                """
            )

    def tearDown(self):
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self.tmp.cleanup()

    def test_event_title_filter_is_case_insensitive(self):
        response = self.client.get(
            "/db/matches/latest/paged?event_title=Night%20Shift&include_players=0"
        )

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["total"], 1)
        self.assertEqual(payload["matches"][0]["event_week"], 60)


if __name__ == "__main__":
    unittest.main()
