import os
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class PrerenderContentTests(unittest.TestCase):
    """Key public pages must carry real text and links before React runs."""

    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP", "BASE_URL", "SEO_PRERENDER")
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmp.name) / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["BASE_URL"] = "https://example.test"
        os.environ["SEO_PRERENDER"] = "1"

        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()
        self._seed()

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def _seed(self):
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executemany(
                "INSERT INTO users (account_id, persona_name) VALUES (?, ?)",
                [
                    (1, "Alpha <script>alert(1)</script>"),
                    (2, "Bravo Two"),
                    (3, "Opponent Only"),
                ],
            )
            conn.executemany(
                "INSERT INTO matches (match_id, event_title, event_week, event_team_a, "
                "event_team_b, event_game, event_team_a_ingame_side, winning_team, start_time) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (5001, "Night Shift", 3, "Alpha", "Bravo", "Game 1", 0, 0, "2025-08-14T00:04:30Z"),
                    (5002, "Night Shift", 3, "Alpha", "Bravo", "Game 2", 1, 0, "2025-08-14T01:10:00Z"),
                ],
            )
            conn.executemany(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, "
                "kills, deaths, assists, net_worth, player_damage, result) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (5001, 1, 1, 0, 1, 5, 2, 3, 30000, 40000, "Win"),
                    (5001, 2, 7, 1, 2, 1, 6, 2, 22000, 18000, "Loss"),
                    (5001, 3, 8, 1, 2, 2, 7, 1, 20000, 15000, "Loss"),
                    (5002, 1, 6, 1, 2, 3, 5, 4, 26000, 27000, "Loss"),
                    (5002, 2, 2, 0, 1, 8, 1, 6, 38000, 45000, "Win"),
                    (5002, 3, 1, 0, 1, 4, 4, 5, 25000, 21000, "Win"),
                ],
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _root(html):
        match = re.search(r'<div id="root">(.*?)</div>\s*<script>', html, re.S)
        return match.group(1) if match else ""

    def test_match_page_has_teams_players_and_links(self):
        root = self._root(self.client.get("/matches/5001").get_data(as_text=True))

        self.assertIn("<h1>Alpha vs Bravo</h1>", root)
        self.assertIn("Alpha won", root)
        self.assertIn('href="/player/1"', root)
        self.assertIn('href="/hero/1"', root)
        self.assertIn('href="/week/3"', root)
        self.assertIn('href="/series/5001"', root)
        self.assertIn('class="prerender-breadcrumb"', root)
        self.assertIn('aria-current="page"', root)

    def test_breadcrumb_trail_is_crawlable(self):
        for path, expected in {
            "/player/1": ('href="/players"', "Alpha &lt;script&gt;"),
            "/hero/1": ('href="/heroes"', "Infernus"),
            "/team/Alpha": ('href="/teams"', "Alpha"),
            "/week/3": ('href="/week"', "Week 3"),
        }.items():
            with self.subTest(path=path):
                root = self._root(self.client.get(path).get_data(as_text=True))
                self.assertIn("prerender-breadcrumb", root)
                self.assertIn(expected[0], root)
                self.assertIn(expected[1], root)

    def test_split_alias_renders_the_same_match_content(self):
        root = self._root(self.client.get("/match/5001").get_data(as_text=True))
        self.assertIn("<h1>Alpha vs Bravo</h1>", root)

    def test_player_page_lists_recent_matches_and_hero_pool(self):
        root = self._root(self.client.get("/player/1").get_data(as_text=True))

        self.assertIn("<h1>Alpha &lt;script&gt;alert(1)&lt;/script&gt;</h1>", root)
        self.assertNotIn("<script>alert(1)</script>", root)
        self.assertIn('href="/player/1/hero/1"', root)
        self.assertIn('href="/matches/5002"', root)
        self.assertIn("Alpha vs Bravo", root)

    def test_team_page_roster_excludes_opponents(self):
        root = self._root(self.client.get("/team/Alpha").get_data(as_text=True))

        self.assertIn("<h1>Alpha</h1>", root)
        self.assertIn("2 games, 1 win and 1 loss", root)
        self.assertIn('href="/player/1"', root)
        self.assertIn("Bravo", root)
        self.assertNotIn('href="/player/3"', root)

    def test_week_page_lists_matches_and_teams(self):
        root = self._root(self.client.get("/week/3").get_data(as_text=True))

        self.assertIn("<h1>Night Shift Week 3</h1>", root)
        self.assertIn('href="/matches/5001"', root)
        self.assertIn('href="/matches/5002"', root)
        self.assertIn('href="/team/Alpha"', root)
        self.assertIn("<td>Bravo</td>", root)

    def test_index_pages_have_crawlable_links(self):
        expectations = {
            "/": 'href="/matches/5002"',
            "/matchlist": 'href="/players"',
            "/players": 'href="/player/1"',
            "/teams": 'href="/team/Alpha"',
            "/heroes": 'href="/hero/1"',
            "/week": 'href="/week/3"',
        }
        for path, expected in expectations.items():
            with self.subTest(path=path):
                root = self._root(self.client.get(path).get_data(as_text=True))
                self.assertIn(expected, root)

    def test_admin_and_search_pages_are_not_prerendered(self):
        for path in ("/search", "/react-admin"):
            with self.subTest(path=path):
                root = self._root(self.client.get(path).get_data(as_text=True))
                self.assertEqual(root, "")

    def test_interview_pages_prerender_as_escaped_text(self):
        import json
        from unittest.mock import patch

        from backend.app.blueprints import interviews

        data_dir = Path(self.tmp.name) / "interviews-data"
        markdown_dir = data_dir / "markdown"
        markdown_dir.mkdir(parents=True)
        index_file = data_dir / "entries.json"
        index_file.write_text(
            json.dumps(
                [
                    {
                        "id": "interview-1",
                        "short_id": "7",
                        "filename": "interview-1.md",
                        "title": "Talking Night Shift",
                        "guest": "A Player",
                        "created_at": "2025-08-14T00:04:30Z",
                    }
                ]
            ),
            encoding="utf-8",
        )
        (markdown_dir / "interview-1.md").write_text(
            "<script>alert(1)</script> Hello **world** from the interview.",
            encoding="utf-8",
        )

        with patch.object(interviews, "DATA_DIR", data_dir), patch.object(
            interviews, "MARKDOWN_DIR", markdown_dir
        ), patch.object(interviews, "INDEX_FILE", index_file), patch.object(
            interviews, "CUSTOM_LINKS_FILE", data_dir / "custom_links.json"
        ):
            detail = self._root(
                self.client.get("/interviews/7").get_data(as_text=True)
            )
            index = self._root(
                self.client.get("/interviews/").get_data(as_text=True)
            )

        self.assertIn("<h1>Talking Night Shift</h1>", detail)
        self.assertIn("Hello world from the interview.", detail)
        self.assertNotIn("<script>alert(1)</script>", detail)
        self.assertIn('href="/interviews/7"', index)

    def test_prerender_can_be_disabled(self):
        self.app.config["SEO_PRERENDER"] = "0"
        root = self._root(self.client.get("/matches/5001").get_data(as_text=True))
        self.assertEqual(root, "")


if __name__ == "__main__":
    unittest.main()
