"""Safeguards around editing ``data/brackets.json``: backups and the week check.

An event's week is denormalised onto every match row when a series is saved, so a
mistyped week silently relabels games in the stats tables. These tests cover the two
guards: every save keeps a copy of the file it replaced, and a save that would file
games under a week whose other games were played days apart asks for confirmation
first and writes nothing until it gets one.
"""

import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest import mock

from backend.app.blueprints import brackets as bkmod
from backend.app.main_web import create_app

WEEK = 59
# Games already filed under WEEK: played the nights of 5–8 October.
PEER_GAMES = [(800, "2025-10-05T19:00:00Z"), (801, "2025-10-06T19:00:00Z"), (802, "2025-10-08T19:00:00Z")]
# Week numbers used for games being filed *into* WEEK, so the test data is honest about
# what the guard judges: ids that are new, or filed under a different week today.
ELSEWHERE = 60


def _iso(days_after_peer_end):
    """A start_time ``days_after_peer_end`` days after the last peer game."""
    end = datetime.fromisoformat(PEER_GAMES[-1][1].replace("Z", "+00:00"))
    return (end + timedelta(days=days_after_peer_end)).isoformat()


def _event_data(match_id=900):
    """A one-series event holding a single game, as ``place_game`` writes it."""
    data = {"events": []}
    bkmod.place_game(
        data,
        title="Night Shift",
        week=WEEK,
        region="EU",
        set_title="Finals",
        team_a="Abrahams",
        team_b="Leviathan",
        vod="",
        game=bkmod.make_game(match_id, "team_a"),
    )
    return data


