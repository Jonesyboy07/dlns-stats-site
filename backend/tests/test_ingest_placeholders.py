"""Placeholder match ids must never be fetched.

Forfeit and unavailable games are filed in `data/brackets.json` under negative
placeholder ids. The match API answers those with a 400, and every attempt spends
the ingest's small request quota, so the fetcher has to leave them alone while
`-metasync` keeps syncing the metadata authored for those rows.
"""

import contextlib
import importlib.util
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
_SPEC = importlib.util.spec_from_file_location('dlns_main', _BACKEND / 'main.py')
main_mod = importlib.util.module_from_spec(_SPEC)
sys.modules['dlns_main'] = main_mod
_SPEC.loader.exec_module(main_mod)


class SplitPlaceholderIdsTests(unittest.TestCase):
    def test_real_ids_survive_and_placeholders_are_reported_once(self):
        fetchable, placeholders = main_mod.split_placeholder_ids([1, -5, 2, -5, -6])
        self.assertEqual(fetchable, [1, 2])
        self.assertEqual(placeholders, [-5, -6])

    def test_plan_without_placeholders_is_untouched(self):
        self.assertEqual(main_mod.split_placeholder_ids([7, 8]), ([7, 8], []))


class PlaceholderOnlyPlanTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = Path(tempfile.mkdtemp(prefix='dlns-placeholder-'))
        self.feed = self.tmpdir / 'feed.json'
        self.feed.write_text(
            json.dumps({'title': 'Night Shift', 'weeks': [{'week': 57, 'match_ids': [-1, -2]}]}),
            encoding='utf-8',
        )
        self.status = self.tmpdir / 'status.json'
        self.db = self.tmpdir / 'dlns.sqlite3'
        self.cache = self.tmpdir / 'cache.json'

    def test_an_all_placeholder_plan_touches_nothing(self):
        out = io.StringIO()
        with contextlib.redirect_stdout(out):
            rc = main_mod.main([
                '-matchfile', str(self.feed),
                '-db', str(self.db),
                '-status', str(self.status),
                '-cache', str(self.cache),
            ])
        self.assertEqual(rc, 0)
        self.assertIn('Skipping 2 placeholder match id(s)', out.getvalue())
        self.assertFalse(self.db.exists())
        self.assertFalse(self.status.exists())


if __name__ == '__main__':
    unittest.main()
