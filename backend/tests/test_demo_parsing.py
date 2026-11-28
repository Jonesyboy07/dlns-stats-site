"""Demo parsing: everything except boon itself, which runs in its own process.

The worker's output is a plain dict, so these tests feed fixtures through the real
store, source and ingest code without a demo file or boon installed.
"""
import bz2
import json
import os
import sqlite3
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

from backend.demo_parsing import ingest, parse, source, store, worker
from backend.main import db_connect, db_init

DEMO_BYTES = source.DEMO_MAGIC + b"\x00" * 64 + b"rest-of-demo"


def zstd_compress(data: bytes) -> bytes:
    try:
        from compression import zstd

        return zstd.compress(data)
    except ImportError:  # pragma: no cover - depends on the interpreter
        import zstandard

        return zstandard.ZstdCompressor().compress(data)


def sample_result(match_id=9001, length=4):
    """A worker result in the shape worker.parse() returns."""
    return {
        "result_version": 1,
        "parser": "boon",
        "parser_version": "0.19.0",
        "match_id": match_id,
        "demo_build": 10932,
        "tick_rate": 64,
        "duration_s": length - 0.5,
        "step_s": 1,
        "sample_count": length,
        "fields": list(worker.SERIES_FIELDS),
        "players": [
            {"account_id": 11, "hero_id": 1, "team": 0},
            {"account_id": 22, "hero_id": 2, "team": 1},
        ],
        "series": {
            "11": [[0, 400, 900, 1500], [0, 0, 1, 1], [0, 0, 0, 0], [0, 1, 1, 2], [0, 50, 120, 300], [1, 1, 2, 2]],
            "22": [[0, 300, 300, 800], [0, 0, 0, 0], [0, 0, 1, 1], [0, 0, 0, 0], [0, 10, 10, 90], [1, 1, 1, 2]],
        },
        "kills": [{"time_s": 2.4, "victim_account_id": 22, "killer_account_id": 11, "assister_account_ids": [33]}],
        "damage": [[1, 11, 22, 50], [2, 11, 22, 70], [2, 22, 11, 10]],
        "events": [
            {"kind": "breakable", "time_s": 1.2, "team": None, "account_id": None,
             "name": "citadel_breakable_prop_wooden_crate", "x": 1.0, "y": 2.0, "z": 3.0},
            {"kind": "rejuv_pickup", "time_s": 3.0, "team": 1, "account_id": None,
             "name": None, "x": None, "y": None, "z": None},
        ],
    }


class DbTestCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.tmp.name)
        self.conn = db_connect(self.root / "dlns.sqlite3")
        db_init(self.conn)

    def tearDown(self):
        self.conn.close()
        self.tmp.cleanup()

    def add_match(self, match_id, *, week=1, start_time="2026-10-21T20:00:00+00:00", with_players=True):
        self.conn.execute(
            "INSERT INTO matches (match_id, duration_s, winning_team, event_title, event_week, start_time) "
            "VALUES (?, 1800, 0, 'Night Shift', ?, ?)",
            (match_id, week, start_time),
        )
        if with_players:
            # players.account_id references users, so the user has to exist first.
            self.conn.execute("INSERT OR IGNORE INTO users (account_id, persona_name) VALUES (11, 'ABL')")
            self.conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id) VALUES (?, 11, 1, 0, 1)",
                (match_id,),
            )
        self.conn.commit()


# ---------------------------------------------------------------------------- worker


class WorkerHelperTests(unittest.TestCase):
    def test_team_mapping(self):
        self.assertEqual([worker.team_of(n) for n in (2, 3, 1, 4, None)], [0, 1, None, None, None])

    def test_account_from_steam64(self):
        self.assertEqual(worker.account_of(76561198242034120), 281768392)
        self.assertEqual(worker.account_of(281768392), 281768392)  # already 32-bit
        self.assertIsNone(worker.account_of(None))

    def test_fill_grid_keeps_the_last_value_of_each_second_and_carries_forward(self):
        samples = [(0, (100, 0)), (0, (150, 0)), (2, (400, None)), (3, (450, 1)), (9, (999, 9))]
        self.assertEqual(worker.fill_grid(samples, 5, 2), [[150, 150, 400, 450, 450], [0, 0, 0, 1, 1]])

    def test_fill_grid_starts_at_zero(self):
        self.assertEqual(worker.fill_grid([(2, (7,))], 3, 1), [[0, 0, 7]])

    def test_grid_covers_every_whole_second(self):
        self.assertEqual(worker.grid_length(1467.16), 1468)
        self.assertEqual(worker.grid_length(0.2), 1)


