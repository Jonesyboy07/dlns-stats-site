import struct
import tempfile
import unittest
import zlib
from pathlib import Path

from backend.main import (
    _path_byte_series,
    _path_rows_from_match,
    _path_world_samples,
    db_connect,
    db_init,
    ingest_player_paths,
)

RESOLUTION = 16383.0


def make_path(**overrides):
    """A trail spanning the whole grid across a 2000 x 1000 world box."""
    path = {
        "player_slot": 1,
        "x_pos": [0, RESOLUTION],
        "y_pos": [0, RESOLUTION],
        "x_min": -1000.0,
        "x_max": 1000.0,
        "y_min": -500.0,
        "y_max": 500.0,
    }
    path.update(overrides)
    return path


class PathWorldSamplesTests(unittest.TestCase):
    def test_bounds_map_the_grid_onto_world_coordinates(self):
        # grid 0 -> x_min, grid resolution -> x_max, on both axes
        self.assertEqual(
            _path_world_samples(make_path(), RESOLUTION, RESOLUTION),
            [-1000, -500, 1000, 500],
        )

    def test_midpoint_of_the_grid_is_the_midpoint_of_the_box(self):
        path = make_path(x_pos=[RESOLUTION / 2], y_pos=[RESOLUTION / 2])
        coords = _path_world_samples(path, RESOLUTION, RESOLUTION)
        self.assertEqual(coords, [0, 0])

    def test_each_axis_uses_its_own_resolution(self):
        path = make_path()
        baseline = _path_world_samples(path, RESOLUTION, RESOLUTION)
        halved_y = _path_world_samples(path, RESOLUTION, RESOLUTION / 2)
        self.assertEqual(halved_y[0::2], baseline[0::2])  # x is untouched by the y resolution
        self.assertNotEqual(halved_y[1::2], baseline[1::2])

    def test_a_gap_holds_the_last_position_so_indices_keep_their_second(self):
        path = make_path(x_pos=[0, RESOLUTION, None, RESOLUTION], y_pos=[0, 0, 0, 0])
        coords = _path_world_samples(path, RESOLUTION, RESOLUTION)
        self.assertEqual(len(coords), 8)
        # the gap at index 2 repeats index 1 rather than shifting every later sample forward
        self.assertEqual(coords[4:6], coords[2:4])
        self.assertEqual(coords[6:8], [1000, -500])

    def test_missing_or_degenerate_bounds_yield_nothing(self):
        self.assertEqual(_path_world_samples({}, RESOLUTION, RESOLUTION), [])
        self.assertEqual(_path_world_samples(make_path(x_min=None), RESOLUTION, RESOLUTION), [])
        self.assertEqual(_path_world_samples(make_path(x_min=5.0, x_max=5.0), RESOLUTION, RESOLUTION), [])
        self.assertEqual(_path_world_samples(make_path(x_pos=[]), RESOLUTION, RESOLUTION), [])


class PathByteSeriesTests(unittest.TestCase):
    def test_series_is_clamped_and_padded_to_the_sample_count(self):
        self.assertEqual(_path_byte_series([100, 250, 999, -4], 6), bytes([100, 250, 255, 0, 0, 0]))

    def test_missing_values_hold_the_previous_reading(self):
        self.assertEqual(_path_byte_series([80, None, 40], 3), bytes([80, 80, 40]))

    def test_non_list_input_is_all_zeroes(self):
        self.assertEqual(_path_byte_series(None, 2), bytes([0, 0]))


