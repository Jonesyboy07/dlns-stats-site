import json
import os
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app
from backend.app.team_identity import (
    TeamIdentityError,
    load_identities_file,
    sync_team_identities,
)
from backend.main import db_connect

# A team that renamed mid-season: "MELEE CREEPS" played weeks 5-6, then the
# same roster played week 7 as "Nox Syndicate".
RENAME = {
    "teams": [
        {
            "name": "Nox Syndicate",
            "names": [
                {"name": "MELEE CREEPS", "valid_to_week": 6},
                {"name": "Nox Syndicate", "valid_from_week": 7},
            ],
        }
    ]
}


class TeamIdentityTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP", "TEAM_IDENTITIES_PATH")
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.identities = Path(self.tmp.name) / "team_identities.json"
        self.identities.write_text(json.dumps({"teams": []}), encoding="utf-8")
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["TEAM_IDENTITIES_PATH"] = str(self.identities)
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

    # ---- fixtures ---------------------------------------------------------

    def _insert_match(self, match_id, week, team_a, team_b, team_a_side, winning_team):
        conn = sqlite3.connect(os.environ["DB_PATH"])
        try:
            conn.execute(
                """
                INSERT INTO matches (
                    match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, event_team_a_ingame_side,
                    event_game, start_time, created_at
                ) VALUES (?, 1800, ?, 'Night Shift', ?, ?, ?, ?, 'Game 1',
                          '2026-10-21T18:00:00Z', '2026-10-21T19:00:00Z')
                """,
                (match_id, winning_team, week, team_a, team_b, team_a_side),
            )
            for account_id, side in ((match_id * 10 + 1, 0), (match_id * 10 + 2, 1)):
                conn.execute(
                    """
                    INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (match_id, account_id, side + 1, side, side + 1, "Win" if side == winning_team else "Loss"),
                )
            conn.commit()
        finally:
            conn.close()

    def _seed_league(self):
        # side 0 == team A.
        self._insert_match(1001, 5, "MELEE CREEPS", "RIVALS", 0, 0)  # Melee win
        self._insert_match(1002, 6, "RIVALS", "Melee Creeps", 1, 1)  # Rivals win
        self._insert_match(1003, 7, "Nox Syndicate", "RIVALS", 0, 0)  # Nox win

    def _apply_identities(self, payload):
        self.identities.write_text(json.dumps(payload), encoding="utf-8")
        conn = db_connect(Path(os.environ["DB_PATH"]))
        try:
            changed = sync_team_identities(conn)
        finally:
            conn.close()
        # The cache is file-backed; tests need the next read to rebuild.
        with self.app.app_context():
            from backend.app.cache import cache

            cache.clear()
        return changed

    # ---- teams index ------------------------------------------------------

    def test_teams_index_merges_every_spelling_into_one_row(self):
        self._seed_league()
        self._apply_identities(RENAME)

        teams = self.client.get("/db/teams").get_json()["teams"]
        by_slug = {team["slug"]: team for team in teams}

        self.assertIn("noxsyndicate", by_slug)
        merged = by_slug["noxsyndicate"]
        self.assertEqual(merged["team_name"], "Nox Syndicate")
        self.assertEqual(merged["matches"], 3)
        self.assertEqual(merged["wins"], 2)
        self.assertEqual(merged["losses"], 1)
        self.assertEqual(merged["latest_week"], 7)
        self.assertEqual(merged["former_names"], ["MELEE CREEPS"])
        self.assertEqual(
            [name.lower() for name in merged["names"]], ["melee creeps", "nox syndicate"]
        )
        self.assertNotIn("melee creeps", {team["team_name"].lower() for team in teams})

    def test_unrelated_names_are_never_merged(self):
        """No identity entry means two look-alike names stay two teams."""
        self._insert_match(1001, 5, "SLICE N DICE", "SLICE 'N DICE", 0, 0)

        teams = self.client.get("/db/teams").get_json()["teams"]
        names = {team["team_name"] for team in teams}

        self.assertEqual(names, {"SLICE N DICE", "SLICE 'N DICE"})
        for team in teams:
            self.assertEqual(team["former_names"], [])

    # ---- detail + weeks ---------------------------------------------------

    def test_detail_resolves_a_former_name(self):
        self._seed_league()
        self._apply_identities(RENAME)

        response = self.client.get("/db/team/MELEE%20CREEPS")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertEqual(payload["team_name"], "Nox Syndicate")
        self.assertEqual(payload["resolved_from"], "MELEE CREEPS")
        self.assertEqual(payload["former_names"], ["MELEE CREEPS"])
        self.assertEqual(payload["total_matches"], 3)
        self.assertEqual(payload["record"]["games"], {"wins": 2, "losses": 1})
        # Each match keeps the spelling it was played under.
        self.assertEqual(
            sorted(match["event_team_a"].lower() for match in payload["matches"]),
            ["melee creeps", "nox syndicate", "rivals"],
        )
        self.assertEqual(payload["name_history"][0]["valid_to_week"], 6)

    def test_detail_accepts_the_slug(self):
        self._seed_league()
        self._apply_identities(RENAME)

        payload = self.client.get("/db/team/noxsyndicate").get_json()

        self.assertEqual(payload["team_name"], "Nox Syndicate")
        self.assertEqual(payload["total_matches"], 3)

    def test_weeks_are_merged_across_the_rename(self):
        self._seed_league()
        self._apply_identities(RENAME)

        payload = self.client.get("/db/team/MELEE%20CREEPS/weeks").get_json()

        self.assertEqual(payload["team_name"], "Nox Syndicate")
        self.assertEqual(payload["resolved_from"], "MELEE CREEPS")
        self.assertEqual(payload["weeks"], [5, 6, 7])

    def test_returning_to_an_earlier_name_stays_one_team(self):
        """A -> B -> A is still one franchise; the third era is not a new team."""
        self._insert_match(3001, 5, "MELEE CREEPS", "RIVALS", 0, 0)
        self._insert_match(3002, 7, "Nox Syndicate", "RIVALS", 0, 0)
        self._insert_match(3003, 10, "MELEE CREEPS", "RIVALS", 0, 0)
        # A spelling holds one range, so the returning name stays open-ended
        # while the interim name records the weeks it was in effect.
        self._apply_identities(
            {
                "teams": [
                    {
                        "name": "MELEE CREEPS",
                        "names": [
                            {"name": "MELEE CREEPS"},
                            {"name": "Nox Syndicate", "valid_from_week": 7, "valid_to_week": 9},
                        ],
                    }
                ]
            }
        )

        teams = self.client.get("/db/teams").get_json()["teams"]
        merged = [team for team in teams if team["slug"] == "meleecreeps"][0]

        self.assertEqual(len(teams), 2)  # the merged family + RIVALS
        self.assertEqual(merged["team_name"], "MELEE CREEPS")
        self.assertEqual(merged["matches"], 3)
        self.assertEqual(merged["former_names"], ["Nox Syndicate"])

        detail = self.client.get("/db/team/Nox%20Syndicate").get_json()
        self.assertEqual(detail["team_name"], "MELEE CREEPS")
        self.assertEqual(detail["resolved_from"], "Nox Syndicate")
        self.assertEqual(detail["total_matches"], 3)

    def test_a_rename_does_not_split_a_series(self):
        # Two games in one week against the same opponent, one per spelling.
        self._insert_match(2001, 9, "MELEE CREEPS", "RIVALS", 0, 0)
        self._insert_match(2002, 9, "Nox Syndicate", "RIVALS", 0, 0)
        self._apply_identities(RENAME)

        payload = self.client.get("/db/team/Nox%20Syndicate").get_json()

        self.assertEqual(payload["record"]["games"], {"wins": 2, "losses": 0})
        self.assertEqual(payload["record"]["series"], {"wins": 1, "losses": 0})

    # ---- seeding ----------------------------------------------------------

    def test_sync_is_idempotent_and_follows_file_edits(self):
        self._seed_league()

        self.assertTrue(self._apply_identities(RENAME))
        self.assertFalse(self._apply_identities(RENAME))  # nothing left to write

        self.assertTrue(self._apply_identities({"teams": []}))
        teams = self.client.get("/db/teams").get_json()["teams"]
        by_name = {team["team_name"].lower(): team for team in teams}
        # Dropping the entry splits them back into the two names the feed used.
        self.assertEqual(by_name["melee creeps"]["matches"], 2)
        self.assertEqual(by_name["nox syndicate"]["matches"], 1)
        self.assertEqual(by_name["nox syndicate"]["former_names"], [])

    def test_sync_keeps_the_current_name_even_when_only_old_ones_are_listed(self):
        self._seed_league()
        self._apply_identities({"teams": [{"name": "Nox Syndicate", "names": ["MELEE CREEPS"]}]})

        payload = self.client.get("/db/team/Nox%20Syndicate").get_json()

        self.assertEqual(payload["total_matches"], 3)

    def test_invalid_files_are_rejected_before_anything_is_written(self):
        path = Path(self.tmp.name) / "bad.json"

        path.write_text(
            json.dumps(
                {
                    "teams": [
                        {"name": "Team One", "names": ["Shared"]},
                        {"name": "Team Two", "names": ["shared"]},
                    ]
                }
            ),
            encoding="utf-8",
        )
        with self.assertRaises(TeamIdentityError):
            load_identities_file(path)

        path.write_text(
            json.dumps(
                {"teams": [{"name": "Team One", "names": [{"name": "Old", "valid_from_week": 9, "valid_to_week": 4}]}]}
            ),
            encoding="utf-8",
        )
        with self.assertRaises(TeamIdentityError):
            load_identities_file(path)


if __name__ == "__main__":
    unittest.main()
