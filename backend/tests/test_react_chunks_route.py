"""Lazy route chunks must resolve the way a web server at the site root serves them.

Vite names chunks relative to the entry (`chunks/WeekPage.js`), and the browser
resolves those against the document origin. A reverse proxy that hosts the bundle
at the root answers `/chunks/*`; locally Flask owns the root, so without a route
there every lazily loaded page (`/week`, `/teams`, `/players`, …) renders blank.
"""

import os
import tempfile
import unittest
from pathlib import Path

from backend.app.main_web import create_app

CHUNK = "WeekPage.js"


class ReactChunkRouteTests(unittest.TestCase):
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

        static_root = Path(self.tmp.name) / "public"
        chunk = static_root / "react-app" / "chunks" / CHUNK
        chunk.parent.mkdir(parents=True)
        chunk.write_text("export default 1;\n", encoding="utf-8")
        (Path(self.tmp.name) / "outside.js").write_text("secret\n", encoding="utf-8")
        self.app.static_folder = str(static_root)
        self.client = self.app.test_client()

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self.tmp.cleanup()

    def test_root_chunk_path_serves_the_bundle(self):
        response = self.client.get(f"/chunks/{CHUNK}")

        self.assertEqual(response.status_code, 200)
        self.assertIn(b"export default 1;", response.data)

    def test_chunk_is_revalidated_like_the_rest_of_the_bundle(self):
        response = self.client.get(f"/chunks/{CHUNK}")

        self.assertEqual(response.headers.get("Cache-Control"), "no-cache")

    def test_missing_chunk_is_a_404(self):
        self.assertEqual(self.client.get("/chunks/NotARealPage.js").status_code, 404)

    def test_chunks_cannot_escape_the_bundle_directory(self):
        response = self.client.get("/chunks/../../outside.js")

        self.assertEqual(response.status_code, 404)


if __name__ == "__main__":
    unittest.main()
