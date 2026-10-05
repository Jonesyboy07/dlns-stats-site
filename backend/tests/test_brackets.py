"""Tests for bracket generation and result computation (backend/app/utils/brackets.py).

All pure functions: generators build the empty structure, and ``compute`` turns
a ``{match_id: winning slot}`` map into scores, winners and advancement.
"""

import unittest

from backend.app.utils.brackets import (
    BYE, add_first_round, compute, generate, generate_gauntlet, generate_single_elim, match_ids,
    remove_first_round, stats_id,
)


def _game(match_id, winner=None):
    g = {"game": 1, "match_id": match_id}
    if winner:
        g["winner"] = winner
    return g


class GauntletTests(unittest.TestCase):
    def test_two_rounds_place_champion_in_finals(self):
        ev = generate_gauntlet(["Leviathan", "Buff Enjoyers", "Abrahams"], ["Challenger", "Finals"], [1, 3])
        r1, r2 = ev["series"]
        self.assertEqual((r1["id"], r1["team_a"], r1["team_b"]), ("R1M1", "Buff Enjoyers", "Abrahams"))
        self.assertEqual((r2["id"], r2["team_a"], r2["team_b"]), ("R2M1", "Leviathan", None))
        self.assertEqual(r1["winner_to"], {"series": "R2M1", "slot": "team_b"})
        self.assertIsNone(r2["winner_to"])

    def test_qualifiers_add_a_round_and_a_team(self):
        ev = generate_gauntlet(["Leviathan", "Buff Enjoyers", "Abrahams", "Hydra Nation"],
                               ["Qualifiers", "Challenger", "Finals"], [1, 1, 3])
        self.assertEqual([s["id"] for s in ev["series"]], ["R1M1", "R2M1", "R3M1"])
        self.assertEqual(ev["series"][0]["team_a"], "Abrahams")
        self.assertEqual(ev["series"][0]["team_b"], "Hydra Nation")
        self.assertEqual(ev["series"][1]["team_a"], "Buff Enjoyers")
        self.assertEqual(ev["series"][2]["team_a"], "Leviathan")

    def test_wrong_team_count_is_rejected(self):
        with self.assertRaises(ValueError):
            generate_gauntlet(["A", "B"], ["Challenger", "Finals"], [1, 3])

    def test_teams_can_be_left_empty(self):
        ev = generate_gauntlet([], ["Challenger", "Finals"], [1, 3])
        self.assertTrue(all(s["team_a"] is None for s in ev["series"]))


class SingleElimTests(unittest.TestCase):
    def test_64_teams_is_6_rounds_and_63_series(self):
        ev = generate_single_elim([f"T{i}" for i in range(1, 65)], [1])
        self.assertEqual(len(ev["rounds"]), 6)
        self.assertEqual(len(ev["series"]), 63)
        self.assertEqual(ev["rounds"][-1]["name"], "Final")
        first = ev["series"][0]
        self.assertEqual((first["team_a"], first["team_b"]), ("T1", "T64"))

    def test_links_feed_alternate_slots(self):
        ev = generate_single_elim(["A", "B", "C", "D"], [1])
        by_id = {s["id"]: s for s in ev["series"]}
        self.assertEqual(by_id["R1M1"]["winner_to"], {"series": "R2M1", "slot": "team_a"})
        self.assertEqual(by_id["R1M2"]["winner_to"], {"series": "R2M1", "slot": "team_b"})

    def test_byes_pad_to_power_of_two_and_auto_advance(self):
        ev = generate_single_elim(["A", "B", "C"], [1])
        by_id = {s["id"]: s for s in ev["series"]}
        self.assertEqual((by_id["R1M1"]["team_a"], by_id["R1M1"]["team_b"]), ("A", BYE))
        out = {s["id"]: s for s in compute(ev, {})["series"]}
        self.assertEqual(out["R1M1"]["status"], "bye")
        self.assertEqual(out["R2M1"]["team_a"], "A")

    def test_per_round_best_of(self):
        ev = generate("single_elim", ["A", "B", "C", "D"], best_of=[1, 3])
        self.assertEqual([r["best_of"] for r in ev["rounds"]], [1, 3])


