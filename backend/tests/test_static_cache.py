"""The React bundle must not be cached past a deploy.

Bundle filenames are stable (``matchlist.js``, ``chunks/BracketAdmin.js``), so a
positive ``max-age`` leaves browsers on an old build for hours after a release —
the admin renders a UI that no longer matches the API. These tests pin the
revalidate-every-load behaviour and the cheap 304 that makes it affordable.
"""

import os
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app

BUNDLE = "chunks/BracketAdmin.js"
URL = f"/public/react-app/{BUNDLE}"


class ReactBundleCacheTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {
            key: os.environ.get(key)
            for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")
        }
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"

        self.app = create_app()
        self.app.config.update(TESTING=True)
        # Point the /public route at a build directory this test owns, so it does not
        # depend on `public/react-app` having been generated.
        static_root = Path(self.tmp.name) / "public"
        bundle = static_root / "react-app" / BUNDLE
        bundle.parent.mkdir(parents=True)
        bundle.write_text("console.log('bundle');\n", encoding="utf-8")
        self.app.static_folder = str(static_root)
        self.client = self.app.test_client()

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_bundle_must_be_revalidated(self):
        response = self.client.get(URL)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers.get("Cache-Control"), "no-cache")
        self.assertIn("ETag", response.headers)

    def test_unchanged_bundle_answers_304(self):
        first = self.client.get(URL)

        second = self.client.get(URL, headers={"If-None-Match": first.headers["ETag"]})

        self.assertEqual(second.status_code, 304)
        self.assertEqual(second.headers.get("Cache-Control"), "no-cache")


if __name__ == "__main__":
    unittest.main()