class DaySpanTests(unittest.TestCase):
    def test_same_day(self):
        self.assertEqual(bkmod._day_span(datetime(2025, 10, 12, 19), datetime(2025, 10, 12, 21)), "12 Oct")

    def test_one_month(self):
        self.assertEqual(bkmod._day_span(datetime(2025, 10, 5), datetime(2025, 10, 8)), "5–8 Oct")

    def test_across_months(self):
        self.assertEqual(bkmod._day_span(datetime(2025, 9, 29), datetime(2025, 10, 2)), "29 Sep – 2 Oct")

    def test_unknown_start(self):
        self.assertEqual(bkmod._day_span(None, None), "an unknown date")


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-bak-"))
        self.path = self.tmpdir / "brackets.json"
        self.path.write_text('{"events": []}', encoding="utf-8")

    def tearDown(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _backups(self):
        return sorted(self.path.parent.glob(f"{self.path.name}.bak-*"))

    def test_keeps_the_content_it_replaced(self):
        with mock.patch.object(bkmod.time, "time", return_value=1_700_000_000):
            backup = bkmod._backup(self.path)
        self.assertIsNotNone(backup)
        self.assertEqual(backup.read_text(encoding="utf-8"), '{"events": []}')

    def test_missing_file_is_not_an_error(self):
        self.path.unlink()
        self.assertIsNone(bkmod._backup(self.path))
        self.assertEqual(self._backups(), [])

    def test_two_saves_in_one_second_keep_the_earlier_copy(self):
        with mock.patch.object(bkmod.time, "time", return_value=1_700_000_000):
            bkmod._backup(self.path)
            self.path.write_text('{"events": [1]}', encoding="utf-8")
            bkmod._backup(self.path)
        backups = self._backups()
        self.assertEqual(len(backups), 1)
        self.assertEqual(backups[0].read_text(encoding="utf-8"), '{"events": []}')

    def test_retention_keeps_the_newest(self):
        for i in range(bkmod.BRACKETS_BACKUP_KEEP + 4):
            self.path.with_name(f"{self.path.name}.bak-2025010{i}").write_text(f"v{i}", encoding="utf-8")
        bkmod._prune_backups(self.path)
        kept = [b.read_text(encoding="utf-8") for b in self._backups()]
        self.assertEqual(len(kept), bkmod.BRACKETS_BACKUP_KEEP)
        self.assertIn("v13", kept)
        self.assertNotIn("v0", kept)


class WeekWarningTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-week-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        self.conn = sqlite3.connect(self.db_path)
        self.conn.execute("CREATE TABLE matches (match_id INTEGER PRIMARY KEY, start_time TEXT, event_week INTEGER)")
        self.conn.executemany(
            "INSERT INTO matches (match_id, start_time, event_week) VALUES (?, ?, ?)",
            [(mid, stamp, WEEK) for mid, stamp in PEER_GAMES],
        )
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _add(self, match_id, start_time, week=ELSEWHERE):
        self.conn.execute(
            "INSERT INTO matches (match_id, start_time, event_week) VALUES (?, ?, ?)", (match_id, start_time, week)
        )
        self.conn.commit()

    def _warning(self, ids=(900,), week=WEEK, exclude=()):
        return bkmod._week_warning(ids, week, self.db_path, exclude)

    def test_later_games_under_an_earlier_week_warn(self):
        self._add(900, _iso(5))
        warning = self._warning()
        self.assertIn("Week 59", warning)
        self.assertIn("3 games played 5–8 Oct", warning)
        self.assertIn("this game was played", warning)
        self.assertIn("later week", warning)

    def test_several_games_read_as_a_plural(self):
        self._add(900, _iso(5))
        self._add(901, _iso(6))
        warning = self._warning(ids=(900, 901))
        self.assertIn("these 2 games were played", warning)

    def test_a_lone_peer_game_reads_as_a_singular(self):
        self.conn.execute("DELETE FROM matches WHERE match_id IN (801, 802)")
        self._add(900, _iso(5))
        self.assertIn("already holds 1 game played 5 Oct", self._warning())

    def test_earlier_games_under_a_later_week_warn(self):
        self._add(900, (datetime.fromisoformat(PEER_GAMES[0][1].replace("Z", "+00:00")) - timedelta(days=20)).isoformat())
        self.assertIn("earlier week", self._warning())

    def test_games_on_the_same_nights_do_not_warn(self):
        self._add(900, _iso(0))
        self.assertIsNone(self._warning())

    def test_drift_inside_the_tolerance_does_not_warn(self):
        self._add(900, _iso(bkmod.WEEK_DRIFT_DAYS - 1))
        self.assertIsNone(self._warning())

    def test_drift_on_the_boundary_warns(self):
        self._add(900, _iso(bkmod.WEEK_DRIFT_DAYS))
        self.assertIsNotNone(self._warning())

    def test_event_order_does_not_matter(self):
        # The same games reached as an earlier date than the peers, not later.
        self._add(900, (datetime.fromisoformat(PEER_GAMES[0][1].replace("Z", "+00:00")) - timedelta(days=5)).isoformat())
        self.assertIsNotNone(self._warning())

    def test_week_with_no_other_games_does_not_warn(self):
        self._add(900, _iso(5))
        self.assertIsNone(self._warning(week=61))

    def test_a_new_game_is_judged_from_the_api(self):
        # A game entered for the first time has no stored date, so its night comes from
        # the API — this is the NS60-games-into-NS59 case.
        with mock.patch.object(bkmod, "_play_date", return_value=bkmod._parse_stamp(_iso(5))) as play_date:
            warning = self._warning(ids=(99999,))
        self.assertIn("later week", warning)
        play_date.assert_called_once_with(99999)

    def test_a_new_game_with_no_known_night_is_not_judged(self):
        with mock.patch.object(bkmod, "_play_date", return_value=None):
            self.assertIsNone(self._warning(ids=(99999,)))

    def test_no_api_call_when_the_week_has_no_dated_games(self):
        # Nothing to compare against: an empty week is defined by the games filed into it.
        with mock.patch.object(bkmod, "_play_date", side_effect=AssertionError("should not be called")):
            self.assertIsNone(self._warning(ids=(99999,), week=61))

    def test_no_api_call_for_a_game_already_filed_here(self):
        self._add(900, _iso(90), week=WEEK)
        with mock.patch.object(bkmod, "_play_date", side_effect=AssertionError("should not be called")):
            self.assertIsNone(self._warning())

    def test_resaving_a_series_already_on_this_week_is_not_checked(self):
        # The week-22 case in the live data: one game's start_time is months out because
        # its row was re-created later. It is already filed here, so a re-save relabels
        # nothing and must not nag.
        self._add(900, _iso(90), week=WEEK)
        self.assertIsNone(self._warning())

    def test_an_events_own_games_are_not_peers(self):
        # Re-saving a series in the event that owns the peers: excluding them leaves
        # nothing to compare against, so a re-save is never blocked by itself.
        self._add(900, _iso(5))
        self.assertIsNone(self._warning(exclude=[800, 801, 802]))

    def test_exclude_of_unrelated_ids_still_warns(self):
        self._add(900, _iso(5))
        self.assertIsNotNone(self._warning(exclude=[999]))

    def test_a_placeholder_row_cannot_mask_the_drift(self):
        # A forfeit/private game is stored as a negative placeholder id whose start_time
        # is when it was entered, not played — week 57 NA has one dated weeks after the
        # real games. It must not widen the week's window and hide a real mismatch.
        self._add(900, _iso(20))
        self._add(-791233410367, _iso(30), week=WEEK)
        self.assertIn("later week", self._warning())

    def test_missing_week_does_not_warn(self):
        self._add(900, _iso(5))
        self.assertIsNone(self._warning(week=None))
        self.assertIsNone(self._warning(week=""))

    def test_placeholder_ids_are_ignored(self):
        self.assertIsNone(self._warning(ids=[-1, -2]))

    def test_games_without_a_start_time_do_not_warn(self):
        self._add(900, None)
        self.assertIsNone(self._warning())

    def test_unparseable_start_time_does_not_warn(self):
        self._add(900, "not a date")
        self.assertIsNone(self._warning())

    def test_empty_peer_list_but_week_has_games_without_dates(self):
        self.conn.execute("DELETE FROM matches")
        self._add(900, _iso(5))
        self.conn.execute("INSERT INTO matches (match_id, start_time, event_week) VALUES (803, NULL, ?)", (WEEK,))
        self.conn.commit()
        self.assertIsNone(self._warning())


class WeekReuseNoteTests(unittest.TestCase):
    def test_mentions_events_already_on_the_week(self):
        data = {"events": [{"title": "Night Shift", "week": WEEK, "region": "EU"}]}
        note = bkmod._week_reuse_note(data, WEEK, "Night Shift")
        self.assertIn("Night Shift (EU)", note)

    def test_silent_when_the_week_is_free(self):
        data = {"events": [{"title": "Night Shift", "week": WEEK, "region": "EU"}]}
        self.assertIsNone(bkmod._week_reuse_note(data, 60, "Night Shift"))

    def test_silent_without_a_week(self):
        data = {"events": [{"title": "Night Shift", "week": WEEK, "region": "EU"}]}
        self.assertIsNone(bkmod._week_reuse_note(data, None, "Night Shift"))


class WeekGuardRouteTests(unittest.TestCase):
    """The guard has to run before anything is written, and be overridable."""

    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP", "DISCORD_OWNER_ID")
        }
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-guard-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        self.brackets_path = self.tmpdir / "brackets.json"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["DISCORD_OWNER_ID"] = "999"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        self._write(
            """
            CREATE TABLE IF NOT EXISTS user_sessions (session_token TEXT PRIMARY KEY, discord_id TEXT NOT NULL,
                username TEXT NOT NULL, avatar TEXT, created_at INTEGER NOT NULL, last_accessed_at INTEGER NOT NULL);
            INSERT INTO user_sessions VALUES ('tok', '999', 'Tester', NULL, 0, 0);
            """
        )
        self.client.set_cookie("session_token", "tok")
        self.event_id = self._write_brackets(_event_data())
        # 800-802 are the games already filed under WEEK (5-8 Oct). 900 is played five
        # days later and is filed under week 58 today, so saving it into this week-59
        # event is the mistake the guard exists for; 901 is a day off and fine. 810/811
        # give week 58 an older night of its own.
        self._write(
            "INSERT INTO matches (match_id, start_time, event_week) VALUES "
            + ", ".join(f"({mid}, '{stamp}', {WEEK})" for mid, stamp in PEER_GAMES)
            + f", (900, '{_iso(5)}', 58)"
            + f", (901, '{_iso(1)}', {ELSEWHERE})"
            + ", (810, '2025-09-20T19:00:00Z', 58), (811, '2025-09-22T19:00:00Z', 58);"
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

    def _write_brackets(self, data):
        self.brackets_path.write_text(json.dumps(data), encoding="utf-8")
        return data["events"][0]["id"]

    def _backups(self):
        return sorted(self.brackets_path.parent.glob(f"{self.brackets_path.name}.bak-*"))

    def _save_series(self, match_id=900, **extra):
        body = {"games": [{"match_id": match_id, "winner": "team_a"}], "vod": "", "outcome": None}
        body.update(extra)
        return self.client.put(
            f"/admin/brackets/api/events/{self.event_id}/series/R1M1",
            json=body,
            headers={"Accept": "application/json"},
        )

    def _edit_event(self, week, **extra):
        return self.client.put(
            f"/admin/brackets/api/events/{self.event_id}",
            json={
                "title": "Night Shift",
                "week": week,
                "region": "EU",
                "ban_pattern": "ROUND",
                "rounds": [{"round": 1, "name": "Finals", "best_of": 3}],
                "teams": {},
                **extra,
            },
            headers={"Accept": "application/json"},
        )

    def test_saving_a_series_asks_before_relabelling(self):
        before = self.brackets_path.read_text(encoding="utf-8")
        res = self._save_series()
        self.assertEqual(res.status_code, 409)
        payload = res.get_json()
        self.assertTrue(payload["needs_confirm"])
        self.assertIn("later week", payload["warning"])
        # Nothing was written, so the mistake costs nothing.
        self.assertEqual(self.brackets_path.read_text(encoding="utf-8"), before)
        self.assertEqual(self._backups(), [])

    def test_saving_a_series_goes_through_once_confirmed(self):
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._save_series(confirm_week=True)
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.get_json()["ok"])

    def test_a_matching_night_is_not_blocked(self):
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._save_series(match_id=901)
        self.assertEqual(res.status_code, 200)

    def test_a_brand_new_game_is_checked_before_it_is_ingested(self):
        # An id never seen before has no stored date, so the guard asks the API — this is
        # the NS60-games-landing-in-NS59 case, and it is refused before anything is written.
        before = self.brackets_path.read_text(encoding="utf-8")
        with mock.patch.object(bkmod, "_play_date", return_value=bkmod._parse_stamp(_iso(5))):
            res = self._save_series(match_id=123456789)
        self.assertEqual(res.status_code, 409)
        self.assertIn("later week", res.get_json()["warning"])
        self.assertEqual(self.brackets_path.read_text(encoding="utf-8"), before)
        self.assertEqual(self._backups(), [])

    def test_changing_an_event_to_a_mismatched_week_asks_first(self):
        # 900 (13 Oct) is filed on 58 but would be relabelled 60, whose games are 9 Oct.
        before = self.brackets_path.read_text(encoding="utf-8")
        res = self._edit_event(week=ELSEWHERE)
        self.assertEqual(res.status_code, 409)
        payload = res.get_json()
        self.assertTrue(payload["needs_confirm"])
        self.assertIn("later week", payload["warning"])
        self.assertEqual(self.brackets_path.read_text(encoding="utf-8"), before)

    def test_changing_an_event_goes_through_once_confirmed(self):
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._edit_event(week=ELSEWHERE, confirm_week=True)
        self.assertEqual(res.status_code, 200)

    def test_moving_an_event_onto_the_week_its_games_already_use_does_not_ask(self):
        # The repair direction: the event sits on the wrong week, its games are on 58.
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._edit_event(week=58)
        self.assertEqual(res.status_code, 200)

    def test_keeping_the_week_does_not_ask(self):
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._edit_event(week=WEEK)
        self.assertEqual(res.status_code, 200)

    def test_switching_the_week_off_does_not_ask(self):
        with mock.patch.object(bkmod, "_start_job", return_value="job-1"):
            res = self._edit_event(week=None)
        self.assertEqual(res.status_code, 200)

    def test_create_event_notes_a_week_that_already_has_an_event(self):
        res = self.client.post(
            "/admin/brackets/api/events",
            json={
                "title": "Night Shift",
                "week": WEEK,
                "region": "EU",
                "format": "gauntlet",
                "teams": [],
                "round_names": ["Challenger", "Finals"],
                "best_of": [1, 3],
                "ban_pattern": "ROUND",
            },
            headers={"Accept": "application/json"},
        )
        self.assertEqual(res.status_code, 200)
        self.assertIn("already has an event", res.get_json()["warning"])


if __name__ == "__main__":
    unittest.main()
