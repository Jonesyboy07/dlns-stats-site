import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class MatchDeathsRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_db_path = os.environ.get("DB_PATH")
        self._old_cache_dir = os.environ.get("CACHE_DIR")
        self._old_warmup = os.environ.get("CACHE_WARMUP_ON_STARTUP")
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(Path(self.tmpdir.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        with sqlite3.connect(self.db_path) as conn:
            conn.executemany(
                "INSERT INTO users (account_id, persona_name) VALUES (?, ?)",
                [(101, "Amber Player"), (202, "Sapphire Player")],
            )
            conn.execute("INSERT INTO matches (match_id) VALUES (123)")
            conn.executemany(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id) "
                "VALUES (?, ?, ?, ?, ?)",
                [(123, 101, 1, 0, 11), (123, 202, 7, 1, 22)],
            )
            conn.executemany(
                "INSERT INTO player_deaths "
                "(match_id, account_id, death_index, death_time_s, position_x, position_y, "
                "position_z, midpoint_distance_x, midpoint_distance_y, midpoint_distance_z, "
                "midpoint_distance) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (123, 101, 1, 60, 1.5, 2.5, 3.5, 1.5, 2.5, 3.5, 4.56),
                    (123, 202, 1, 75, 4.0, 5.0, 6.0, 4.0, 5.0, 6.0, 8.77),
                    (123, 202, 2, 120, None, None, None, None, None, None, None),
                ],
            )

    def tearDown(self):
        if self._old_db_path is None:
            os.environ.pop("DB_PATH", None)
        else:
            os.environ["DB_PATH"] = self._old_db_path
        if self._old_cache_dir is None:
            os.environ.pop("CACHE_DIR", None)
        else:
            os.environ["CACHE_DIR"] = self._old_cache_dir
        if self._old_warmup is None:
            os.environ.pop("CACHE_WARMUP_ON_STARTUP", None)
        else:
            os.environ["CACHE_WARMUP_ON_STARTUP"] = self._old_warmup
        self.tmpdir.cleanup()

    def test_returns_ordered_deaths_with_player_details_and_nullable_positions(self):
        response = self.client.get("/db/matches/123/deaths")

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["count"], 3)
        self.assertEqual(payload["filters"], {"team": None, "account_id": None})
        self.assertEqual(
            [(death["account_id"], death["death_index"]) for death in payload["deaths"]],
            [(101, 1), (202, 1), (202, 2)],
        )
        self.assertEqual(payload["deaths"][0]["persona_name"], "Amber Player")
        self.assertEqual(payload["deaths"][0]["team"], 0)
        self.assertEqual(payload["deaths"][0]["position_x"], 1.5)
        self.assertIsNone(payload["deaths"][2]["position_x"])

    def test_team_and_account_filters_can_be_combined(self):
        response = self.client.get("/db/matches/123/deaths?team=1&account_id=202")

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload["filters"], {"team": 1, "account_id": 202})
        self.assertEqual(
            [(death["account_id"], death["death_index"]) for death in payload["deaths"]],
            [(202, 1), (202, 2)],
        )

    def test_invalid_filters_are_rejected(self):
        for query, error in (
            ("team=2", "invalid_team"),
            ("team=amber", "invalid_team"),
            ("account_id=abc", "invalid_account_id"),
            ("account_id=0", "invalid_account_id"),
            ("account_id=9223372036854775808", "invalid_account_id"),
        ):
            with self.subTest(query=query):
                response = self.client.get(f"/db/matches/123/deaths?{query}")
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.get_json(), {"error": error})


if __name__ == "__main__":
    unittest.main()
