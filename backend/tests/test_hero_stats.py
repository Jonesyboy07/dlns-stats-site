"""Tests for the derived hero statistics on the Player x Hero endpoints.

These cover the two pieces of that payload with the most logic and the least
obvious failure modes: where a player ranks inside a hero's pool, and how the
ability-point orders are grouped into builds. Both are pure functions over rows
read elsewhere, so they can be tested directly without a database.
"""

import json
import unittest

from backend.app.blueprints.db_api import (
    ABILITY_BUILD_LIMIT,
    RANK_MIN_GAMES,
    RANK_TOP_N,
    _ability_builds,
    _hero_standings,
)


class HeroStandingsTests(unittest.TestCase):
    """`_hero_standings` — ranks by games and by win rate.

    Pool used throughout (games, wins, losses):
        1: 20 games, 12-8  (60.0%)   best by games, tied with 2
        2: 20 games, 10-10 (50.0%)   tied with 1 on games
        3: 10 games,  9-1  (90.0%)   best win rate
        4:  8 games,  4-4  (50.0%)
        5:  4 games,  4-0            only 4 decided, below RANK_MIN_GAMES
    """

    POOL = {
        1: {"games": 20, "wins": 12, "losses": 8},
        2: {"games": 20, "wins": 10, "losses": 10},
        3: {"games": 10, "wins": 9, "losses": 1},
        4: {"games": 8, "wins": 4, "losses": 4},
        5: {"games": 4, "wins": 4, "losses": 0},
    }

    def test_ties_share_the_better_rank(self):
        # 1 and 2 are both on 20 games with nobody ahead, so both rank first.
        for account in (1, 2):
            standings = _hero_standings(self.POOL, account)
            self.assertEqual(standings["by_games"]["rank"], 1)
            self.assertEqual(standings["by_games"]["of"], 5)
            self.assertEqual(standings["by_games"]["value"], 20)

    def test_win_rate_rank_counts_only_strictly_better_rates(self):
        # 1 is at 60%: only 3 (90%) is ahead of it.
        standings = _hero_standings(self.POOL, 1)
        self.assertEqual(standings["by_win_rate"]["rank"], 2)
        # 2 is at 50%: 3 (90%) and 1 (60%) are ahead.
        self.assertEqual(standings["by_win_rate"]["of"], 4)

        tied = _hero_standings(self.POOL, 2)
        self.assertEqual(tied["by_win_rate"]["rank"], 3)

    def test_win_rate_table_excludes_players_below_min_games(self):
        # Player 5 has the best raw rate (4-0) but only 4 decided games, so it is
        # not in the rated pool and cannot be ranked against.
        standings = _hero_standings(self.POOL, 5)
        self.assertIsNone(standings["by_win_rate"])
        # It still has a games rank, because that table has no minimum.
        self.assertEqual(standings["by_games"]["rank"], 5)

        everyone_else = _hero_standings(self.POOL, 1)
        self.assertEqual(everyone_else["by_win_rate"]["of"], 4)
        self.assertEqual(everyone_else["by_win_rate"]["min_games"], RANK_MIN_GAMES)

    def test_a_player_outside_the_pool_has_no_ranks_and_is_not_eligible(self):
        standings = _hero_standings(self.POOL, 999)
        self.assertIsNone(standings["by_games"])
        self.assertIsNone(standings["by_win_rate"])
        self.assertFalse(standings["eligible"])
        self.assertEqual(len(standings["pool"]), 5)

    def test_eligibility_is_either_table_inside_the_top_n(self):
        # Player 3 is 3rd by games but 1st by win rate.
        standings = _hero_standings(self.POOL, 3)
        self.assertEqual(standings["by_games"]["rank"], 3)
        self.assertEqual(standings["by_win_rate"]["rank"], 1)
        self.assertTrue(standings["eligible"])

        # With top_n = 1 only the win-rate table puts it inside.
        strict = _hero_standings(self.POOL, 3, top_n=1)
        self.assertFalse(strict["by_games"]["rank"] <= 1)
        self.assertTrue(strict["by_win_rate"]["rank"] <= 1)
        self.assertTrue(strict["eligible"])

        # Player 4 is 4th by games and 3rd-4th by rate, so nothing qualifies.
        self.assertFalse(_hero_standings(self.POOL, 4, top_n=2)["eligible"])

    def test_default_top_n_matches_the_module_constant(self):
        standings = _hero_standings(self.POOL, 1)
        self.assertTrue(standings["eligible"])
        self.assertEqual(RANK_TOP_N, 10)

    def test_pool_is_sorted_by_games_then_account_and_flags_the_player(self):
        pool = _hero_standings(self.POOL, 3)["pool"]
        self.assertEqual([entry["account_id"] for entry in pool], [1, 2, 3, 4, 5])
        self.assertEqual([entry["is_player"] for entry in pool], [False, False, True, False, False])
        self.assertEqual(pool[0]["games"], 20)
        self.assertEqual(pool[0]["wins"], 12)
        self.assertEqual(pool[0]["losses"], 8)


