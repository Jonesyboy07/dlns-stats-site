"""Tests for _upsert_matches_json (backend/app/blueprints/admin.py).

Re-saving a match must update the set that already holds it, even when the
team names arrive with different casing or in the other order, instead of
adding a second copy of the same match ID.
"""

import json
import tempfile
import unittest
from pathlib import Path

from backend.app.blueprints.admin import _upsert_matches_json


def _item(match_id, team_a="Leviathan", team_b="Abrahams", side=0, **extra):
    return {
        "team_a": team_a,
        "team_b": team_b,
        "match_id": match_id,
        "game_label": "Game 1",
        "team_a_side": side,
        **extra,
    }


class UpsertMatchesJsonTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.path = Path(self.tmp.name) / "matches.json"
        self.path.write_text(json.dumps({
            "series": [{
                "title": "Night Shift",
                "weeks": [{
                    "week": 58,
                    "games": [{
                        "team_a": "LEVIATHAN",
                        "team_b": "ABRAHAMS",
                        "matches": [{"game": "Game 1", "team_a_side": 0, "match_id": 101}],
                        "region": "EU",
                    }],
                }],
            }],
        }), encoding="utf-8")

    def tearDown(self):
        self.tmp.cleanup()

    def _sets(self):
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return data["series"][0]["weeks"][0]["games"]

    def _ids(self):
        return [m["match_id"] for s in self._sets() for m in s["matches"]]

    def test_resave_with_different_casing_updates_existing_set(self):
        _upsert_matches_json(self.path, "Night Shift", 58, [], [_item(101, set_title="Finals")])
        sets = self._sets()
        self.assertEqual(len(sets), 1)
        self.assertEqual(self._ids(), [101])
        # The saved names win, so a casing fix reaches matches.json.
        self.assertEqual((sets[0]["team_a"], sets[0]["title"]), ("Leviathan", "Finals"))

    def test_resave_with_swapped_teams_flips_side(self):
        # Abrahams as team A on side 1 means Leviathan (stored team A) was on side 0.
        _upsert_matches_json(self.path, "Night Shift", 58, [], [_item(101, "Abrahams", "Leviathan", side=1)])
        sets = self._sets()
        self.assertEqual(self._ids(), [101])
        self.assertEqual((sets[0]["team_a"], sets[0]["team_b"]), ("Leviathan", "Abrahams"))
        self.assertEqual(sets[0]["matches"][0]["team_a_side"], 0)

    def test_renamed_team_updates_the_set_holding_the_match(self):
        _upsert_matches_json(self.path, "Night Shift", 58, [], [_item(101, "Leviathan", "Abrahams Esports")])
        sets = self._sets()
        self.assertEqual(len(sets), 1)
        self.assertEqual(sets[0]["team_b"], "Abrahams Esports")

    def test_new_match_joins_set_with_same_teams_in_other_casing(self):
        _upsert_matches_json(self.path, "Night Shift", 58, [], [_item(102)])
        self.assertEqual(len(self._sets()), 1)
        self.assertEqual(self._ids(), [101, 102])

    def test_new_teams_still_create_a_new_set(self):
        _upsert_matches_json(self.path, "Night Shift", 58, [], [_item(201, "Melee Creeps", "Floormen")])
        self.assertEqual(len(self._sets()), 2)


if __name__ == "__main__":
    unittest.main()
