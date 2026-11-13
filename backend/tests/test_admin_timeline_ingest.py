"""Panel submissions write the same per-match rows as a feed ingest.

A bracket save goes through `admin._run_bulk_submit_job`, which is also MatchAdmin's
bulk submit. Those games used to land with matches and players only, so the timeline,
map replay and damage pages had nothing to draw for them.
"""
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.app.main_web import create_app
from backend.main import (
    backfill_all_match_timeline,
    backfill_all_player_paths,
    db_connect,
    db_init,
    ingest_match_extras,
)

MATCH_ID = 555001
_PLAYER_SLOT = 1
_ACCOUNT_ID = 4242

# Everything ingest_match_extras reads: objectives, mid boss, death details, the
# damage matrix and one player's position trail.
MATCH_INFO = {
    "match_id": MATCH_ID,
    "duration_s": 1900,
    "winning_team": 0,
    "start_time": 1760000000,
    "match_outcome": 1,
    "game_mode": 1,
    "match_mode": 1,
    "objectives": [
        {"team": 0, "team_objective_id": 9, "destroyed_time_s": 1790, "first_damage_time_s": 1781,
         "player_damage": 10183, "creep_damage": 0, "player_spirit_damage": 2010},
    ],
    "mid_boss": [
        {"team_killed": 0, "team_claimed": 1, "destroyed_time_s": 1047},
    ],
    "match_paths": {
        "interval_s": 1.0,
        "paths": [{
            "player_slot": _PLAYER_SLOT,
            "x_pos": [0, 16383],
            "y_pos": [0, 16383],
            "x_min": -1000.0,
            "x_max": 1000.0,
            "y_min": -500.0,
            "y_max": 500.0,
        }],
    },
    "damage_matrix": {
        "source_details": {"stat_type": [0], "source_name": ["Bullet"]},
        "damage_dealers": [{
            "dealer_player_slot": _PLAYER_SLOT,
            "damage_sources": [{
                "source_details_index": 0,
                "damage_to_players": [{"target_player_slot": 2, "damage": [100, 200]}],
            }],
        }],
    },
    "players": [{
        "account_id": _ACCOUNT_ID,
        "player_slot": _PLAYER_SLOT,
        "assigned_lane": 1,
        "hero_id": 11,
        "level": 30,
        "stats": [
            {"time_stamp_s": 180, "deaths": 0, "kills": 1, "assists": 0, "net_worth": 1200},
            {"time_stamp_s": 360, "deaths": 1, "kills": 2, "assists": 1, "net_worth": 3400},
        ],
        "death_details": [
            {"game_time_s": 355, "killer_player_slot": 9, "time_to_kill_s": 4.5,
             "death_duration_s": 14, "death_pos": {"x": 3, "y": 4, "z": 0},
             "killer_pos": {"x": 30, "y": 40, "z": 0}},
        ],
    }],
}

DERIVED_TABLES = (
    "match_objectives",
    "match_mid_boss",
    "player_deaths",
    "player_damage_sources",
    "match_player_paths",
)


def _counts(conn: sqlite3.Connection, match_id: int) -> dict:
    return {
        table: conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE match_id = ?", (match_id,)
        ).fetchone()[0]
        for table in DERIVED_TABLES
    }


class IngestMatchExtrasTests(unittest.TestCase):
    def setUp(self):
        # mkdtemp + ignore_errors: Windows keeps the SQLite handle on the temp file
        # briefly past the test, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-extras-"))
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.conn = db_connect(self.tmpdir / "dlns.sqlite3")
        db_init(self.conn)
        self.conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (?, ?)", (MATCH_ID, 1900))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def test_writes_every_derived_row(self):
        ingest_match_extras(self.conn, MATCH_ID, MATCH_INFO)
        self.conn.commit()
        self.assertEqual(
            _counts(self.conn, MATCH_ID),
            {
                "match_objectives": 1,
                "match_mid_boss": 1,
                "player_deaths": 1,
                "player_damage_sources": 1,
                "match_player_paths": 1,
            },
        )

    def test_re_running_replaces_rather_than_duplicates(self):
        ingest_match_extras(self.conn, MATCH_ID, MATCH_INFO)
        self.conn.commit()
        first = _counts(self.conn, MATCH_ID)
        ingest_match_extras(self.conn, MATCH_ID, MATCH_INFO)
        self.conn.commit()
        self.assertEqual(_counts(self.conn, MATCH_ID), first)


