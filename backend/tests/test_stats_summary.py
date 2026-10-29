"""Tests for the redesigned stats page's aggregates (`backend/app/utils/stats_summary.py`).

All pure functions over match and player rows, so they are tested directly
without a database.
"""

import unittest

from backend.app.utils import stats_summary as ss


def match(match_id, week, region="EU", winner=0, duration=1800, team_a="A", team_b="B"):
    return {
        "match_id": match_id,
        "event_week": week,
        "event_region": region,
        "event_team_a": team_a,
        "event_team_b": team_b,
        "winning_team": winner,
        "duration_s": duration,
    }


def player(match_id, account, hero, win=True, **stats):
    return {"match_id": match_id, "account_id": account, "hero_id": hero, "result": "Win" if win else "Loss", **stats}


class ResolveRegionsTests(unittest.TestCase):
    def test_blank_region_borrows_a_team_region_from_the_same_week(self):
        rows = [
            match(1, 60, "eu", team_a="Owls", team_b="Rats"),
            match(2, 60, "", team_a="Rats", team_b="Cats"),
            match(3, 61, "", team_a="Rats", team_b="Dogs"),
        ]
        regions = ss.resolve_regions(rows)
        self.assertEqual(regions[1], "EU")
        self.assertEqual(regions[2], "EU")
        # A different week knows nothing about Rats, so it stays unknown.
        self.assertIsNone(regions[3])


class ParseWeeksTests(unittest.TestCase):
    def test_ranges_single_weeks_and_junk(self):
        self.assertEqual(ss.parse_weeks("60-61"), (60, 61))
        self.assertEqual(ss.parse_weeks("61-60"), (60, 61))
        self.assertEqual(ss.parse_weeks("61"), (61, 61))
        self.assertEqual(ss.parse_weeks("60–61"), (60, 61))
        self.assertIsNone(ss.parse_weeks(""))
        self.assertIsNone(ss.parse_weeks("a-b"))
        self.assertIsNone(ss.parse_weeks("1-2-3"))


class SummarizeTests(unittest.TestCase):
    def test_counts_sides_heroes_and_players(self):
        matches = [match(1, 60, winner=0, duration=1500), match(2, 60, winner=1, duration=2100)]
        players = {
            1: [player(1, 10, 7), player(1, 11, 8)],
            2: [player(2, 10, 7), player(2, 12, 9), player(2, None, 9)],
        }
        summary = ss.summarize(matches, players)
        self.assertEqual(summary["matches"], 2)
        self.assertEqual(summary["avg_duration"], 1800)
        self.assertEqual((summary["amber_wins"], summary["sapphire_wins"]), (1, 1))
        self.assertEqual(summary["unique_heroes"], 3)
        self.assertEqual(summary["unique_players"], 3)

    def test_no_matches_is_none(self):
        self.assertIsNone(ss.summarize([], {}))


class DurationBucketTests(unittest.TestCase):
    def test_buckets_are_contiguous_and_skip_untimed_games(self):
        buckets = ss.duration_buckets([1450, 1499, 2667, 0, None])
        self.assertEqual([b["start_s"] for b in buckets], [1200, 1500, 1800, 2100, 2400])
        self.assertEqual([b["count"] for b in buckets], [2, 0, 0, 0, 1])
        self.assertEqual(ss.duration_buckets([]), [])


class SideTrendTests(unittest.TestCase):
    def test_amber_share_per_week_with_gaps_as_none(self):
        matches = [match(1, 60, winner=0), match(2, 60, winner=1), match(3, 61, winner=0)]
        trend = ss.side_trend(matches, end_week=61, weeks=3)
        self.assertEqual([t["week"] for t in trend], [59, 60, 61])
        self.assertEqual([t["amber_pct"] for t in trend], [None, 50.0, 100.0])


class ThisWeekTests(unittest.TestCase):
    def test_biggest_riser_compares_pick_rates(self):
        latest = [match(3, 61), match(4, 61)]
        previous = [match(1, 60), match(2, 60)]
        players = {
            1: [player(1, 1, 7)],
            2: [player(2, 1, 8)],
            3: [player(3, 1, 7), player(3, 2, 9)],
            4: [player(4, 1, 7), player(4, 2, 9)],
        }
        riser = ss.biggest_riser(latest, previous, players)
        # Hero 9: 0% -> 100%. Hero 7: 50% -> 100%.
        self.assertEqual(riser["hero_id"], 9)
        self.assertEqual(riser["delta"], 100.0)
        self.assertIsNone(ss.biggest_riser(latest, [], players))

    def test_record_set_only_names_records_from_that_week(self):
        matches = [match(1, 60), match(2, 61)]
        players = {
            1: [player(1, 1, 7, kills=20, assists=5)],
            2: [player(2, 2, 8, kills=12, assists=30)],
        }
        record = ss.record_set(matches, players, week=61)
        # Kills is preferred but its record is from week 60; assists was set in 61.
        self.assertEqual(record["stat"], "assists")
        self.assertEqual(record["value"], 30)
        self.assertEqual(record["account_id"], 2)

    def test_a_tied_record_belongs_to_the_earlier_game(self):
        matches = [match(1, 60), match(2, 61)]
        players = {1: [player(1, 1, 7, kills=15)], 2: [player(2, 2, 8, kills=15)]}
        self.assertIsNone(ss.record_set(matches, players, week=61))

    def test_side_swing_prefers_a_region_whose_leader_flipped(self):
        latest = {"EU": [match(1, 61, winner=0)], "NA": [match(2, 61, "NA", winner=1)]}
        previous = {"EU": [match(3, 60, winner=0)], "NA": [match(4, 60, "NA", winner=0)]}
        swing = ss.side_swing(latest, previous, 61)
        self.assertEqual(swing["region"], "NA")
        self.assertTrue(swing["swung"])
        self.assertEqual(swing["leader"], "sapphire")

    def test_side_swing_falls_back_to_the_first_region_that_played(self):
        latest = {"EU": [], "NA": [match(2, 61, "NA", winner=1)]}
        swing = ss.side_swing(latest, {}, 61)
        self.assertEqual(swing["region"], "NA")
        self.assertFalse(swing["swung"])
        self.assertIsNone(swing["previous"])
        self.assertIsNone(ss.side_swing({"EU": []}, {}, 61))


