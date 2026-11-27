"""Team week timelines never merge week numbers from different events.

Week numbers restart in every event, so Fight Night week 5 is not Night Shift
week 5. Both team endpoints used to collect `event_week` across events, which
plotted a Fight Night appearance as a Night Shift week on the roster timeline
and the player page's Team Tenure.
"""
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app

TEAM = "Leviathan"


class TeamEventWeeksTests(unittest.TestCase):
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

    def _insert_match(self, match_id, title, week, team_a, team_b, account_ids):
        """`account_ids` play for team A (side 0); one opponent plays side 1."""
        conn = sqlite3.connect(os.environ["DB_PATH"])
        try:
            conn.execute(
                """
                INSERT INTO matches (
                    match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, event_team_a_ingame_side,
                    event_game, start_time, created_at
                ) VALUES (?, 1800, 0, ?, ?, ?, ?, 0, 'Game 1', ?, ?)
                """,
                (match_id, title, week, team_a, team_b,
                 f"2026-10-{match_id % 28 + 1:02d}T18:00:00Z", "2026-10-21T19:00:00Z"),
            )
            rows = [(account_id, 0) for account_id in account_ids] + [(match_id * 100, 1)]
            for slot, (account_id, side) in enumerate(rows, start=1):
                conn.execute(
                    """
                    INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result)
                    VALUES (?, ?, ?, ?, 1, ?)
                    """,
                    (match_id, account_id, slot, side, "Win" if side == 0 else "Loss"),
                )
            conn.commit()
        finally:
            conn.close()

    def _seed(self):
        # Night Shift weeks 4-6; week 5 is a league-wide bye for this team only.
        self._insert_match(1, "Night Shift", 4, TEAM, "Rivals", [11, 12])
        self._insert_match(2, "Night Shift", 6, TEAM, "Rivals", [11])
        self._insert_match(3, "Night Shift", 5, "Other", "Rivals", [21])
        # Fight Night week 5: same number, different event. Player 13 is a sub.
        self._insert_match(4, "Fight Night", 5, TEAM, "Brawlers", [11, 13])

    def test_detail_keeps_a_timeline_per_event(self):
        self._seed()

        payload = self.client.get(f"/db/team/{TEAM}").get_json()
        timelines = {t["event_title"]: t for t in payload["roster_timelines"]}

        self.assertEqual([t["event_title"] for t in payload["roster_timelines"]], ["Night Shift", "Fight Night"])
        self.assertEqual(timelines["Night Shift"]["weeks"], [4, 5, 6])
        self.assertEqual(timelines["Fight Night"]["weeks"], [5])

        ns_rows = {row["account_id"]: row for row in timelines["Night Shift"]["players"]}
        # Player 11's Fight Night week 5 does not fill Night Shift week 5.
        self.assertEqual(ns_rows[11]["weeks"], [4, 6])
        self.assertEqual(ns_rows[11]["appearances"], 2)
        self.assertNotIn(13, ns_rows)

        fn_rows = {row["account_id"]: row for row in timelines["Fight Night"]["players"]}
        self.assertEqual(sorted(fn_rows), [11, 13])
        self.assertEqual(fn_rows[13]["weeks"], [5])

    def test_page_level_weeks_follow_the_main_league(self):
        self._seed()

        payload = self.client.get(f"/db/team/{TEAM}").get_json()
        players = {player["account_id"]: player for player in payload["players"]}

        self.assertEqual(payload["max_week"], 6)
        self.assertEqual(payload["roster_weeks"], [4, 5, 6])
        self.assertEqual(players[11]["weeks"], [4, 6])
        self.assertEqual((players[11]["first_week"], players[11]["last_week"]), (4, 6))
        # A Fight Night-only sub is not on the Night Shift timeline or active roster.
        self.assertEqual(players[13]["weeks"], [])
        self.assertIsNone(players[13]["last_week"])

    def test_a_team_outside_the_main_league_uses_its_own_event(self):
        self._insert_match(5, "Fight Night", 2, "Brawlers", "Rivals", [31])
        self._insert_match(6, "Fight Night", 3, "Brawlers", "Rivals", [31])

        payload = self.client.get("/db/team/Brawlers").get_json()

        self.assertEqual([t["event_title"] for t in payload["roster_timelines"]], ["Fight Night"])
        self.assertEqual(payload["roster_weeks"], [2, 3])
        self.assertEqual(payload["max_week"], 3)

    def test_weeks_endpoint_splits_events(self):
        self._seed()

        payload = self.client.get(f"/db/team/{TEAM}/weeks").get_json()
        events = {entry["event_title"]: entry for entry in payload["events"]}

        self.assertEqual([entry["event_title"] for entry in payload["events"]], ["Night Shift", "Fight Night"])
        self.assertEqual(events["Night Shift"]["weeks"], [4, 6])
        self.assertEqual(events["Night Shift"]["league_weeks"], [4, 5, 6])
        self.assertEqual(events["Fight Night"]["weeks"], [5])
        self.assertEqual(events["Fight Night"]["league_weeks"], [5])
        # Legacy fields describe the main league only.
        self.assertEqual(payload["weeks"], [4, 6])
        self.assertEqual(payload["league_weeks"], [4, 5, 6])


if __name__ == "__main__":
    unittest.main()