class AbilityBuildTests(unittest.TestCase):
    """`_ability_builds` — grouping point orders by the unlock order.

    Heroes have four abilities; `slots` is the ability-id -> slot map the ingest
    would have produced, and every event carries the tier it belongs to.
    """

    ABILITY_IDS = {0: "a_one", 1: "a_two", 2: "a_three", 3: "a_four"}
    UNKNOWN_ID = "upgrade_some_item"

    SLOTS = {
        "slots": {ability_id: slot for slot, ability_id in ABILITY_IDS.items()},
        "abilities": [
            {"slot": 0, "name": "One"},
            {"slot": 1, "name": "Two"},
            {"slot": 2, "name": "Three"},
            {"slot": 3, "name": "Four"},
        ],
    }

    @staticmethod
    def _row(match_id, events, won=True):
        """A `mine` row with only the positions `_ability_builds` reads filled."""
        values = [None] * 11
        values[0] = match_id                      # match_id
        values[1] = 0 if won else 1               # the player's side
        values[2] = None                          # stored result (sides are known)
        values[8] = json.dumps(events)            # ability_order
        values[10] = 0                            # winning team (side 0 wins)
        return tuple(values)

    def _unlock_events(self, order):
        return [
            {"ability_id": self.ABILITY_IDS[slot], "tier": 0, "game_time_s": index + 1}
            for index, slot in enumerate(order)
        ]

    def test_groups_by_unlock_order_and_sizes_each_group(self):
        rows = [
            self._row(101, self._unlock_events((0, 1, 2, 3))),
            self._row(102, self._unlock_events((0, 1, 2, 3))),
            self._row(103, self._unlock_events((0, 1, 2, 3)), won=False),
            self._row(104, self._unlock_events((3, 2, 1, 0))),
            self._row(105, self._unlock_events((3, 2, 1, 0))),
            self._row(106, self._unlock_events((1, 0, 2, 3))),
        ]
        result = _ability_builds(rows, self.SLOTS, games=7)

        self.assertEqual(result["games"], 7)
        # Three groups, ordered by how many games used them.
        self.assertEqual([build["games"] for build in result["builds"]], [3, 2, 1])
        # The six rows account for 6 of the 7 games recorded on the hero.
        self.assertEqual(result["other_games"], 1)
        self.assertEqual(
            [build["share"] for build in result["builds"]],
            [3 / 7, 2 / 7, 1 / 7],
        )

    def test_unlock_order_is_named_through_the_slot_map(self):
        rows = [
            self._row(101, self._unlock_events((0, 1, 2, 3))),
            self._row(102, self._unlock_events((3, 2, 1, 0))),
        ]
        builds = _ability_builds(rows, self.SLOTS, games=2)["builds"]
        by_order = {tuple(build["unlock_order"]): build for build in builds}
        self.assertIn(("One", "Two", "Three", "Four"), by_order)
        self.assertIn(("Four", "Three", "Two", "One"), by_order)

    def test_record_denominator_is_decided_games_only(self):
        rows = [
            self._row(101, self._unlock_events((0, 1, 2, 3)), won=True),
            self._row(102, self._unlock_events((0, 1, 2, 3)), won=False),
        ]
        build = _ability_builds(rows, self.SLOTS, games=2)["builds"][0]
        self.assertEqual((build["games"], build["wins"], build["losses"]), (2, 1, 1))
        self.assertEqual(build["win_rate"], 0.5)

    def test_item_purchases_are_ignored_and_cannot_form_a_build(self):
        # The ingest stores ordinary item purchases in ability_order too. A game
        # whose events are all items contributes nothing at all.
        rows = [
            self._row(101, self._unlock_events((0, 1, 2, 3))),
            self._row(
                102,
                [
                    {"ability_id": self.UNKNOWN_ID, "tier": 0, "game_time_s": 5},
                    {"ability_id": self.UNKNOWN_ID, "tier": 1, "game_time_s": 9},
                ],
            ),
        ]
        result = _ability_builds(rows, self.SLOTS, games=2)
        self.assertEqual(len(result["builds"]), 1)
        self.assertEqual(result["builds"][0]["games"], 1)
        self.assertEqual(result["other_games"], 1)

    def test_a_repeated_step_keeps_the_earliest_time(self):
        # Slot 0 unlocks at t=99 in one entry and t=1 in another; the earliest
        # wins, so the unlock order still starts with slot 0.
        events = self._unlock_events((1, 2, 3))
        events.append({"ability_id": self.ABILITY_IDS[0], "tier": 0, "game_time_s": 99})
        events.append({"ability_id": self.ABILITY_IDS[0], "tier": 0, "game_time_s": 1})

        build = _ability_builds([self._row(101, events)], self.SLOTS, games=1)["builds"][0]
        self.assertEqual(build["unlock_order"], ["One", "Two", "Three", "Four"])

    def test_max_order_only_counts_the_top_tier(self):
        events = self._unlock_events((0, 1, 2, 3))
        events += [
            {"ability_id": self.ABILITY_IDS[2], "tier": 1, "game_time_s": 40},
            {"ability_id": self.ABILITY_IDS[2], "tier": 3, "game_time_s": 50},
            {"ability_id": self.ABILITY_IDS[1], "tier": 3, "game_time_s": 60},
        ]
        build = _ability_builds([self._row(101, events)], self.SLOTS, games=1)["builds"][0]
        self.assertEqual(build["max_order"], ["Three", "Two"])
        # `steps` is the full ordered sequence of [slot, tier] pairs.
        self.assertIn([2, 3], build["steps"])
        self.assertIn([1, 3], build["steps"])
        self.assertNotIn([2, 1], [step for step in build["steps"] if step[1] == 3])

    def test_build_list_is_capped_and_ordered_by_games(self):
        rows = []
        # Four distinct unlock orders with 4, 3, 2 and 1 game(s).
        for order in ((0, 1, 2, 3), (1, 0, 2, 3), (2, 0, 1, 3), (3, 0, 1, 2)):
            weight = 4 - ((0, 1, 2, 3), (1, 0, 2, 3), (2, 0, 1, 3), (3, 0, 1, 2)).index(order)
            rows.extend(self._row(200 + index, self._unlock_events(order)) for index in range(weight))

        result = _ability_builds(rows, self.SLOTS, games=10)
        self.assertEqual(len(result["builds"]), ABILITY_BUILD_LIMIT)
        self.assertEqual([build["games"] for build in result["builds"]], [4, 3, 2])
        # The 1-game order is not shown, so its game lands in "other".
        self.assertEqual(result["other_games"], 10 - 9)

    def test_slots_are_passed_through_and_missing_names_fall_back(self):
        slots = {
            "slots": {"a_one": 0, "a_extra": 5},
            "abilities": [{"slot": 0, "name": "One"}],
        }
        rows = [
            self._row(
                101,
                [
                    {"ability_id": "a_one", "tier": 0, "game_time_s": 1},
                    {"ability_id": "a_extra", "tier": 0, "game_time_s": 2},
                ],
            )
        ]
        result = _ability_builds(rows, slots, games=1)
        self.assertEqual(result["abilities"], slots["abilities"])
        # Slot 5 is in the id map but has no entry in the slot -> name list, so it
        # is labelled by number rather than dropped.
        self.assertEqual(result["builds"][0]["unlock_order"], ["One", "Ability 5"])

    def test_unparseable_ability_order_is_skipped(self):
        rows = [
            self._row(101, self._unlock_events((0, 1, 2, 3))),
            self._row(102, []),
        ]
        broken = list(rows[1])
        broken[8] = "{not json"
        rows.append(tuple(broken))

        result = _ability_builds(rows, self.SLOTS, games=3)
        self.assertEqual(result["builds"][0]["games"], 1)
        self.assertEqual(result["other_games"], 2)


if __name__ == "__main__":
    unittest.main()