class ComputeTests(unittest.TestCase):
    def setUp(self):
        self.ev = generate_gauntlet(["Leviathan", "Buff Enjoyers", "Abrahams"], ["Challenger", "Finals"], [1, 3])
        self.ev["series"][0]["games"] = [_game(101)]
        self.ev["series"][1]["games"] = [_game(201), _game(202)]

    def test_winner_advances_and_scores_add_up(self):
        out = compute(self.ev, {101: "team_a", 201: "team_a", 202: "team_a"})
        r1, r2 = out["series"]
        self.assertEqual((r1["status"], r1["winner_name"]), ("done", "Buff Enjoyers"))
        self.assertEqual(r2["team_b"], "Buff Enjoyers")
        self.assertTrue(r2["fed_b"])
        self.assertEqual((r2["score_a"], r2["score_b"], r2["winner_name"]), (2, 0, "Leviathan"))

    def test_unfinished_series_is_live(self):
        out = compute(self.ev, {101: "team_b", 201: "team_b"})
        self.assertEqual(out["series"][1]["status"], "live")
        self.assertIsNone(out["series"][1]["winner"])

    def test_stored_event_is_not_mutated(self):
        compute(self.ev, {101: "team_a"})
        self.assertIsNone(self.ev["series"][1]["team_b"])

    def test_dq_after_game_one_overrides_result(self):
        # Buff Enjoyers win game 1 of the final, then get disqualified.
        self.ev["series"][1]["outcome"] = {
            "type": "dq", "team": "team_b", "after_game": 1, "reason": "Ineligible player", "played_games": "keep",
        }
        out = compute(self.ev, {101: "team_a", 201: "team_b", 202: "team_b"})
        final = out["series"][1]
        self.assertEqual((final["status"], final["winner_name"]), ("dq", "Leviathan"))
        self.assertEqual((final["score_a"], final["score_b"]), (0, 1))  # game 2 is after the DQ

    def test_dq_with_void_drops_played_games_from_score(self):
        self.ev["series"][1]["outcome"] = {"type": "dq", "team": "team_b", "after_game": 1, "played_games": "void"}
        final = compute(self.ev, {101: "team_a", 201: "team_b"})["series"][1]
        self.assertEqual((final["score_a"], final["score_b"]), (0, 0))

    def test_manual_winner_counts_for_forfeits(self):
        self.ev["series"][0]["games"] = [{"game": 1, "match_id": None, "forfeit": True, "winner": "team_b"}]
        r1 = compute(self.ev, {})["series"][0]
        self.assertEqual(r1["winner_name"], "Abrahams")

    def test_picked_winner_beats_api_result(self):
        self.ev["series"][0]["games"] = [_game(101, winner="team_b")]
        r1 = compute(self.ev, {101: "team_a"})["series"][0]
        self.assertEqual(r1["winner_name"], "Abrahams")

    def test_match_ids_skips_placeholders(self):
        self.ev["series"][0]["games"].append({"match_id": None})
        self.ev["series"][0]["games"].append({"match_id": -5})
        self.assertEqual(match_ids(self.ev), [101, 201, 202])