class GroupPatchesTests(unittest.TestCase):
    def test_consecutive_weeks_on_one_update_share_a_band(self):
        a = {"gid": "1", "title": "Gameplay Update 10-02", "url": "u1", "published_at": "2026-10-02T00:00:00+00:00"}
        b = {"gid": "2", "title": "City Never Sleeps", "url": "u2", "published_at": "2026-10-09T00:00:00+00:00"}
        patches = ss.group_patches([(1, None), (2, a), (3, None), (4, a), (5, b), (6, b)])
        self.assertEqual(
            [(p["name"], p["start_week"], p["end_week"]) for p in patches],
            [("Gameplay Update 10-02", 1, 4), ("City Never Sleeps", 5, 6)],
        )
        self.assertEqual(patches[1]["url"], "u2")
        self.assertNotIn("key", patches[0])

    def test_no_known_update_is_one_unknown_band(self):
        patches = ss.group_patches([(60, None), (61, None)])
        self.assertEqual([(p["name"], p["start_week"], p["end_week"]) for p in patches], [("Unknown patch", 60, 61)])
        self.assertEqual(ss.group_patches([]), [])


class RecordCardsTests(unittest.TestCase):
    def test_player_records_rank_best_first_with_ties_to_the_earlier_game(self):
        matches = [match(1, 60, duration=1500), match(2, 61, "NA", duration=2400), match(3, 61, duration=0)]
        players = {
            1: [player(1, 10, 7, kills=12), player(1, 11, 8, kills=9)],
            2: [player(2, 12, 9, kills=12), player(2, 13, 7, kills=None)],
        }
        cards = {card["id"]: card for card in ss.record_cards(matches, players, ss.resolve_regions(matches), limit=2)}
        kills = cards["kills"]["entries"]
        self.assertEqual([(e["value"], e["match_id"]) for e in kills], [(12, 1), (12, 2)])
        self.assertEqual(kills[1]["region"], "NA")
        self.assertEqual(kills[0]["week"], 60)
        self.assertEqual(cards["assists"]["entries"], [])

    def test_fastest_and_longest_skip_untimed_games(self):
        matches = [match(1, 60, duration=1500), match(2, 61, duration=2400), match(3, 61, duration=0)]
        cards = {card["id"]: card for card in ss.record_cards(matches, {}, ss.resolve_regions(matches))}
        self.assertEqual([e["match_id"] for e in cards["fastest"]["entries"]], [1, 2])
        self.assertEqual([e["match_id"] for e in cards["longest"]["entries"]], [2, 1])
        self.assertEqual(cards["longest"]["kind"], "game")
        self.assertEqual(cards["longest"]["entries"][0]["value"], 2400)


class LeaderboardTests(unittest.TestCase):
    def setUp(self):
        self.matches = [match(i, 60) for i in range(1, 7)]
        self.players = {}
        for i in range(1, 7):
            rows = [player(i, 1, 7 if i < 5 else 8, kills=2, assists=1, deaths=1)]
            if i <= 5:
                rows.append(player(i, 2, 9, kills=4, assists=0, deaths=2))
            if i == 1:
                rows.append(player(i, 3, 9, kills=30, assists=0, deaths=0))
            self.players[i] = rows

    def test_only_players_with_enough_games_are_ranked(self):
        boards = ss.leaderboards(self.matches, self.players, min_games=5)
        ranked = {row["account_id"] for row in boards["kills"]["avg"]}
        # Player 3 has one huge game but too few games to rank.
        self.assertEqual(ranked, {1, 2})

    def test_average_and_total_rank_separately(self):
        boards = ss.leaderboards(self.matches, self.players, min_games=5)
        self.assertEqual([r["account_id"] for r in boards["kills"]["avg"]], [2, 1])
        self.assertEqual(boards["kills"]["avg"][0]["avg"], 4.0)
        # Player 1 played six games to player 2's five.
        self.assertEqual([r["total"] for r in boards["kills"]["total"]], [20, 12])

    def test_top_hero_is_the_most_played(self):
        boards = ss.leaderboards(self.matches, self.players, min_games=5)
        top = {row["account_id"]: row["top_hero_id"] for row in boards["kills"]["avg"]}
        self.assertEqual(top, {1: 7, 2: 9})

    def test_kda_total_is_the_kda_over_all_games(self):
        boards = ss.leaderboards(self.matches, self.players, min_games=5)
        player_two = next(r for r in boards["kda"]["total"] if r["account_id"] == 2)
        # 20 kills + 0 assists over 10 deaths.
        self.assertEqual(player_two["total"], 2.0)
        self.assertEqual(player_two["avg"], 2.0)


if __name__ == "__main__":
    unittest.main()
