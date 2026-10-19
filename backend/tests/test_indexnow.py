import os
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from backend.app.indexnow import recent_paths, submit_urls
from backend.app.main_web import create_app

KEY = "testkey123"


class IndexNowTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in (
                "DB_PATH",
                "CACHE_DIR",
                "CACHE_WARMUP_ON_STARTUP",
                "BASE_URL",
                "INDEXNOW_KEY",
                "GOOGLE_SITE_VERIFICATION",
                "BING_SITE_VERIFICATION",
            )
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmp.name) / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["BASE_URL"] = "https://example.test"
        os.environ["INDEXNOW_KEY"] = KEY
        os.environ["GOOGLE_SITE_VERIFICATION"] = "google-token"
        os.environ["BING_SITE_VERIFICATION"] = "bing-token"

        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

        conn = sqlite3.connect(self.db_path)
        try:
            conn.executemany(
                "INSERT INTO matches (match_id, duration_s, event_title) VALUES (?, ?, ?)",
                [(101, 1800, "Night Shift"), (202, 1900, "Night Shift"), (-1, None, "Night Shift")],
            )
            conn.commit()
        finally:
            conn.close()

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_key_file_is_served_at_the_origin_root(self):
        response = self.client.get(f"/{KEY}.txt")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_data(as_text=True), KEY)
        self.assertTrue(response.mimetype.startswith("text/plain"))

    def test_wrong_or_missing_key_is_not_served(self):
        self.assertEqual(self.client.get("/wrongkey123.txt").status_code, 404)
        self.app.config["INDEXNOW_KEY"] = ""
        self.assertEqual(self.client.get(f"/{KEY}.txt").status_code, 404)

    def test_verification_tags_render_on_react_and_legacy_pages(self):
        for path in ("/", "/api/docs"):
            with self.subTest(path=path):
                html = self.client.get(path).get_data(as_text=True)
                self.assertIn('<meta name="google-site-verification" content="google-token">', html)
                self.assertIn('<meta name="msvalidate.01" content="bing-token">', html)

    @patch("backend.app.indexnow.requests.post")
    def test_submit_urls_builds_the_expected_payload(self, post):
        post.return_value = Mock(status_code=200, text="OK")

        with self.app.app_context():
            result = submit_urls(["/matches/101", "https://example.test/players"])

        self.assertTrue(result["ok"])
        self.assertEqual(result["submitted"], 2)
        payload = post.call_args.kwargs["json"]
        self.assertEqual(payload["host"], "example.test")
        self.assertEqual(payload["key"], KEY)
        self.assertEqual(payload["keyLocation"], f"https://example.test/{KEY}.txt")
        self.assertEqual(
            payload["urlList"],
            ["https://example.test/matches/101", "https://example.test/players"],
        )

    @patch("backend.app.indexnow.requests.post")
    def test_submit_is_inert_without_a_key(self, post):
        with self.app.app_context():
            self.app.config["INDEXNOW_KEY"] = ""
            result = submit_urls(["/matches/101"])

        self.assertFalse(result["ok"])
        post.assert_not_called()

    def test_recent_paths_skips_placeholders(self):
        with self.app.app_context():
            self.assertEqual(recent_paths(10), ["/matches/202", "/matches/101"])
            self.assertEqual(recent_paths(1), ["/matches/202"])


if __name__ == "__main__":
    unittest.main()
