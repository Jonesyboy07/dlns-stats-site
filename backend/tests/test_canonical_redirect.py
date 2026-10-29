import os
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app


class CanonicalRedirectTests(unittest.TestCase):
    """Cloudflare owns the edge redirect; Flask must still guard direct traffic."""

    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in (
                "DB_PATH",
                "CACHE_DIR",
                "CACHE_WARMUP_ON_STARTUP",
                "BASE_URL",
                "CANONICAL_HOST",
                "FORCE_HTTPS",
                "CANONICAL_REDIRECTS",
                "CANONICAL_REDIRECT_EXEMPT_HOSTS",
            )
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        os.environ["BASE_URL"] = "https://example.test"
        os.environ["CANONICAL_HOST"] = ""
        os.environ["FORCE_HTTPS"] = ""
        os.environ["CANONICAL_REDIRECTS"] = "1"
        os.environ["CANONICAL_REDIRECT_EXEMPT_HOSTS"] = "127.0.0.1,localhost,::1"

        self.app = create_app()
        self.app.config.update(TESTING=True)
        self.client = self.app.test_client()

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_www_redirects_to_apex(self):
        response = self.client.get("/players", base_url="https://www.example.test")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(
            response.headers["Location"], "https://example.test/players"
        )

    def test_query_string_is_preserved(self):
        response = self.client.get(
            "/players?tab=Heroes&x=1", base_url="https://www.example.test"
        )

        self.assertEqual(response.status_code, 301)
        self.assertEqual(
            response.headers["Location"],
            "https://example.test/players?tab=Heroes&x=1",
        )

    def test_http_canonical_host_redirects_to_https(self):
        response = self.client.get("/players", base_url="http://example.test")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(
            response.headers["Location"], "https://example.test/players"
        )

    def test_canonical_https_host_is_served(self):
        response = self.client.get("/players", base_url="https://example.test")
        self.assertEqual(response.status_code, 200)

    def test_local_health_checks_are_not_redirected(self):
        response = self.client.get("/players", base_url="http://127.0.0.1:5050")
        self.assertEqual(response.status_code, 200)

    def test_non_get_requests_are_not_redirected(self):
        response = self.client.post(
            "/db/matches/latest", base_url="https://www.example.test"
        )
        self.assertNotEqual(response.status_code, 301)

    def test_redirects_can_be_disabled(self):
        self.app.config["CANONICAL_REDIRECTS"] = "0"
        response = self.client.get("/players", base_url="https://www.example.test")
        self.assertEqual(response.status_code, 200)

    def test_explicit_canonical_host_override(self):
        self.app.config["CANONICAL_HOST"] = "canonical.example.test"
        response = self.client.get("/players", base_url="https://www.example.test")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(
            response.headers["Location"], "https://canonical.example.test/players"
        )

    def test_host_redirect_is_not_cached_indefinitely(self):
        response = self.client.get("/players", base_url="https://www.example.test")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")

    def test_https_upgrade_redirect_is_not_cached_indefinitely(self):
        response = self.client.get("/players", base_url="http://example.test")

        self.assertEqual(response.status_code, 301)
        self.assertEqual(response.headers.get("Cache-Control"), "no-store")


if __name__ == "__main__":
    unittest.main()
