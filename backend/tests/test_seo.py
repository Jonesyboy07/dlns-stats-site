import os
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class SeoMetadataTests(unittest.TestCase):
    """The React shell must expose real metadata before JavaScript runs."""

    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP", "BASE_URL")
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmp.name) / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["BASE_URL"] = "https://example.test"

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
            conn.execute(
                "INSERT INTO matches (match_id, duration_s, event_title, event_week, "
                "event_team_a, event_team_b, event_game, start_time) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                (900002, 1800, "Night Shift", 7, "Alpha", "Bravo", "Game 1", "2025-08-14T00:04:30Z"),
            )
            conn.execute(
                "INSERT INTO matches (match_id, event_title, event_week, event_team_a, "
                "event_team_b, event_game) VALUES (?, ?, ?, ?, ?, ?)",
                (-1, "Night Shift", 7, "Ghost", "Placeholder", "Game 1"),
            )
            conn.executemany(
                "INSERT INTO users (account_id, persona_name) VALUES (?, ?)",
                [(42, "Nova"), (43, "No Games"), (44, "Placeholder Only")],
            )
            conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (900002, 42, 1, 0, 1, "Win"),
            )
            conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result) "
                "VALUES (?, ?, ?, ?, ?, ?)",
                (-1, 44, 1, 0, 99, "Win"),
            )
            conn.commit()
        finally:
            conn.close()

    @staticmethod
    def _content(html, pattern):
        match = re.search(pattern, html, re.S)
        return match.group(1) if match else None

    def test_static_page_has_title_description_and_canonical(self):
        html = self.client.get("/players").get_data(as_text=True)

        self.assertIn("Deadlock Player Stats &amp; Leaderboards", html)
        self.assertIn(
            '<link rel="canonical" href="https://example.test/players">', html
        )
        self.assertIn('<meta name="description" content="Deadlock Night Shift player', html)
        self.assertIn('<meta property="og:title"', html)
        self.assertIn('<meta name="twitter:card" content="summary_large_image">', html)

    def test_aliases_canonicalise_to_preferred_urls(self):
        cases = {
            "/home": "https://example.test/",
            "/match/900002": "https://example.test/matches/900002",
            "/users/42": "https://example.test/player/42",
            "/stats/": "https://example.test/stats/",
            "/interviews/": "https://example.test/interviews/",
        }

        for path, expected in cases.items():
            with self.subTest(path=path):
                html = self.client.get(path).get_data(as_text=True)
                self.assertIn(f'<link rel="canonical" href="{expected}">', html)

    def test_match_page_builds_teams_title_and_event_jsonld(self):
        html = self.client.get("/matches/900002").get_data(as_text=True)

        self.assertIn("<title>Alpha vs Bravo — Week 7 Game 1 • DLNS Stats</title>", html)
        jsonld = self._content(
            html, r'<script type="application/ld\+json">(.*?)</script>'
        )
        self.assertIsNotNone(jsonld)
        self.assertIn('"@type":"SportsEvent"', jsonld)
        self.assertIn('"homeTeam":{"@type":"SportsTeam","name":"Alpha"}', jsonld)
        self.assertIn('"startDate":"2025-08-14T00:04:30+00:00"', jsonld)
        self.assertIn('"@type":"BreadcrumbList"', jsonld)
        self.assertIn('"name":"Night Shift Week 7"', jsonld)

    def test_breadcrumb_jsonld_is_valid_and_hierarchical(self):
        import json

        html = self.client.get("/player/42").get_data(as_text=True)
        raw = self._content(html, r'<script type="application/ld\+json">(.*?)</script>')
        data = json.loads(raw)
        nodes = data.get("@graph", [data])
        breadcrumb = next(node for node in nodes if node.get("@type") == "BreadcrumbList")
        names = [item["name"] for item in breadcrumb["itemListElement"]]
        self.assertEqual(names, ["Home", "Players", "Nova"])
        self.assertEqual(
            [item["position"] for item in breadcrumb["itemListElement"]], [1, 2, 3]
        )
        self.assertTrue(
            all(item["item"].startswith("https://example.test/") for item in breadcrumb["itemListElement"])
        )

    def test_player_page_uses_persona_and_profile_jsonld(self):
        html = self.client.get("/player/42").get_data(as_text=True)

        self.assertIn("<title>Nova — Deadlock Player Stats • DLNS Stats</title>", html)
        self.assertIn(
            "<link rel=\"canonical\" href=\"https://example.test/player/42\">", html
        )
        jsonld = self._content(
            html, r'<script type="application/ld\+json">(.*?)</script>'
        )
        self.assertIn('"@type":"ProfilePage"', jsonld)
        self.assertIn('"name":"Nova"', jsonld)

    def test_missing_detail_pages_return_real_404s(self):
        cases = {
            "/matches/999999": "Match not found",
            "/match/999999": "Match not found",
            "/series/999999": "Series not found",
            "/player/999999": "Player not found",
            "/users/999999": "Player not found",
            "/player/42/hero/999999": "Player hero page not found",
            "/hero/999999": "Hero not found",
            "/team/No%20Such%20Team": "Team not found",
            "/week/99999": "Week not found",
        }

        for path, expected_title in cases.items():
            with self.subTest(path=path):
                response = self.client.get(path)
                html = response.get_data(as_text=True)
                self.assertEqual(response.status_code, 404)
                self.assertIn(f"<title>{expected_title}", html)
                self.assertIn('<meta name="robots" content="noindex, follow">', html)

    def test_valid_pages_keep_their_200_status(self):
        cases = ["/matches/900002", "/player/42", "/hero/1", "/team/Alpha", "/week/7"]
        for path in cases:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_player_without_games_is_still_indexable(self):
        response = self.client.get("/player/43")
        html = response.get_data(as_text=True)
        self.assertEqual(response.status_code, 200)
        self.assertIn("<title>No Games — Deadlock Player Stats", html)

    def test_admin_and_search_pages_are_noindex(self):
        # /admin/* is auth-protected, so the public admin shell is /react-admin.
        for path in ("/react-admin", "/react-admin/site-banner", "/search"):
            with self.subTest(path=path):
                html = self.client.get(path).get_data(as_text=True)
                self.assertIn('<meta name="robots" content="noindex, follow">', html)

    def test_sitemap_lists_canonical_urls_only(self):
        xml = self.client.get("/sitemap.xml?flush=1").get_data(as_text=True)

        self.assertIn("https://example.test/player/42", xml)
        self.assertIn("https://example.test/matches/900002", xml)
        self.assertIn("https://example.test/hero/1", xml)
        self.assertIn("https://example.test/team/Alpha", xml)
        self.assertIn("https://example.test/week/7", xml)
        self.assertIn("https://example.test/stats/", xml)
        self.assertNotIn("/users/42", xml)
        self.assertNotIn("https://example.test/search", xml)
        self.assertNotIn("https://example.test/dlns/", xml)

    def test_sitemap_excludes_thin_and_placeholder_urls(self):
        xml = self.client.get("/sitemap.xml?flush=1").get_data(as_text=True)

        # Users with no recorded games, placeholder matches and their teams/heroes.
        self.assertNotIn("https://example.test/player/43", xml)
        self.assertNotIn("https://example.test/player/44", xml)
        self.assertNotIn("https://example.test/matches/-1", xml)
        self.assertNotIn("/team/Ghost", xml)
        self.assertNotIn("/hero/2", xml)  # known hero, but no appearances
        self.assertNotIn("/hero/99", xml)

    def test_every_sitemap_url_returns_200(self):
        from urllib.parse import urlparse

        xml = self.client.get("/sitemap.xml?flush=1").get_data(as_text=True)
        locations = re.findall(r"<loc>(.*?)</loc>", xml)
        self.assertGreater(len(locations), 5)

        for location in locations:
            path = urlparse(location).path or "/"
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)


if __name__ == "__main__":
    unittest.main()