class RoundEditTests(unittest.TestCase):
    def setUp(self):
        self.ev = generate_gauntlet(["Leviathan", "Buff Enjoyers", "Abrahams"], ["Challenger", "Finals"], [1, 3])

    def test_add_first_round_renumbers_and_feeds_the_old_opener(self):
        out = add_first_round(self.ev, "Qualifiers", 3, "Abrahams", "Silence")
        self.assertEqual([r["name"] for r in out["rounds"]], ["Qualifiers", "Challenger", "Finals"])
        by_id = {s["id"]: s for s in out["series"]}
        self.assertEqual(by_id["R1M1"]["winner_to"], {"series": "R2M1", "slot": "team_b"})
        self.assertEqual(by_id["R2M1"]["winner_to"], {"series": "R3M1", "slot": "team_b"})
        self.assertIsNone(by_id["R2M1"]["team_b"])  # unplayed, so the qualifier winner fills it
        self.assertEqual(by_id["R3M1"]["team_a"], "Leviathan")
        self.assertEqual(self.ev["rounds"][0]["name"], "Challenger")  # input untouched

    def test_add_first_round_keeps_teams_of_a_played_opener(self):
        self.ev["series"][0]["games"] = [{"game": 1, "match_id": 101, "winner": "team_a"}]
        out = add_first_round(self.ev, "Qualifiers", 3, "Abrahams", "Silence")
        self.assertEqual(out["series"][1]["team_b"], "Abrahams")

    def test_remove_first_round_undoes_an_empty_one(self):
        out = remove_first_round(add_first_round(self.ev, "Qualifiers", 3, "A", "B"))
        self.assertEqual([s["id"] for s in out["series"]], ["R1M1", "R2M1"])
        self.assertEqual(out["series"][0]["winner_to"], {"series": "R2M1", "slot": "team_b"})

    def test_remove_first_round_refuses_when_played(self):
        self.ev["series"][0]["games"] = [{"game": 1, "match_id": 101}]
        with self.assertRaises(ValueError):
            remove_first_round(self.ev)

    def test_single_elim_rounds_cant_be_added(self):
        with self.assertRaises(ValueError):
            add_first_round(generate_single_elim(["A", "B"], [1]), "Q", 1, None, None)


class RemoveFromMatchesJsonTests(unittest.TestCase):
    """Moving an event: old copies go, the kept (title, week) stays, emptied weeks are dropped."""

    def test_moved_games_leave_no_empty_week(self):
        import json
        import tempfile
        from pathlib import Path
        from backend.app.blueprints.brackets import _remove_from_matches_json
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "matches.json"
            game = {"team_a": "A", "team_b": "B", "matches": [{"game": "Game 1", "team_a_side": 0, "match_id": 7}]}
            other = {"team_a": "C", "team_b": "D", "matches": [{"game": "Game 1", "team_a_side": 0, "match_id": 8}]}
            path.write_text(json.dumps({"series": [{"title": "Night Shift", "weeks": [
                {"week": 995, "games": [game]},
                {"week": 994, "games": [game]},
                {"week": 996, "games": [other]},
                {"week": 997, "games": []},
            ]}]}), encoding="utf-8")
            _remove_from_matches_json(path, {7}, keep=("Night Shift", 994))
            weeks = json.loads(path.read_text(encoding="utf-8"))["series"][0]["weeks"]
            self.assertEqual([w["week"] for w in weeks], [994, 996, 997])  # 997 was already empty


class WriteBansTests(unittest.TestCase):
    """_write_bans replaces a game's match_bans rows and skips games with no match row."""

    def setUp(self):
        import tempfile
        from pathlib import Path
        from backend.main import db_connect, db_init
        self.tmp = tempfile.TemporaryDirectory()
        self.db = Path(self.tmp.name) / "t.sqlite3"
        conn = db_connect(self.db)
        db_init(conn)
        conn.execute("INSERT INTO matches(match_id, event_team_a, event_team_b) VALUES (101, 'Leviathan', 'Abrahams')")
        conn.commit()
        conn.close()

    def tearDown(self):
        self.tmp.cleanup()

    def _rows(self):
        import sqlite3
        conn = sqlite3.connect(self.db)
        try:
            return conn.execute("SELECT match_id, ban_order, team, team_name, hero_id FROM match_bans ORDER BY ban_order").fetchall()
        finally:
            conn.close()

    def test_bans_are_written_then_replaced(self):
        from backend.app.blueprints.brackets import _write_bans
        series = {"team_a": "Leviathan", "team_b": "Abrahams"}
        bans = [{"order": 1, "team": "team_b", "hero_id": 12}, {"order": 2, "team": "team_a", "hero_id": 3}]
        self.assertEqual(_write_bans(self.db, series, [(101, bans)]), 0)
        self.assertEqual(self._rows(), [(101, 1, "team_b", "Abrahams", 12), (101, 2, "team_a", "Leviathan", 3)])
        _write_bans(self.db, series, [(101, bans[:1])])
        self.assertEqual(len(self._rows()), 1)
        _write_bans(self.db, series, [(101, [])])
        self.assertEqual(self._rows(), [])

    def test_game_without_match_row_is_skipped(self):
        from backend.app.blueprints.brackets import _write_bans
        skipped = _write_bans(self.db, {"team_a": "A", "team_b": "B"}, [(999, [{"order": 1, "team": "team_a", "hero_id": 1}])])
        self.assertEqual((skipped, self._rows()), (1, []))


