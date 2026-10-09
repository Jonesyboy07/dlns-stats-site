import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app
from backend.main import (
    db_connect,
    db_init,
    ingest_match_mid_boss,
    ingest_match_objectives,
    ingest_player_deaths,
)

# Two deaths the snapshot counters report, with the exact detail the API attaches.
SAMPLE_MATCH_INFO = {
    "match_id": 123,
    "objectives": [
        {"team": 0, "team_objective_id": 9, "destroyed_time_s": 1790, "first_damage_time_s": 1781,
         "player_damage": 10183, "creep_damage": 0, "player_spirit_damage": 2010},
        {"team": 1, "team_objective_id": 10, "destroyed_time_s": 0, "first_damage_time_s": 0,
         "player_damage": 0, "creep_damage": 0, "player_spirit_damage": 0},
    ],
    "mid_boss": [
        {"team_killed": 0, "team_claimed": 1, "destroyed_time_s": 1047},
        {"team_killed": 1, "team_claimed": 0, "destroyed_time_s": 1488},
    ],
    "match_paths": {
        "interval_s": 1.0,
        "paths": [{"player_slot": 1, "x_pos": list(range(0, 800)), "y_pos": [0] * 800, "z_pos": [0] * 800}],
    },
    "players": [
        {
            "account_id": 42,
            "player_slot": 1,
            "team": 0,
            "hero_id": 11,
            "stats": [
                {"time_stamp_s": 180, "deaths": 0},
                {"time_stamp_s": 360, "deaths": 1},
                {"time_stamp_s": 540, "deaths": 2},
            ],
            "death_details": [
                {"game_time_s": 355, "killer_player_slot": 9, "time_to_kill_s": 4.5, "death_duration_s": 14,
                 "death_pos": {"x": 3, "y": 4, "z": 0}},
                {"game_time_s": 530, "killer_player_slot": 10, "time_to_kill_s": 28.4, "death_duration_s": 21,
                 "death_pos": {"x": 0, "y": 0, "z": None}},
            ],
        }
    ],
}


class TimelineIngestTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "dlns.sqlite3"
        self.conn = db_connect(self.db_path)
        db_init(self.conn)
        self.conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (?, ?)", (123, 1903))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.tmpdir.cleanup()

    def test_objectives_are_stored_including_survivors(self):
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT team, objective_id, destroyed_time_s, player_spirit_damage "
            "FROM match_objectives ORDER BY objective_id"
        ).fetchall()
        self.assertEqual(rows, [(0, 9, 1790, 2010), (1, 10, 0, 0)])

    def test_objectives_reingest_replaces_rows(self):
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        count = self.conn.execute("SELECT COUNT(*) FROM match_objectives WHERE match_id = 123").fetchone()[0]
        self.assertEqual(count, 2)

    def test_mid_boss_rows_keep_api_order(self):
        ingest_match_mid_boss(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT boss_index, team_claimed, destroyed_time_s FROM match_mid_boss ORDER BY boss_index"
        ).fetchall()
        self.assertEqual(rows, [(0, 1, 1047), (1, 0, 1488)])

    def test_deaths_use_exact_detail_time_and_position(self):
        ingest_player_deaths(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT death_index, death_time_s, position_x, position_y, position_z, "
            "midpoint_distance, killer_player_slot, time_to_kill_s, death_duration_s "
            "FROM player_deaths ORDER BY death_index"
        ).fetchall()
        first = rows[0]
        self.assertEqual(first[0], 1)
        self.assertEqual(first[1], 355)  # exact time from death_details, not the snapshot
        self.assertEqual((first[2], first[3], first[4]), (3.0, 4.0, 0.0))
        self.assertAlmostEqual(first[5], 5.0)  # 3-4-5 from the death position
        self.assertEqual(first[6], 9)
        self.assertAlmostEqual(first[7], 4.5)
        self.assertEqual(first[8], 14)

        # A death with an incomplete position keeps the time but no distance.
        self.assertEqual(rows[1][1], 530)
        self.assertIsNone(rows[1][5])
        self.assertEqual(rows[1][6], 10)

    def test_death_count_matches_the_authoritative_player_count(self):
        ingest_player_deaths(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        count = self.conn.execute("SELECT COUNT(*) FROM player_deaths WHERE match_id = 123").fetchone()[0]
        self.assertEqual(count, len(SAMPLE_MATCH_INFO["players"][0]["death_details"]))

    def test_deaths_without_details_fall_back_to_snapshots(self):
        info = {
            "match_paths": SAMPLE_MATCH_INFO["match_paths"],
            "players": [{
                "account_id": 42,
                "player_slot": 1,
                "stats": [{"time_stamp_s": 180, "deaths": 0}, {"time_stamp_s": 360, "deaths": 1}],
            }],
        }
        ingest_player_deaths(self.conn, 123, info)
        self.conn.commit()

        row = self.conn.execute(
            "SELECT death_time_s, position_x, midpoint_distance, killer_player_slot, "
            "time_to_kill_s, death_duration_s FROM player_deaths"
        ).fetchone()
        self.assertEqual(row[0], 360)  # snapshot time is the best available
        self.assertEqual(row[1], 360.0)  # sampled from match_paths
        self.assertEqual(row[2], 360.0)
        self.assertEqual(row[3:], (None, None, None))


class MatchEventsRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        # mkdtemp + ignore_errors on cleanup: Windows keeps the SQLite handle open
        # past the request, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-timeline-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (123, 1903)")
            conn.execute("INSERT INTO users (account_id, persona_name) VALUES (42, 'Tester')")
            conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id) VALUES (123, 42, 1, 0, 11)"
            )
            conn.executemany(
                "INSERT INTO match_objectives (match_id, team, objective_id, destroyed_time_s, "
                "first_damage_time_s, player_damage, creep_damage, player_spirit_damage) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (123, 0, 9, 1790, 1781, 10183, 0, 2010),
                    # A lane objective: slot 3 is lane 4.
                    (123, 1, 3, 481, 59, 4575, 1000, 190),
                    # Survived the match: stored, but not a timeline event.
                    (123, 1, 10, 0, 0, 0, 0, 0),
                ],
            )
            conn.execute(
                "INSERT INTO match_mid_boss (match_id, boss_index, team_killed, team_claimed, destroyed_time_s) "
                "VALUES (123, 0, 0, 1, 1047)"
            )
            conn.execute(
                "INSERT INTO player_deaths (match_id, account_id, death_index, death_time_s, "
                "killer_player_slot, time_to_kill_s, death_duration_s, position_x) "
                "VALUES (123, 42, 1, 355, 9, 4.5, 14, 120.5)"
            )

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_events_merge_sources_in_time_order(self):
        response = self.client.get("/db/matches/123/events")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["available"])
        self.assertEqual(payload["duration_s"], 1903)
        self.assertEqual(payload["counts"], {"objectives": 2, "mid_boss": 1, "deaths": 1})
        self.assertEqual(
            [e["type"] for e in payload["events"]], ["death", "objective", "mid_boss", "objective"]
        )
        self.assertEqual([e["time_s"] for e in payload["events"]], [355, 481, 1047, 1790])

    def test_death_and_objective_payloads_are_complete(self):
        events = self.client.get("/db/matches/123/events").get_json()["events"]

        death = events[0]
        self.assertEqual(death["persona_name"], "Tester")
        self.assertEqual(death["killer_player_slot"], 9)
        self.assertEqual(death["position"], {"x": 120.5, "y": None, "z": None})

        lane_objective = events[1]
        self.assertEqual(lane_objective["objective"], "Tier 1 Walker (Lane 3)")
        self.assertEqual(lane_objective["lane"], 4)  # slot 3 is lane 4
        self.assertEqual(lane_objective["team"], 1)

        self.assertEqual(events[2]["team"], 1)  # team_claimed
        self.assertEqual(events[2]["boss_index"], 0)

        titan = events[3]
        self.assertEqual(titan["objective"], "Titan (Base Guardian)")
        self.assertIsNone(titan["lane"])  # Titan belongs to no lane
        self.assertEqual(titan["player_spirit_damage"], 2010)

    def test_match_without_timeline_rows_reports_unavailable(self):
        payload = self.client.get("/db/matches/999/events").get_json()

        self.assertFalse(payload["available"])
        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["count"], 0)


if __name__ == "__main__":
    unittest.main()
