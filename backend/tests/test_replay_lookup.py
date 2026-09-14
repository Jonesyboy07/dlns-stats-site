import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.app import cache_warmup
from backend.app.main_web import create_app


class ReplayWarmupTests(unittest.TestCase):
    def test_build_warmup_paths_includes_recent_replay_lookups(self):
        app = Flask(__name__)
        with patch.object(
            cache_warmup,
            "_discover_seed_ids",
            return_value={
                "match_id": 321,
                "recent_match_ids": [321, 654, 987],
                "account_id": None,
                "hero_id": None,
                "event_title": None,
                "event_week": None,
            },
        ):
            paths = cache_warmup._build_warmup_paths(app)

        self.assertIn("/db/matches/321/replay", paths)
        self.assertIn("/db/matches/654/replay", paths)
        self.assertIn("/db/matches/987/replay", paths)


class ReplayRetryRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_warmup = os.environ.get("CACHE_WARMUP_ON_STARTUP")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.tmpdir = tempfile.TemporaryDirectory()
        self.app = create_app()
        self.app.config.update(
            TESTING=True,
            REPLAY_SHARE_API_URL="https://files.example/api/public/share",
            REPLAY_DOWNLOAD_BASE_URL="https://files.example/api/public/dl",
            REPLAY_URL_FILE_CACHE_PATH=str(Path(self.tmpdir.name) / "replay_urls.json"),
        )
        self.client = self.app.test_client()

    def tearDown(self):
        if self._old_warmup is None:
            os.environ.pop("CACHE_WARMUP_ON_STARTUP", None)
        else:
            os.environ["CACHE_WARMUP_ON_STARTUP"] = self._old_warmup
        self.tmpdir.cleanup()

    def test_cached_not_found_returns_without_retry(self):
        with patch(
            "backend.app.blueprints.db_api._get_persisted_replay_lookup",
            return_value={"found": False, "replay": None, "searched_dirs": 9},
        ), patch("backend.app.blueprints.db_api._replay_match_item") as replay_match_item:
            response = self.client.get("/db/matches/123456/replay")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(response.get_json()["cached"])
        replay_match_item.assert_not_called()

    def test_retry_bypasses_cached_not_found_and_rescans(self):
        with patch(
            "backend.app.blueprints.db_api._get_persisted_replay_lookup",
            return_value={"found": False, "replay": None, "searched_dirs": 9},
        ), patch(
            "backend.app.blueprints.db_api._replay_match_item",
            return_value=(
                {
                    "name": "123456.zip",
                    "path": "replays/123456.zip",
                    "size": 10,
                    "modified": "now",
                },
                4,
            ),
        ) as replay_match_item:
            response = self.client.get("/db/matches/123456/replay?retry=1")

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["found"])
        self.assertEqual(payload["replay"]["download_url"], "https://files.example/api/public/dl/replays/123456.zip")
        replay_match_item.assert_called_once_with(123456)


if __name__ == "__main__":
    unittest.main()