class StatsIdTests(unittest.TestCase):
    def test_fetched_game_uses_match_id(self):
        self.assertEqual(stats_id({"match_id": 107356285}), 107356285)

    def test_na_and_forfeit_use_placeholder(self):
        self.assertEqual(stats_id({"match_id": 51316473, "unavailable": True, "placeholder_id": -9}), -9)
        self.assertEqual(stats_id({"match_id": None, "forfeit": True, "placeholder_id": 11}), 11)

    def test_missing_ids_give_none(self):
        self.assertIsNone(stats_id({"match_id": None}))
        self.assertIsNone(stats_id({"unavailable": True}))

    def test_match_ids_include_placeholders(self):
        ev = {"series": [{"games": [{"match_id": 101}, {"forfeit": True, "placeholder_id": -3}]}]}
        self.assertEqual(match_ids(ev), [101, -3])


class CleanGamesTests(unittest.TestCase):
    """The save endpoint's input cleaning: every game needs a picked winner."""

    @classmethod
    def setUpClass(cls):
        from backend.app.blueprints.brackets import _clean_games
        cls.clean = staticmethod(_clean_games)

    def test_game_keeps_winner_and_drops_side(self):
        games = self.clean([{"match_id": "107356285", "winner": "team_a", "team_a_side": 1}])
        self.assertEqual(games, [{"game": 1, "match_id": 107356285, "winner": "team_a"}])

    def test_game_without_winner_is_rejected(self):
        with self.assertRaises(ValueError):
            self.clean([{"match_id": "107356285"}])

    def test_forfeit_needs_winner_but_no_id(self):
        games = self.clean([{"forfeit": True, "winner": "team_b"}])
        self.assertEqual(games[0]["winner"], "team_b")
        self.assertIsNone(games[0]["match_id"])

    def test_na_game_keeps_optional_id_and_needs_winner(self):
        games = self.clean([{"match_id": "51316473", "unavailable": True, "winner": "team_a"}])
        self.assertEqual(games[0], {"game": 1, "match_id": 51316473, "unavailable": True, "winner": "team_a"})
        with self.assertRaises(ValueError):
            self.clean([{"unavailable": True}])

    def test_placeholder_id_survives_only_for_na_and_forfeits(self):
        games = self.clean([
            {"unavailable": True, "winner": "team_a", "placeholder_id": -5},
            {"match_id": "7", "winner": "team_b", "placeholder_id": -6},
        ])
        self.assertEqual(games[0]["placeholder_id"], -5)
        self.assertNotIn("placeholder_id", games[1])

    def test_bans_keep_their_slot_when_an_earlier_slot_is_empty(self):
        games = self.clean([{"match_id": "7", "winner": "team_a", "bans": [
            {"order": 1, "team": "team_b", "hero_id": "12"},
            {"order": 2, "team": "team_a", "hero_id": ""},
            {"order": 3, "team": "team_b", "hero_id": 3},
        ]}])
        self.assertEqual(games[0]["bans"], [
            {"order": 1, "team": "team_b", "hero_id": 12},
            {"order": 3, "team": "team_b", "hero_id": 3},
        ])

    def test_three_bans_for_one_team_are_rejected(self):
        with self.assertRaises(ValueError):
            self.clean([{"match_id": "7", "winner": "team_a",
                         "bans": [{"team": "team_a", "hero_id": h} for h in (1, 2, 3)]}])

    def test_same_hero_banned_twice_is_rejected(self):
        with self.assertRaises(ValueError):
            self.clean([{"match_id": "7", "winner": "team_a",
                         "bans": [{"team": "team_a", "hero_id": 1}, {"team": "team_b", "hero_id": 1}]}])

    def test_game_without_bans_has_no_bans_key(self):
        self.assertNotIn("bans", self.clean([{"match_id": "7", "winner": "team_a", "bans": []}])[0])

    def test_empty_rows_are_skipped(self):
        self.assertEqual(self.clean([{"match_id": ""}, {}]), [])


if __name__ == "__main__":
    unittest.main()