class BackfillSweepTests(unittest.TestCase):
    """The -sinceweek filter keeps a repair from walking the whole history."""

    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-sinceweek-"))
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.conn = db_connect(self.tmpdir / "dlns.sqlite3")
        db_init(self.conn)
        self.match_id_by_week = {58: 5801, 60: 6001, 61: 6101}
        for week, match_id in self.match_id_by_week.items():
            account_id = _ACCOUNT_ID + week
            self.conn.execute(
                "INSERT INTO matches (match_id, duration_s, event_title, event_week) VALUES (?, ?, ?, ?)",
                (match_id, 1900, "Night Shift", week),
            )
            self.conn.execute("INSERT INTO users (account_id) VALUES (?)", (account_id,))
            self.conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot) VALUES (?, ?, ?)",
                (match_id, account_id, 1),
            )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()

    def _sweep(self, function, since_week):
        fetched = []

        def fake_fetch(match_id):
            fetched.append(match_id)
            return dict(MATCH_INFO, match_id=match_id)

        with mock.patch("backend.main.fetch_match_metadata", side_effect=fake_fetch):
            function(self.conn, since_week=since_week)
        return sorted(fetched)

    def test_timeline_backfill_stops_at_the_given_week(self):
        self.assertEqual(
            self._sweep(backfill_all_match_timeline, 60),
            [self.match_id_by_week[60], self.match_id_by_week[61]],
        )
        self.assertEqual(_counts(self.conn, self.match_id_by_week[58])["match_objectives"], 0)
        self.assertEqual(_counts(self.conn, self.match_id_by_week[61])["match_objectives"], 1)

    def test_paths_backfill_stops_at_the_given_week(self):
        self.assertEqual(
            self._sweep(backfill_all_player_paths, 61),
            [self.match_id_by_week[61]],
        )
        self.assertEqual(_counts(self.conn, self.match_id_by_week[61])["match_player_paths"], 1)
        self.assertEqual(_counts(self.conn, self.match_id_by_week[60])["match_player_paths"], 0)

    def test_a_single_match_can_be_named(self):
        with mock.patch("backend.main.fetch_match_metadata", return_value=MATCH_INFO):
            backfill_all_match_timeline(self.conn, only_match_id=self.match_id_by_week[58])
        self.assertEqual(_counts(self.conn, self.match_id_by_week[58])["match_objectives"], 1)
        self.assertEqual(_counts(self.conn, self.match_id_by_week[60])["match_objectives"], 0)


class BulkSubmitTimelineTests(unittest.TestCase):
    """A panel submission must leave the same rows a feed ingest would."""

    def setUp(self):
        self._old_env = {
            key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")
        }
        self.addCleanup(self._restore_env)
        # mkdtemp + ignore_errors: Windows keeps the SQLite handle open past the job.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-admin-timeline-"))
        self.addCleanup(shutil.rmtree, self.tmpdir, True)
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True

    def _restore_env(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value

    def _payload(self):
        return {
            "title": "Night Shift",
            "week": 61,
            "vod_links": [],
            "bracket_saved": True,
            "sets": [{
                "team_a": "Abrahams",
                "team_b": "Leviathan",
                "region": "EU",
                "set_title": "Finals",
                "matches": [{"match_id": MATCH_ID, "winner": "team_a", "game": "Game 1"}],
            }],
        }

    def test_job_writes_the_timeline_rows(self):
        from backend.app.blueprints import admin as admin_mod

        with mock.patch.object(admin_mod, "fetch_match_metadata", return_value=MATCH_INFO), \
                mock.patch.object(admin_mod, "resolve_names_with_cache", return_value={}):
            admin_mod._run_bulk_submit_job("job-1", self._payload(), self.app)

        job = admin_mod._jobs["job-1"]
        self.assertEqual(job["status"], "done", job.get("message"))
        self.assertIn("Ingested 1 match", job["message"])
        self.assertNotIn("Timeline data failed", job["message"])

        conn = sqlite3.connect(self.db_path)
        try:
            counts = _counts(conn, MATCH_ID)
        finally:
            conn.close()
        for table, count in counts.items():
            self.assertEqual(count, 1, f"{table} was not written by the submission")

    def test_a_timeline_failure_is_reported_but_keeps_the_submission(self):
        from backend.app.blueprints import admin as admin_mod

        with mock.patch.object(admin_mod, "fetch_match_metadata", return_value=MATCH_INFO), \
                mock.patch.object(admin_mod, "resolve_names_with_cache", return_value={}), \
                mock.patch.object(admin_mod, "ingest_match_extras", side_effect=RuntimeError("boom")):
            admin_mod._run_bulk_submit_job("job-2", self._payload(), self.app)

        job = admin_mod._jobs["job-2"]
        self.assertEqual(job["status"], "done", job.get("message"))
        self.assertIn(f"Timeline data failed for 1 match(es): {MATCH_ID}", job["message"])

        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute("SELECT 1 FROM matches WHERE match_id = ?", (MATCH_ID,)).fetchone()
        finally:
            conn.close()
        self.assertIsNotNone(row, "the match row should still be saved")


if __name__ == "__main__":
    unittest.main()
