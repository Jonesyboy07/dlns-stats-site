"""Tests for scripts/migrate_brackets.py: turning matches.json weeks into gauntlet events."""

import importlib.util
import unittest
from pathlib import Path

_spec = importlib.util.spec_from_file_location(
    'migrate_brackets', Path(__file__).resolve().parents[2] / 'scripts' / 'migrate_brackets.py'
)
mb = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mb)


def _set(team_a, team_b, ids, title=None, region='EU'):
    s = {'team_a': team_a, 'team_b': team_b, 'region': region,
         'matches': [{'game': f'Game {i}', 'team_a_side': 0, 'match_id': mid} for i, mid in enumerate(ids, start=1)]}
    if title:
        s['title'] = title
    return s


# Side 0 is team A in every set above, so winning_team 0 means team A won.
RESULTS = {101: 1, 201: 0, 202: 0, 301: 0}


def _data(*sets, week=58):
    return {'series': [{'title': 'Night Shift', 'weeks': [{'week': week, 'games': list(sets)}]}]}


class LadderTests(unittest.TestCase):
    def test_untitled_finals_listed_first_is_still_the_finals(self):
        finals = _set('Leviathan', 'Abrahams', [201, 202])
        challenger = _set('Buff Enjoyers', 'Abrahams', [101], title='Challenger Match')
        out = mb.migrate(_data(finals, challenger), RESULTS, 'Night Shift')
        ev = out['events'][0]
        self.assertEqual([r['name'] for r in ev['rounds']], ['Challenger', 'Finals'])
        self.assertEqual(ev['series'][0]['team_a'], 'Buff Enjoyers')
        self.assertEqual(ev['series'][1]['games'][0]['winner'], 'team_a')
        self.assertEqual(ev['id'], 'night-shift-w58-eu')
        self.assertEqual(ev['source'], 'matches.json')

    def test_winner_missing_from_next_set_goes_to_review(self):
        challenger = _set('Buff Enjoyers', 'Abrahams', [101], title='Challenger Match')  # Abrahams win
        finals = _set('Leviathan', 'Lowkey W', [201])
        out = mb.migrate(_data(challenger, finals), RESULTS, 'Night Shift')
        self.assertEqual(out['events'], [])
        self.assertEqual(out['review'][0]['why'], 'no ordering fits the results')

    def test_missing_region_is_taken_from_the_teams(self):
        sets = [_set('Buff Enjoyers', 'Abrahams', [101], title='Challenger'), _set('Leviathan', 'Abrahams', [201, 202], region='')]
        out = mb.migrate(_data(*sets), RESULTS, 'Night Shift')
        self.assertEqual(len(out['events']), 1)
        self.assertTrue(any('region inferred' in n for n in out['report'][0]['notes']))


class GameTests(unittest.TestCase):
    def test_games_follow_their_labels_and_forfeits_drop_the_id(self):
        s = _set('Leviathan', 'Abrahams', [])
        s['matches'] = [
            {'game': 'Game 3', 'team_a_side': 0, 'match_id': 11, 'forfeit': True},
            {'game': 'Game 1', 'team_a_side': 0, 'match_id': 201},
        ]
        ev, _ = mb.build_event('Night Shift', 58, 'EU', [s], {201: 0, 11: 1}, 0)
        games = ev['series'][0]['games']
        self.assertEqual([g['match_id'] for g in games], [201, None])
        self.assertEqual(games[1], {'game': 2, 'match_id': None, 'forfeit': True, 'placeholder_id': 11, 'winner': 'team_b'})

    def test_negative_placeholder_becomes_na_and_keeps_its_stats_id(self):
        s = _set('Leviathan', 'Abrahams', [-783717274388], title='Qualifiers')
        ev, _ = mb.build_event('Night Shift', 46, 'NA', [s], {-783717274388: 0}, 0)
        g = ev['series'][0]['games'][0]
        self.assertEqual((g['match_id'], g['unavailable'], g['placeholder_id'], g['winner']),
                         (None, True, -783717274388, 'team_a'))

    def test_real_id_without_player_data_becomes_na(self):
        s = _set('Floormen', 'Bunny with Clock', [51316473], title='Challenger')
        ev, notes = mb.build_event('Night Shift', 22, 'NA', [s], {51316473: 0}, 0, empty_ids={51316473})
        g = ev['series'][0]['games'][0]
        self.assertEqual((g['match_id'], g['unavailable'], g['placeholder_id']), (51316473, True, 51316473))
        self.assertTrue(any('marked N/A' in n for n in notes))

    def test_extra_games_widen_the_best_of(self):
        s = _set('Leviathan', 'Abrahams', [201, 202, 301], title='Challenger')
        ev, _ = mb.build_event('Night Shift', 58, 'EU', [s], {201: 0, 202: 1, 301: 0}, 0)
        self.assertEqual(ev['series'][0]['best_of'], 3)

    def test_game_without_result_is_noted(self):
        s = _set('Leviathan', 'Abrahams', [999], title='Finals')
        ev, notes = mb.build_event('Night Shift', 58, 'EU', [s], {}, 0)
        self.assertNotIn('winner', ev['series'][0]['games'][0])
        self.assertTrue(any('no result in DB' in n for n in notes))



