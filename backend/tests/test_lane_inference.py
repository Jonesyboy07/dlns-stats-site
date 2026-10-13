import unittest

from backend.main import (
    LANE_BY_XPOS,
    LANE_INFER_END_S,
    LANE_INFER_START_S,
    infer_lanes_from_paths,
)

RESOLUTION = 16383.0
# Enough samples that the laning window (LANE_INFER_START_S..END_S) is fully present.
SAMPLES = LANE_INFER_END_S + 20

# The three corridors, left to right, as world X. LANE_BY_XPOS labels them 1/4/6.
LEFT_X, MID_X, RIGHT_X = -8000.0, 0.0, 8000.0


def make_path(player_slot, world_x, world_span=2000.0, samples=SAMPLES, grid_x=None):
    """A flat trail sitting at `world_x`.

    `x_pos` is normalised into this player's own `x_min`/`x_max` box (as the real API
    does), so the default grid value of half the resolution maps to the box centre.
    """
    x_min = world_x - world_span / 2
    x_max = world_x + world_span / 2
    if grid_x is None:
        grid_x = RESOLUTION / 2
    return {
        "player_slot": player_slot,
        "x_pos": [grid_x] * samples,
        "y_pos": [RESOLUTION / 2] * samples,
        "x_min": x_min,
        "x_max": x_max,
        "y_min": -1000.0,
        "y_max": 1000.0,
    }


def make_match(world_by_slot, paths=None):
    players = [{"player_slot": slot, "account_id": 1000 + slot} for slot in range(1, 13)]
    return {
        "players": players,
        "match_paths": {
            "interval_s": 1.0,
            "x_resolution": RESOLUTION,
            "y_resolution": RESOLUTION,
            "paths": paths if paths is not None else [
                make_path(slot, world_by_slot[slot]) for slot in range(1, 13)
            ],
        },
    }


class InferLanesFromPathsTests(unittest.TestCase):
    def test_labels_a_standard_three_lane_comp(self):
        # Each team runs two players per corridor, mirrored across the map.
        world = {
            1: LEFT_X, 2: LEFT_X, 3: MID_X, 4: MID_X, 5: RIGHT_X, 6: RIGHT_X,
            7: LEFT_X, 8: LEFT_X, 9: MID_X, 10: MID_X, 11: RIGHT_X, 12: RIGHT_X,
        }
        left, mid, right = LANE_BY_XPOS
        self.assertEqual(
            infer_lanes_from_paths(make_match(world)),
            {
                1: left, 2: left, 3: mid, 4: mid, 5: right, 6: right,
                7: left, 8: left, 9: mid, 10: mid, 11: right, 12: right,
            },
        )

    def test_orders_by_world_x_not_raw_grid_values(self):
        # Every player's raw grid value is identical, so the old raw-`x_pos` method
        # could only fall back to slot order and would label 1-2 left / 5-6 right.
        # The real positions are the opposite way round, so only a world-coordinate
        # read gets this right.
        world = {
            1: RIGHT_X, 2: RIGHT_X, 3: MID_X, 4: MID_X, 5: LEFT_X, 6: LEFT_X,
            7: RIGHT_X, 8: RIGHT_X, 9: MID_X, 10: MID_X, 11: LEFT_X, 12: LEFT_X,
        }
        left, mid, right = LANE_BY_XPOS
        self.assertEqual(
            infer_lanes_from_paths(make_match(world)),
            {
                1: right, 2: right, 3: mid, 4: mid, 5: left, 6: left,
                7: right, 8: right, 9: mid, 10: mid, 11: left, 12: left,
            },
        )

    def test_survives_players_with_very_different_bounding_boxes(self):
        # A roamer's box spans the map; a lane-bound player's box is tiny. Both must
        # still land in the corridor where they actually spent the laning window.
        world = {
            1: LEFT_X, 2: LEFT_X, 3: MID_X, 4: MID_X, 5: RIGHT_X, 6: RIGHT_X,
            7: LEFT_X, 8: LEFT_X, 9: MID_X, 10: MID_X, 11: RIGHT_X, 12: RIGHT_X,
        }
        paths = [make_path(slot, world[slot]) for slot in range(1, 13)]
        paths[0]["x_min"], paths[0]["x_max"] = -11000.0, 11000.0  # slot 1 roams
        paths[4]["x_min"], paths[4]["x_max"] = 7900.0, 8100.0    # slot 5 barely moves
        left, mid, right = LANE_BY_XPOS
        self.assertEqual(
            infer_lanes_from_paths(make_match(world, paths=paths)),
            {
                1: left, 2: left, 3: mid, 4: mid, 5: right, 6: right,
                7: left, 8: left, 9: mid, 10: mid, 11: right, 12: right,
            },
        )

    def test_reads_the_laning_window_not_the_whole_trail(self):
        # Slot 1 sits in the left corridor during laning and only leaves afterwards;
        # the whole-trail mean would drag it right, the window mean keeps it left.
        world = {
            1: LEFT_X, 2: LEFT_X, 3: MID_X, 4: MID_X, 5: RIGHT_X, 6: RIGHT_X,
            7: LEFT_X, 8: LEFT_X, 9: MID_X, 10: MID_X, 11: RIGHT_X, 12: RIGHT_X,
        }
        paths = [make_path(slot, world[slot]) for slot in range(1, 13)]
        wanderer = make_path(1, LEFT_X)
        wanderer["x_min"], wanderer["x_max"] = LEFT_X, RIGHT_X
        wanderer["x_pos"] = [0.0] * LANE_INFER_END_S + [RESOLUTION] * (SAMPLES - LANE_INFER_END_S)
        paths[0] = wanderer
        left, mid, right = LANE_BY_XPOS
        self.assertEqual(
            infer_lanes_from_paths(make_match(world, paths=paths)),
            {
                1: left, 2: left, 3: mid, 4: mid, 5: right, 6: right,
                7: left, 8: left, 9: mid, 10: mid, 11: right, 12: right,
            },
        )

    def test_returns_empty_without_a_full_set_of_trails(self):
        world = {slot: MID_X for slot in range(1, 13)}
        paths = [make_path(slot, MID_X) for slot in range(1, 12)]  # only 11
        self.assertEqual(infer_lanes_from_paths(make_match(world, paths=paths)), {})

    def test_returns_empty_when_a_team_is_short_a_player(self):
        world = {slot: MID_X for slot in range(1, 13)}
        match = make_match(world)
        match["players"] = [p for p in match["players"] if p["player_slot"] != 12]
        self.assertEqual(infer_lanes_from_paths(match), {})

    def test_returns_empty_when_a_trail_has_no_bounds(self):
        world = {slot: MID_X for slot in range(1, 13)}
        paths = [make_path(slot, MID_X) for slot in range(1, 13)]
        paths[11]["x_min"] = None
        self.assertEqual(infer_lanes_from_paths(make_match(world, paths=paths)), {})

    def test_returns_empty_without_paths(self):
        self.assertEqual(infer_lanes_from_paths({"players": []}), {})
        self.assertEqual(infer_lanes_from_paths({"players": [], "match_paths": None}), {})


class LaneWindowBoundsTests(unittest.TestCase):
    def test_window_is_a_recognisable_laning_period(self):
        self.assertLess(LANE_INFER_START_S, LANE_INFER_END_S)
        self.assertGreaterEqual(LANE_INFER_START_S, 60)
        self.assertLessEqual(LANE_INFER_END_S, 600)


if __name__ == "__main__":
    unittest.main()