# ----------------------------------------------------------------------------- store


class PackTests(unittest.TestCase):
    def test_round_trip_including_drops(self):
        columns = [[0, 500, 450, 2000], [0, 0, 1, 1], [3, 2, 1, 0]]
        blob = store.pack_series(columns)
        self.assertEqual(
            store.unpack_series(blob, ["a", "b", "c"], 4),
            {"a": [0, 500, 450, 2000], "b": [0, 0, 1, 1], "c": [3, 2, 1, 0]},
        )

    def test_rejects_a_mismatched_shape(self):
        blob = store.pack_series([[1, 2, 3]])
        with self.assertRaises(ValueError):
            store.unpack_series(blob, ["a", "b"], 3)


class StoreTests(DbTestCase):
    def test_write_result_stores_every_table(self):
        self.add_match(9001)
        counts = store.write_result(self.conn, 9001, sample_result(), source="cdn")
        self.assertEqual(counts, {"series": 2, "kills": 1, "damage": 3, "events": 2})

        fields, count, blob, team = self.conn.execute(
            "SELECT fields, sample_count, data, team FROM match_player_series WHERE match_id=9001 AND account_id=11"
        ).fetchone()
        self.assertEqual(team, 0)
        self.assertEqual(store.unpack_series(blob, fields.split(","), count)["souls"], [0, 400, 900, 1500])

        assisters = self.conn.execute("SELECT assister_account_ids FROM match_kill_assists WHERE match_id=9001").fetchone()[0]
        self.assertEqual(json.loads(assisters), [33])
        status = self.conn.execute("SELECT status, source, parser_version, error FROM match_demo_parse").fetchone()
        self.assertEqual(status, ("ok", "cdn", "0.19.0", None))

    def test_a_reparse_replaces_rather_than_appends(self):
        self.add_match(9001)
        store.write_result(self.conn, 9001, sample_result(), source="cdn")
        smaller = sample_result()
        smaller["events"] = smaller["events"][:1]
        store.write_result(self.conn, 9001, smaller, source="valve")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM match_demo_events").fetchone()[0], 1)
        self.assertEqual(self.conn.execute("SELECT source FROM match_demo_parse").fetchone()[0], "valve")

    def test_a_bad_series_writes_nothing(self):
        self.add_match(9001)
        broken = sample_result()
        broken["series"]["11"] = broken["series"]["11"][:2]
        with self.assertRaises(ValueError):
            store.write_result(self.conn, 9001, broken, source="cdn")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM match_player_series").fetchone()[0], 0)

    def test_a_failed_reparse_keeps_the_good_result(self):
        self.add_match(9001)
        store.write_result(self.conn, 9001, sample_result(), source="cdn")
        store.mark_status(self.conn, 9001, "failed", error="boom")
        self.assertEqual(self.conn.execute("SELECT status, error FROM match_demo_parse").fetchone(), ("ok", "boom"))
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM match_player_series").fetchone()[0], 2)


# ---------------------------------------------------------------------------- source


class ExtractTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _zip(self, member_name, payload):
        path = self.root / "download.bin"
        with zipfile.ZipFile(path, "w") as bundle:
            bundle.writestr("readme.txt", "not a demo")
            bundle.writestr(member_name, payload)
        return path

    def test_zip_with_a_zstd_member_like_the_replay_share(self):
        archive = self._zip("123.dem", zstd_compress(DEMO_BYTES))
        out = source.extract_demo(archive, self.root / "work", 123)
        self.assertEqual(out.read_bytes(), DEMO_BYTES)
        self.assertEqual(out.name, "123.dem")

    def test_valve_bz2(self):
        archive = self.root / "download.bin"
        archive.write_bytes(bz2.compress(DEMO_BYTES))
        self.assertEqual(source.extract_demo(archive, self.root / "work", 5).read_bytes(), DEMO_BYTES)

    def test_bare_demo_and_bz2_member(self):
        archive = self._zip("5.dem.bz2", bz2.compress(DEMO_BYTES))
        self.assertEqual(source.extract_demo(archive, self.root / "a", 5).read_bytes(), DEMO_BYTES)
        bare = self.root / "bare.bin"
        bare.write_bytes(DEMO_BYTES)
        self.assertEqual(source.extract_demo(bare, self.root / "b", 5).read_bytes(), DEMO_BYTES)

    def test_a_member_path_cannot_escape_the_work_dir(self):
        archive = self._zip("../../evil/7.dem", DEMO_BYTES)
        out = source.extract_demo(archive, self.root / "work", 7)
        self.assertEqual(out.parent, self.root / "work")
        self.assertFalse((self.root / "evil").exists())

    def test_rejects_what_is_not_a_demo(self):
        junk = self.root / "junk.bin"
        junk.write_bytes(b"<html>not found</html>")
        with self.assertRaises(source.DemoFormatError):
            source.extract_demo(junk, self.root / "work", 1)
        with self.assertRaises(source.DemoFormatError):
            source.extract_demo(self._zip("notes.txt", b"hi"), self.root / "work2", 1)
        # Compressed, but what comes out is not a demo either.
        fake = self.root / "fake.bin"
        fake.write_bytes(bz2.compress(b"definitely not a demo"))
        with self.assertRaises(source.DemoFormatError):
            source.extract_demo(fake, self.root / "work3", 1)


class FindDemoTests(unittest.TestCase):
    index = {"42": {"name": "42_9.zip", "path": "/night-shift/week 61/42 - a vs b/42_9.zip"}}

    def test_prefers_the_replay_share_with_the_sites_url(self):
        location = source.find_demo(42, replay_index=self.index, download_base_url="https://cdn.example/dl/x/")
        self.assertEqual(location, source.DemoLocation(
            "cdn", "https://cdn.example/dl/x/night-shift/week%2061/42%20-%20a%20vs%20b/42_9.zip"))

    def test_falls_back_to_valve_only_when_asked(self):
        lookup = mock.Mock(return_value="http://replay1.valve.net/1422450/7_1.dem.bz2")
        with self.assertRaises(source.DemoNotFound):
            source.find_demo(7, replay_index=self.index, download_base_url="https://cdn", salts_lookup=lookup)
        lookup.assert_not_called()
        location = source.find_demo(7, replay_index=self.index, download_base_url="https://cdn",
                                    try_valve=True, salts_lookup=lookup)
        self.assertEqual(location.source, "valve")

    def test_no_share_url_means_no_share(self):
        with self.assertRaises(source.DemoNotFound):
            source.find_demo(42, replay_index=self.index, download_base_url=None)


# ----------------------------------------------------------------------------- parse


class RunWorkerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def _fake_worker(self, body):
        script = self.root / "fake_worker.py"
        script.write_text("import json, sys\n" + body, encoding="utf-8")
        return mock.patch.object(parse, "WORKER", script)

    def test_reads_the_workers_json(self):
        with self._fake_worker("json.dump({'series': {}, 'ok': 1}, open(sys.argv[2], 'w'))\n"):
            result = parse.run_worker(self.root / "x.dem", self.root / "out.json", python=sys.executable)
        self.assertEqual(result["ok"], 1)

    def test_reports_a_crash_with_its_stderr(self):
        with self._fake_worker("sys.stderr.write('InvalidDemoError: bad magic'); sys.exit(3)\n"):
            with self.assertRaises(parse.DemoParseError) as caught:
                parse.run_worker(self.root / "x.dem", self.root / "out.json", python=sys.executable)
        self.assertIn("bad magic", str(caught.exception))

    def test_times_out(self):
        with self._fake_worker("import time; time.sleep(30)\n"):
            with self.assertRaises(parse.DemoParseError) as caught:
                parse.run_worker(self.root / "x.dem", self.root / "out.json", python=sys.executable, timeout_s=1)
        self.assertIn("timed out", str(caught.exception))


# ---------------------------------------------------------------------------- ingest


