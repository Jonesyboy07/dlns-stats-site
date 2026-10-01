"""Tests for bracket generation and result computation (backend/app/utils/brackets.py).

All pure functions: generators build the empty structure, and ``compute`` turns
a ``{match_id: winning slot}`` map into scores, winners and advancement.
"""

import unittest

from backend.app.utils.brackets import BYE, compute, generate, generate_gauntlet, generate_single_elim, match_ids


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

    def test_match_ids_skips_placeholders(self):
        self.ev["series"][0]["games"].append({"match_id": None})
        self.ev["series"][0]["games"].append({"match_id": -5})
        self.assertEqual(match_ids(self.ev), [101, 201, 202])


if __name__ == "__main__":
    unittest.main()
