import unittest

from backend.main import objective_lane, objective_name, summarize_match_timeline


def sample_match_info():
    return {
        "match_id": 86090653,
        "duration_s": 1903,
        "winning_team": 0,
        "objectives": [
            # Undestroyed objective: destroyed_time_s 0 must sort last.
            {"team": 1, "team_objective_id": 10, "destroyed_time_s": 0, "first_damage_time_s": 0},
            {
                "team": 0,
                "team_objective_id": 9,
                "destroyed_time_s": 1790,
                "first_damage_time_s": 1781,
                "player_damage": 10183,
                "creep_damage": 0,
                "player_spirit_damage": 2010,
            },
            {"team": 1, "team_objective_id": 4, "destroyed_time_s": 481, "first_damage_time_s": 59},
        ],
        "mid_boss": [
            {"team_killed": 0, "team_claimed": 1, "destroyed_time_s": 1047},
            {"team_killed": 0, "team_claimed": 1, "destroyed_time_s": 1488},
        ],
        "match_pauses": [{"game_time_s": 16, "pause_duration_s": 22, "player_slot": 4}],
        "match_paths": {"interval_s": 1.0, "paths": [{"player_slot": 1, "x_pos": [0, 1, 2]}]},
        "players": [
            {
                "account_id": 42,
                "player_slot": 1,
                "team": 0,
                "hero_id": 11,
                "death_details": [
                    {
                        "game_time_s": 530,
                        "killer_player_slot": 9,
                        "time_to_kill_s": 28.371094,
                        "death_duration_s": 14,
                    }
                ],
                "items": [{"item_id": 2048438176, "game_time_s": 11, "sold_time_s": 0}],
                "power_up_buffs": [
                    {"type": "spirit_permanent_pickup", "value": 1, "is_permanent": True, "pickup_times_s": [300, 120]},
                    {"type": "hp_permanent_pickup", "value": 2, "is_permanent": True, "pickup_times_s": []},
                ],
                "stats": [{"time_stamp_s": 180}, {"time_stamp_s": 360}],
            }
        ],
    }


class ObjectiveNameTests(unittest.TestCase):
    def test_known_ids_are_named(self):
        self.assertEqual(objective_name(0), "Core (Patron)")
        self.assertEqual(objective_name(9), "Titan (Base Guardian)")
        self.assertEqual(objective_name(4), "Tier 1 Walker (Lane 4)")

    def test_unknown_and_missing_ids_are_reported(self):
        self.assertEqual(objective_name(99), "Unknown objective 99")
        self.assertIn("missing", objective_name(None))

    def test_lane_slots_map_to_game_lane_ids(self):
        # Slot numbers are not lane ids: slot 1 is lane 1, slot 3 is lane 4 and
        # slot 4 is lane 6. Each lane covers its Tier 1, Tier 2 and barrack boss.
        self.assertEqual(
            [(slot, objective_lane(slot)) for slot in (1, 5, 12)],
            [(1, 1), (5, 1), (12, 1)],
        )
        self.assertEqual(
            [(slot, objective_lane(slot)) for slot in (3, 7, 14)],
            [(3, 4), (7, 4), (14, 4)],
        )
        self.assertEqual(
            [(slot, objective_lane(slot)) for slot in (4, 8, 15)],
            [(4, 6), (8, 6), (15, 6)],
        )

    def test_objectives_without_a_lane_have_no_lane_id(self):
        for slot in (0, 9, 10, 11, 2, 6, 13, 99, None):
            self.assertIsNone(objective_lane(slot), f"slot {slot} should have no lane")


class SummarizeMatchTimelineTests(unittest.TestCase):
    def test_objectives_are_named_sorted_and_counted(self):
        summary = summarize_match_timeline(sample_match_info())

        self.assertEqual(summary["objective_count"], 3)
        self.assertEqual(summary["objectives_destroyed"], 2)
        # Destroyed objectives ascend by time; the untouched one lands last.
        self.assertEqual(
            [(o["objective_id"], o["destroyed_time_s"]) for o in summary["objectives"]],
            [(4, 481), (9, 1790), (10, 0)],
        )
        self.assertEqual(summary["objectives"][1]["objective"], "Titan (Base Guardian)")
        self.assertFalse(summary["objectives"][2]["destroyed"])
        self.assertEqual(summary["objectives"][1]["player_damage"], 10183)

    def test_bosses_pauses_and_paths_are_reported(self):
        summary = summarize_match_timeline(sample_match_info())

        self.assertEqual([b["destroyed_time_s"] for b in summary["mid_boss"]], [1047, 1488])
        self.assertEqual(summary["pauses"], [{"game_time_s": 16, "pause_duration_s": 22, "player_slot": 4}])
        self.assertEqual(summary["path_interval_s"], 1.0)
        self.assertEqual(summary["path_samples_by_slot"], {"1": 3})

    def test_player_deaths_items_and_buffs_are_reported(self):
        summary = summarize_match_timeline(sample_match_info())

        player = summary["players"][0]
        self.assertEqual(player["player_slot"], 1)
        self.assertEqual(player["deaths"][0]["game_time_s"], 530)
        self.assertEqual(player["deaths"][0]["killer_player_slot"], 9)
        self.assertEqual(player["item_purchases"], [{"item_id": 2048438176, "game_time_s": 11, "sold_time_s": 0}])
        self.assertEqual(player["buff_entry_count"], 2)
        self.assertEqual(player["buff_types"], ["hp_permanent_pickup", "spirit_permanent_pickup"])
        # Pickup times are flattened across buffs and sorted, so a timeline can read them directly.
        self.assertEqual(player["buff_pickup_times_s"], [120, 300])
        self.assertEqual(player["snapshot_times_s"], [180, 360])

    def test_missing_sections_do_not_raise(self):
        summary = summarize_match_timeline({})

        self.assertEqual(summary["objectives"], [])
        self.assertEqual(summary["players"], [])
        self.assertEqual(summary["objective_count"], 0)


if __name__ == "__main__":
    unittest.main()