class SelectMatchesTests(DbTestCase):
    def test_skips_placeholders_and_finished_work(self):
        for match_id in (1, 2, 3, 4):
            self.add_match(match_id)
        self.add_match(5, with_players=False)  # placeholder
        store.write_result(self.conn, 1, sample_result(1), source="cdn")
        store.mark_status(self.conn, 2, "failed", error="x")
        store.mark_status(self.conn, 3, "no_demo")
        # no_demo is re-checked (a replay may have been uploaded since); failed is not.
        self.assertEqual(sorted(ingest.select_matches(self.conn)), [3, 4])
        self.assertEqual(sorted(ingest.select_matches(self.conn, reparse=True)), [1, 2, 3, 4])

    def test_a_new_parser_version_reruns_old_results(self):
        self.add_match(1)
        store.write_result(self.conn, 1, sample_result(1), source="cdn")
        self.assertEqual(ingest.select_matches(self.conn, parser_version="0.19.0"), [])
        self.assertEqual(ingest.select_matches(self.conn, parser_version="0.20.0"), [1])

    def test_week_and_single_match_filters(self):
        self.add_match(1, week=3)
        self.add_match(2, week=8)
        self.assertEqual(ingest.select_matches(self.conn, since_week=5), [2])
        self.assertEqual(ingest.select_matches(self.conn, only_match_id=77), [77])

    def test_only_recent_matches_ask_valve(self):
        self.assertFalse(ingest._is_recent("2020-01-01T00:00:00+00:00", 30))
        self.assertFalse(ingest._is_recent(None, 30))


class ParseMatchTests(DbTestCase):
    def _run(self, **patches):
        defaults = {
            "replay_index": {"9001": {"path": "/x/9001_1.zip"}},
            "download_base_url": "https://cdn.example/dl",
            "work_root": self.root,
            "try_valve": False,
            "timeout_s": 5,
            "python": None,
            "log": lambda _msg: None,
        }
        defaults.update(patches)
        return ingest.parse_match(self.conn, 9001, **defaults)

    def _fake_download(self, url, dest, **_):
        Path(dest).write_bytes(zstd_compress(DEMO_BYTES))
        return Path(dest)

    def test_end_to_end_with_a_faked_download_and_worker(self):
        self.add_match(9001)
        with mock.patch.object(source, "download", side_effect=self._fake_download), \
             mock.patch.object(parse, "run_worker", return_value=sample_result()) as worker_call:
            self.assertEqual(self._run(), "ok")
        demo_path = worker_call.call_args.args[0]
        self.assertEqual(Path(demo_path).name, "9001.dem")
        self.assertFalse(Path(demo_path).exists())  # temp files cleaned up
        self.assertEqual(self.conn.execute("SELECT status FROM match_demo_parse").fetchone()[0], "ok")

    def test_no_demo_anywhere(self):
        self.add_match(9001)
        self.assertEqual(self._run(replay_index={}), "no_demo")
        self.assertEqual(self.conn.execute("SELECT status FROM match_demo_parse").fetchone()[0], "no_demo")

    def test_a_deleted_valve_demo_is_no_demo(self):
        self.add_match(9001)
        with mock.patch.object(source, "download", side_effect=source.DemoNotFound("404")):
            self.assertEqual(self._run(), "no_demo")

    def test_a_parser_failure_is_recorded(self):
        self.add_match(9001)
        with mock.patch.object(source, "download", side_effect=self._fake_download), \
             mock.patch.object(parse, "run_worker", side_effect=parse.DemoParseError("parser exited with 1: boom")):
            self.assertEqual(self._run(), "failed")
        status, error = self.conn.execute("SELECT status, error FROM match_demo_parse").fetchone()
        self.assertEqual(status, "failed")
        self.assertIn("boom", error)

    def test_refuses_a_demo_for_another_match(self):
        self.add_match(9001)
        with mock.patch.object(source, "download", side_effect=self._fake_download), \
             mock.patch.object(parse, "run_worker", return_value=sample_result(match_id=5555)):
            self.assertEqual(self._run(), "failed")
        self.assertEqual(self.conn.execute("SELECT COUNT(*) FROM match_player_series").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