class FixesTests(unittest.TestCase):
    def setUp(self):
        self.challenger = _set('Abrahams', 'Leviathan', [101], title='Challenger Match')  # Leviathan win 101
        self.finals = _set('Lowkey W', 'Leviathan', [201, 202])

    def test_dq_sends_the_other_team_through(self):
        # Abrahams win the Challenger (team_a) but are disqualified; Leviathan play the Finals.
        results = {101: 0, 201: 0, 202: 0}
        fixes = [{'type': 'dq', 'week': 58, 'teams': ['abrahams', 'LEVIATHAN'], 'team': 'Abrahams', 'after_game': 1}]
        out = mb.migrate(_data(self.challenger, self.finals), results, 'Night Shift', fixes=fixes)
        self.assertEqual(out['fixes'][0][0], 'applied')
        ev = out['events'][0]
        self.assertEqual(ev['series'][0]['outcome']['team'], 'team_a')
        self.assertEqual(ev['series'][0]['outcome']['played_games'], 'keep')

    def test_winner_fix_fills_a_missing_result(self):
        s = _set('Get Candy', 'Work In Progress', [-5], title='Qualifiers')
        out = mb.migrate(_data(s), {}, 'Night Shift', fixes=[{'type': 'winner', 'match_id': -5, 'winner': 'GET CANDY'}])
        self.assertEqual(out['events'][0]['series'][0]['games'][0]['winner'], 'team_a')

    def test_region_fix_moves_a_set(self):
        s = _set('Bird With Clock', 'FPS Lounge', [101], title='Challenger', region='EU')
        out = mb.migrate(_data(s), {101: 1}, 'Night Shift',
                         fixes=[{'type': 'region', 'week': 58, 'teams': ['Bird With Clock', 'FPS Lounge'], 'to': 'na'}])
        self.assertEqual(out['events'][0]['region'], 'NA')

    def test_order_fix_picks_between_fitting_orders(self):
        a = _set('Bird', 'FPS', [101])
        b = _set('Melee', 'FPS', [201])
        results = {101: 1, 201: 1}  # FPS win both, so both orders fit
        self.assertEqual(len(mb.migrate(_data(a, b), results, 'Night Shift')['review']), 1)
        fixes = [{'type': 'order', 'week': 58, 'region': 'EU', 'sets': [['Bird', 'FPS'], ['Melee', 'FPS']]}]
        ev = mb.migrate(_data(a, b), results, 'Night Shift', fixes=fixes)['events'][0]
        self.assertEqual(ev['series'][0]['team_a'], 'Bird')

    def test_disabled_and_unmatched_fixes_are_reported(self):
        fixes = [
            {'type': 'winner', 'match_id': 1, 'winner': 'X', 'disabled': True},
            {'type': 'region', 'week': 58, 'teams': ['Nobody', 'Else'], 'to': 'NA'},
        ]
        out = mb.migrate(_data(self.challenger), {101: 1}, 'Night Shift', fixes=fixes)
        self.assertEqual([state for state, _ in out['fixes']], ['disabled', 'not matched'])

    def test_fixes_never_change_the_input(self):
        data = _data(self.challenger)
        before = repr(data)
        mb.migrate(data, {101: 1}, 'Night Shift', fixes=[{'type': 'winner', 'match_id': 101, 'winner': 'Abrahams'}])
        self.assertEqual(repr(data), before)

if __name__ == '__main__':
    unittest.main()
