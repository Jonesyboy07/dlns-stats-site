"""Tests for the Night Shift week index endpoint helper.

`_build_nightshift_index` is a pure function over rows read elsewhere, so the
week/region/series grouping and the blank-region fallback can be exercised
directly without a database.
"""

import unittest

from backend.app.blueprints.db_api import _build_nightshift_index


def row(
    week,
    team_a,
    team_b,
    *,
    region="NA",
    subtitle=None,
    winning_team=0,
    side_a=0,
    start_time=None,
    match_id=1,
):
    return {
        "event_week": week,
        "event_region": region,
        "event_subtitle": subtitle,
        "event_team_a": team_a,
        "event_team_b": team_b,
        "winning_team": winning_team,
        "event_team_a_ingame_side": side_a,
        "start_time": start_time,
        "match_id": match_id,
    }


class BuildNightshiftIndexTests(unittest.TestCase):
    def test_scores_follow_team_a_side(self):
        # Team A was on Sapphire (1); the Sapphire side won, so A takes the game.
        weeks = _build_nightshift_index(
            [row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS", winning_team=1, side_a=1)]
        )
        series = weeks[0]["regions"]["NA"]["series"][0]
        self.assertEqual((series["score_a"], series["score_b"]), (1, 0))

    def test_missing_team_a_side_falls_back_to_amber(self):
        # No side recorded: team A is Amber, and Amber (0) won.
        weeks = _build_nightshift_index(
            [row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS", winning_team=0, side_a=None)]
        )
        series = weeks[0]["regions"]["NA"]["series"][0]
        self.assertEqual((series["score_a"], series["score_b"]), (1, 0))

    def test_undecided_match_still_counts_the_series(self):
        weeks = _build_nightshift_index(
            [row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS", winning_team=9)]
        )
        series = weeks[0]["regions"]["NA"]["series"][0]
        self.assertEqual((series["score_a"], series["score_b"]), (0, 0))

    def test_series_group_across_games_and_regions(self):
        weeks = _build_nightshift_index(
            [
                row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS", match_id=1),
                row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS", match_id=2),
                row(58, "Leviathan", "Buff Enjoyers", region="EU", subtitle="FINALS", match_id=3),
            ]
        )
        self.assertEqual(len(weeks), 1)
        na = weeks[0]["regions"]["NA"]["series"]
        eu = weeks[0]["regions"]["EU"]["series"]
        self.assertEqual(len(na), 1)
        self.assertEqual(na[0]["score_a"], 2)
        self.assertEqual(len(eu), 1)

    def test_blank_region_is_inferred_from_a_shared_team(self):
        weeks = _build_nightshift_index(
            [
                row(54, "Leviathan", "Abrahams", region="EU", subtitle="CHALLENGER MATCH", match_id=1),
                row(54, "Buff Enjoyers", "Leviathan", region=None, subtitle="FINALS", match_id=2),
            ]
        )
        self.assertEqual(sorted(weeks[0]["regions"]), ["EU"])
        self.assertEqual(len(weeks[0]["regions"]["EU"]["series"]), 2)

    def test_uninferable_region_is_bucketed_separately(self):
        weeks = _build_nightshift_index([row(51, "Alpha", "Beta", region=None, subtitle="QUALIFIERS")])
        self.assertEqual(sorted(weeks[0]["regions"]), ["Other"])

    def test_week_date_uses_the_earliest_start_time(self):
        weeks = _build_nightshift_index(
            [
                row(58, "A", "B", start_time="2026-09-30T18:00:00Z", match_id=1),
                row(58, "C", "D", start_time="2026-09-28T18:00:00Z", match_id=2),
            ]
        )
        self.assertEqual(weeks[0]["date"], "2026-09-28T18:00:00Z")

    def test_weeks_are_ordered_oldest_first(self):
        weeks = _build_nightshift_index([row(58, "A", "B"), row(12, "C", "D"), row(30, "E", "F")])
        self.assertEqual([w["week"] for w in weeks], [12, 30, 58])

    def test_rows_without_teams_are_ignored(self):
        weeks = _build_nightshift_index(
            [
                row(58, "", "", subtitle="FINALS"),
                row(58, "Melee Creeps", "Pulsar Esports", subtitle="FINALS"),
            ]
        )
        self.assertEqual(len(weeks[0]["regions"]["NA"]["series"]), 1)


if __name__ == "__main__":
    unittest.main()
