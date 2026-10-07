"""Tests for the Night Shift week endpoint's helpers.

The vod helpers normalise the two shapes `matches.json` records the week's
broadcast in, and `match_bans` may be absent from databases written before bans
were tracked, so the endpoint has to degrade to "no bans" rather than fail.
"""

import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.blueprints.db_api import _stream_vod
from backend.app.main_web import create_app


class StreamVodTests(unittest.TestCase):
    def test_reads_a_bare_vod_link(self):
        # Early weeks: a single URL string.
        self.assertEqual(
            _stream_vod("https://youtu.be/SVTJahJGYJ0", []),
            {"url": "https://youtu.be/SVTJahJGYJ0", "title": ""},
        )

    def test_reads_a_vod_links_entry(self):
        # Later weeks: a list of {title, url}.
        self.assertEqual(
            _stream_vod(None, [{"title": "", "url": "https://www.youtube.com/watch?v=grrTc1ZQIjk"}]),
            {"url": "https://www.youtube.com/watch?v=grrTc1ZQIjk", "title": ""},
        )

    def test_prefers_the_bare_link_when_both_are_present(self):
        chosen = _stream_vod("https://youtu.be/one", [{"url": "https://youtu.be/two"}])
        self.assertEqual(chosen["url"], "https://youtu.be/one")

    def test_skips_entries_without_a_url(self):
        chosen = _stream_vod(None, [{"title": "no url"}, {"url": "https://youtu.be/real"}])
        self.assertEqual(chosen["url"], "https://youtu.be/real")

    def test_is_none_when_the_week_recorded_no_broadcast(self):
        # Week 38 has neither shape.
        self.assertIsNone(_stream_vod(None, []))
        self.assertIsNone(_stream_vod(None, None))
        self.assertIsNone(_stream_vod("", None))


class NightshiftBansRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")
        }
        # mkdtemp + ignore_errors on cleanup: Windows keeps the SQLite handle open
        # past the request, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-bans-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        self._write(
            """
            INSERT INTO users (account_id, persona_name) VALUES (101, 'Kaizen');
            INSERT INTO matches (match_id, duration_s, winning_team, event_title, event_week,
                event_team_a, event_team_b, event_game, event_team_a_ingame_side, event_region,
                event_subtitle) VALUES
                (11, 1800, 0, 'Night Shift', 58, 'Melee Creeps', 'Pulsar Esports', 'Game 1', 0, 'NA', 'FINALS'),
                (12, 1700, 0, 'Night Shift', 59, 'Melee Creeps', 'Pulsar Esports', 'Game 1', 0, 'NA', 'FINALS');
            INSERT INTO players (match_id, account_id, player_slot, team, hero_id)
                VALUES (11, 101, 1, 0, 13);
            """
        )

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _write(self, script):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript(script)
            conn.commit()
        finally:
            conn.close()

    def test_week_without_a_match_bans_table_returns_no_bans(self):
        # `db_init` creates the table, so drop it to reach the endpoint's guard
        # for databases written before bans were tracked.
        self._write("DROP TABLE match_bans;")

        response = self.client.get("/db/nightshift/58?event_title=Night%20Shift")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["matches"][0]["bans"], [])

    def test_week_returns_bans_ordered_with_resolved_hero_names(self):
        self._write(
            """
            INSERT INTO match_bans (match_id, ban_order, team, team_name, hero_id) VALUES
                (12, 2, 'team_b', 'Pulsar Esports', 7),
                (12, 1, 'team_a', 'Melee Creeps', 2);
            """
        )

        response = self.client.get("/db/nightshift/59?event_title=Night%20Shift")

        self.assertEqual(response.status_code, 200)
        bans = response.get_json()["matches"][0]["bans"]
        self.assertEqual([ban["ban_order"] for ban in bans], [1, 2])
        self.assertEqual([ban["hero_name"] for ban in bans], ["Seven", "Wraith"])
        self.assertEqual(bans[0]["team"], "team_a")


if __name__ == "__main__":
    unittest.main()
