import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class MatchPlayersLaneFieldsTests(unittest.TestCase):
    """The `/players` route reports lane provenance so the two values never mix silently."""

    def setUp(self):
        self._old_db_path = os.environ.get("DB_PATH")
        self._old_cache_dir = os.environ.get("CACHE_DIR")
        self._old_warmup = os.environ.get("CACHE_WARMUP_ON_STARTUP")
        # The app keeps a read-only connection open on Windows, so the temp DB can stay
        # locked at cleanup; the assertions have already run by then.
        self.tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
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
                [(101, "Swapped"), (202, "Agreed"), (303, "Assigned Only"), (404, "No Lane")],
            )
            conn.execute("INSERT INTO matches (match_id) VALUES (123)")
            conn.executemany(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, lane, lane_real) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                [
                    (123, 101, 1, 0, 11, 4, 6),     # inferred lane disagrees with the game's
                    (123, 202, 2, 0, 12, 4, 4),     # inferred lane agrees
                    (123, 303, 7, 1, 22, 6, None),  # only the game-reported lane exists
                    (123, 404, 8, 1, 23, None, None),  # neither exists
                ],
            )

    def tearDown(self):
        for key, old in (
            ("DB_PATH", self._old_db_path),
            ("CACHE_DIR", self._old_cache_dir),
            ("CACHE_WARMUP_ON_STARTUP", self._old_warmup),
        ):
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self.tmpdir.cleanup()

    def test_reports_lane_source_and_agreement_per_player(self):
        payload = self.client.get("/db/matches/123/players").get_json()
        by_account = {p["account_id"]: p for p in payload["players"]}

        self.assertEqual(by_account[101]["lane_source"], "inferred")
        self.assertIs(by_account[101]["lane_agrees"], False)

        self.assertEqual(by_account[202]["lane_source"], "inferred")
        self.assertIs(by_account[202]["lane_agrees"], True)

        self.assertEqual(by_account[303]["lane_source"], "assigned")
        self.assertIsNone(by_account[303]["lane_agrees"])

        self.assertIsNone(by_account[404]["lane_source"])
        self.assertIsNone(by_account[404]["lane_agrees"])

    def test_summarises_lane_provenance_for_the_match(self):
        payload = self.client.get("/db/matches/123/players").get_json()

        self.assertEqual(
            payload["lane_inference"],
            {"inferred": 2, "assigned": 1, "unknown": 1, "comparable": 2, "agree": 1},
        )


if __name__ == "__main__":
    unittest.main()
