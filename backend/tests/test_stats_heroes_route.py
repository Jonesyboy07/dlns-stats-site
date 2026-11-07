"""Route tests for the stats page's Heroes tab endpoint, `/db/stats/heroes`.

The aggregation itself is covered in `test_stats_summary.py`; these check the
route's scoping (weeks, region, the look-back week) and that a database without
`match_bans` degrades to no bans instead of failing.
"""

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class StatsHeroesRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        # mkdtemp + ignore_errors on cleanup: Windows keeps the SQLite handle open
        # past the request, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-stats-heroes-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        self._write(
            """
            INSERT INTO matches (match_id, duration_s, winning_team, event_title, event_week,
                event_team_a, event_team_b, event_region) VALUES
                (1, 1800, 0, 'Night Shift', 59, 'Owls', 'Rats', 'EU'),
                (2, 1800, 0, 'Night Shift', 60, 'Owls', 'Rats', 'EU'),
                (3, 1800, 1, 'Night Shift', 61, 'Owls', 'Rats', 'EU'),
                (4, 1800, 0, 'Night Shift', 61, 'Cats', 'Dogs', 'NA');
            INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result) VALUES
                (1, 101, 1, 0, 2, 'Win'),
                (2, 101, 1, 0, 2, 'Win'),
                (2, 102, 2, 1, 7, 'Loss'),
                (3, 101, 1, 0, 7, 'Loss'),
                (3, 102, 2, 1, 13, 'Win'),
                (4, 103, 1, 0, 7, 'Win');
            INSERT INTO match_bans (match_id, ban_order, team, team_name, hero_id) VALUES
                (2, 1, 'team_a', 'Owls', 13),
                (3, 1, 'team_a', 'Owls', 2),
                (3, 2, 'team_b', 'Rats', 7);
            """
        )

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write(self, script):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript(script)
            conn.commit()
        finally:
            conn.close()

    def _get(self, query):
        response = self.client.get(f"/db/stats/heroes?{query}")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_meta_for_range_and_region(self):
        data = self._get("weeks=60-61&region=eu")
        self.assertEqual(data["range"], [60, 61])
        self.assertEqual(data["region"], "EU")
        self.assertEqual(data["games"], 2)
        self.assertEqual(data["total_bans"], 3)
        heroes = {h["hero_id"]: h for h in data["heroes"]}
        # Hero 7: picked in 2 and 3, banned in 3 -> contested in both games.
        self.assertEqual(heroes[7]["picks"], 2)
        self.assertEqual(heroes[7]["bans"], 1)
        self.assertEqual(heroes[7]["contested"], 2)
        self.assertEqual(heroes[7]["name"], "Wraith")
        # Week 59 is outside the range, so hero 2 has one pick there and one ban.
        self.assertEqual((heroes[2]["picks"], heroes[2]["bans"], heroes[2]["contested"]), (1, 1, 2))

    def test_movers_look_back_before_the_range(self):
        data = self._get("weeks=61&region=eu")
        self.assertEqual(data["games"], 1)
        self.assertEqual((data["latest_week"], data["previous_week"]), (61, 60))
        rising = {m["hero_id"]: m["delta"] for m in data["movers"]["rising"]}
        falling = {m["hero_id"]: m["delta"] for m in data["movers"]["falling"]}
        self.assertEqual(rising, {13: 100.0})
        self.assertEqual(falling, {2: -100.0})

    def test_no_previous_week_means_no_movers(self):
        data = self._get("weeks=59&region=eu")
        self.assertIsNone(data["movers"])

    def test_missing_match_bans_table_returns_no_bans(self):
        self._write("DROP TABLE match_bans;")
        data = self._get("weeks=60-61")
        self.assertEqual(data["total_bans"], 0)
        self.assertTrue(all(h["bans"] == 0 for h in data["heroes"]))
        self.assertEqual(data["games"], 3)


if __name__ == "__main__":
    unittest.main()
