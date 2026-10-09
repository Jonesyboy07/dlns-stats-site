"""MatchAdmin writes games to data/brackets.json; the stats readers derive their tree from it."""
import copy
import unittest

from backend.app.blueprints import brackets as bkmod
from backend.app.utils import brackets as bk


def _data():
    return {"events": []}


def _place(data, mid, winner="team_a", a="Abrahams", b="Leviathan", **kw):
    args = dict(title="Night Shift", week=58, region="EU", set_title="Finals", team_a=a, team_b=b, vod="")
    args.update(kw)
    return bkmod.place_game(data, game=bkmod.make_game(mid, winner), **args)


class PlaceGameTests(unittest.TestCase):
    def test_creates_event_series_and_numbers_games(self):
        d = _data()
        _place(d, 101)
        _place(d, 102, "team_b")
        series = d["events"][0]["series"]
        self.assertEqual(len(series), 1)
        self.assertEqual([g["game"] for g in series[0]["games"]], [1, 2])

    def test_reversed_teams_flip_winner(self):
        d = _data()
        _place(d, 101)
        _place(d, 102, "team_a", a="Leviathan", b="Abrahams")
        games = d["events"][0]["series"][0]["games"]
        self.assertEqual(games[1]["winner"], "team_b")

    def test_move_keeps_bans_and_removes_old(self):
        d = _data()
        _place(d, 101)
        d["events"][0]["series"][0]["games"][0]["bans"] = [{"order": 1, "team": "team_a", "hero_id": 3}]
        moved = bkmod.make_game(202, "team_a")
        bkmod.place_game(d, title="Night Shift", week=58, region="EU", set_title="", team_a="Abrahams",
                         team_b="Leviathan", vod="", game=moved, old_id=101)
        games = d["events"][0]["series"][0]["games"]
        self.assertEqual([g["match_id"] for g in games], [202])
        self.assertTrue(games[0]["bans"])

    def test_schedule_view(self):
        d = _data()
        _place(d, 101)
        _place(d, 102, "team_b")
        sched = bk.to_schedule(copy.deepcopy(d["events"]))
        game = sched["series"][0]["weeks"][0]["games"][0]
        self.assertEqual([m["match_id"] for m in game["matches"]], [101, 102])
        self.assertEqual(game["title"], "Finals")

    def test_forfeit_uses_placeholder(self):
        d = _data()
        bkmod.place_game(d, title="T", week=1, region="", set_title="", team_a="A", team_b="B", vod="",
                         game=bkmod.make_game(None, "team_a", forfeit=True, placeholder_id=-5))
        g = d["events"][0]["series"][0]["games"][0]
        self.assertEqual(bk.stats_id(g), -5)


if __name__ == "__main__":
    unittest.main()