class PathRowsFromMatchTests(unittest.TestCase):
    def test_one_row_per_player_with_extents_and_decodable_coordinates(self):
        match_info = {
            "match_paths": {"interval_s": 1.0, "x_resolution": RESOLUTION, "y_resolution": RESOLUTION,
                            "paths": [make_path(player_slot=7)]},
            "players": [{"player_slot": 7, "account_id": 244109796}],
        }
        rows = _path_rows_from_match(123, match_info)

        self.assertEqual(len(rows), 1)
        (match_id, slot, account_id, interval_s, count,
         min_x, max_x, min_y, max_y, positions, _health, _move, _combat) = rows[0]
        self.assertEqual(match_id, 123)
        self.assertEqual(slot, 7)
        self.assertEqual(account_id, 244109796)
        self.assertEqual(interval_s, 1.0)
        self.assertEqual(count, 2)
        self.assertEqual((min_x, max_x, min_y, max_y), (-1000, 1000, -500, 500))

        decoded = struct.unpack(f"<{count * 2}h", zlib.decompress(positions))
        self.assertEqual(list(decoded), [-1000, -500, 1000, 500])

    def test_optional_series_are_stored_when_present_and_null_when_absent(self):
        base = {
            "match_paths": {"x_resolution": RESOLUTION, "y_resolution": RESOLUTION},
            "players": [{"player_slot": 1, "account_id": 42}],
        }
        without = dict(base, match_paths=dict(base["match_paths"], paths=[make_path()]))
        rows = _path_rows_from_match(123, without)
        self.assertIsNone(rows[0][10])
        self.assertIsNone(rows[0][11])
        self.assertIsNone(rows[0][12])

        with_health = dict(base, match_paths=dict(
            base["match_paths"], paths=[make_path(health=[100, 60], move_type=[6, 7], combat_type=[0, 2])]))
        rows = _path_rows_from_match(123, with_health)
        self.assertEqual(zlib.decompress(rows[0][10]), bytes([100, 60]))
        self.assertEqual(zlib.decompress(rows[0][11]), bytes([6, 7]))
        self.assertEqual(zlib.decompress(rows[0][12]), bytes([0, 2]))

    def test_falls_back_to_the_known_resolution_when_the_payload_omits_it(self):
        match_info = {
            "match_paths": {"paths": [make_path()]},
            "players": [{"player_slot": 1, "account_id": 42}],
        }
        self.assertEqual(len(_path_rows_from_match(123, match_info)), 1)

    def test_malformed_payloads_are_ignored(self):
        self.assertEqual(_path_rows_from_match(123, {}), [])
        self.assertEqual(_path_rows_from_match(123, {"match_paths": None}), [])
        self.assertEqual(_path_rows_from_match(123, {"match_paths": {"paths": "nope"}}), [])
        self.assertEqual(_path_rows_from_match(123, {"match_paths": {"paths": ["nope"]}}), [])
        # a path with no player slot cannot be attributed to a player
        self.assertEqual(len(_path_rows_from_match(123, {"match_paths": {"paths": [make_path(player_slot=None)]}})), 0)

    def test_a_path_without_a_matching_player_keeps_a_null_account(self):
        match_info = {"match_paths": {"paths": [make_path(player_slot=9)]}, "players": []}
        rows = _path_rows_from_match(123, match_info)
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0][2])


class PathIngestTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "dlns.sqlite3"
        self.conn = db_connect(self.db_path)
        db_init(self.conn)
        self.conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (?, ?)", (123, 1903))
        self.conn.commit()
        self.match_info = {
            "match_paths": {"interval_s": 1.0, "x_resolution": RESOLUTION, "y_resolution": RESOLUTION,
                            "paths": [make_path(player_slot=1), make_path(player_slot=7)]},
            "players": [{"player_slot": 1, "account_id": 42}, {"player_slot": 7, "account_id": 43}],
        }

    def tearDown(self):
        self.conn.close()
        self.tmpdir.cleanup()

    def test_trails_are_stored_per_player(self):
        ingest_player_paths(self.conn, 123, self.match_info)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT player_slot, account_id, sample_count, world_min_x, world_max_y "
            "FROM match_player_paths WHERE match_id = 123 ORDER BY player_slot"
        ).fetchall()
        self.assertEqual(rows, [(1, 42, 2, -1000, 500), (7, 43, 2, -1000, 500)])

    def test_reingest_replaces_rather_than_duplicates(self):
        ingest_player_paths(self.conn, 123, self.match_info)
        self.conn.commit()
        ingest_player_paths(self.conn, 123, self.match_info)
        self.conn.commit()

        count = self.conn.execute(
            "SELECT COUNT(*) FROM match_player_paths WHERE match_id = 123"
        ).fetchone()[0]
        self.assertEqual(count, 2)

    def test_a_match_without_paths_stores_nothing(self):
        ingest_player_paths(self.conn, 123, {"players": []})
        self.conn.commit()
        count = self.conn.execute(
            "SELECT COUNT(*) FROM match_player_paths WHERE match_id = 123"
        ).fetchone()[0]
        self.assertEqual(count, 0)


if __name__ == "__main__":
    unittest.main()
