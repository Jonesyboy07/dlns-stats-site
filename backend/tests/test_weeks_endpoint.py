import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class WeeksEndpointTests(unittest.TestCase):
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

    def tearDown(self):
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self.tmp.cleanup()

    def _insert_match(self, match_id, week, subtitle="Finals"):
        with sqlite3.connect(os.environ["DB_PATH"]) as conn:
            conn.execute(
                """
                INSERT INTO matches (
                    match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, event_game, event_subtitle,
                    match_vod, created_at
                ) VALUES (?, 1800, 0, 'Night Shift', ?, 'Team A', 'Team B',
                          'Game 1', ?, 'https://example.com/vod',
                          '2026-10-21T18:00:00Z')
                """,
                (match_id, week, subtitle),
            )

    def test_week_ingested_without_schedule_entry_has_details(self):
        """A week present in the database but not in brackets.json still maps."""
        self._insert_match(61000001, 61)

        response = self.client.get("/db/weeks?event_title=Night%20Shift")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["weeks"].get("61000001"), 61)
        detail = payload["details"].get("61000001")
        self.assertIsNotNone(detail)
        self.assertEqual(detail["week"], 61)
        self.assertEqual(detail["series"], "Night Shift")
        self.assertEqual(detail["team_a"], "Team A")
        self.assertEqual(detail["team_b"], "Team B")
        self.assertEqual(detail["game"], "Game 1")
        self.assertEqual(detail["series_title"], "Finals")

    def test_event_title_filter_limits_database_fallback(self):
        self._insert_match(61000002, 61)
        with sqlite3.connect(os.environ["DB_PATH"]) as conn:
            conn.execute(
                """
                INSERT INTO matches (
                    match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, created_at
                ) VALUES (61000003, 1200, 0, 'Fight Night', 5, 'Team C', 'Team D',
                          '2026-10-21T18:00:00Z')
                """
            )

        response = self.client.get("/db/weeks?event_title=Night%20Shift")

        payload = response.get_json()
        self.assertIn("61000002", payload["details"])
        self.assertNotIn("61000003", payload["details"])


if __name__ == "__main__":
    unittest.main()
