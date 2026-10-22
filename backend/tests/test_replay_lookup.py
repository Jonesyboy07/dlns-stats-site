import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from flask import Flask

from backend.app import cache_warmup
from backend.app.main_web import create_app


class ReplayWarmupTests(unittest.TestCase):
    def test_build_warmup_paths_skips_slow_replay_lookups(self):
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

        self.assertFalse(any(path.endswith("/replay") for path in paths))


class ReplayRetryRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_warmup = os.environ.get("CACHE_WARMUP_ON_STARTUP")
        self._old_cache_dir = os.environ.get("CACHE_DIR")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.tmpdir = tempfile.TemporaryDirectory()
        os.environ["CACHE_DIR"] = str(Path(self.tmpdir.name) / "cache")
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
        if self._old_cache_dir is None:
            os.environ.pop("CACHE_DIR", None)
        else:
            os.environ["CACHE_DIR"] = self._old_cache_dir
        self.tmpdir.cleanup()

    def test_cached_not_found_returns_without_retry(self):
        with patch(
            "backend.app.blueprints.db.matches._get_persisted_replay_lookup",
            return_value={"found": False, "replay": None, "searched_dirs": 9},
        ), patch("backend.app.blueprints.db.matches._replay_match_item") as replay_match_item:
            response = self.client.get("/db/matches/123456/replay")

        self.assertEqual(response.status_code, 404)
        self.assertTrue(response.get_json()["cached"])
        replay_match_item.assert_not_called()

    def test_retry_bypasses_cached_not_found_and_rescans(self):
        with patch(
            "backend.app.blueprints.db.matches._get_persisted_replay_lookup",
            return_value={"found": False, "replay": None, "searched_dirs": 9},
        ), patch(
            "backend.app.blueprints.db.matches._replay_match_item",
            return_value=(
                {
                    "name": "123456.zip",
                    "path": "replays/123456.zip",
                    "size": 10,
                    "modified": "now",
                },
                4,
                True,
            ),
        ) as replay_match_item:
            response = self.client.get("/db/matches/123456/replay?retry=1")

        payload = response.get_json()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(payload["found"])
        self.assertEqual(payload["replay"]["download_url"], "https://files.example/api/public/dl/replays/123456.zip")
        replay_match_item.assert_called_once_with(123456)

    def test_partial_scan_caches_a_short_negative(self):
        self.app.config.update(
            REPLAY_URL_CACHE_TTL_SECONDS=3600, REPLAY_SCAN_PARTIAL_TTL_SECONDS=120
        )
        with patch("backend.app.blueprints.db.matches.cache.get", return_value=None), patch(
            "backend.app.blueprints.db.matches._get_persisted_replay_lookup",
            return_value=None,
        ), patch(
            "backend.app.blueprints.db.matches._replay_match_item",
            return_value=(None, 7, False),
        ), patch(
            "backend.app.blueprints.db.matches._set_persisted_replay_lookup"
        ) as persist:
            response = self.client.get("/db/matches/123456/replay")

        payload = response.get_json()
        self.assertEqual(response.status_code, 404)
        self.assertFalse(payload["scan_complete"])
        self.assertEqual(payload["retry_after_seconds"], 120)
        self.assertIn("try again shortly", payload["message"])
        self.assertEqual(persist.call_args.kwargs["ttl_seconds"], 120)

    def test_complete_scan_keeps_the_full_negative_ttl(self):
        self.app.config.update(
            REPLAY_URL_CACHE_TTL_SECONDS=3600, REPLAY_SCAN_PARTIAL_TTL_SECONDS=120
        )
        with patch("backend.app.blueprints.db.matches.cache.get", return_value=None), patch(
            "backend.app.blueprints.db.matches._get_persisted_replay_lookup",
            return_value=None,
        ), patch(
            "backend.app.blueprints.db.matches._replay_match_item",
            return_value=(None, 7, True),
        ), patch(
            "backend.app.blueprints.db.matches._set_persisted_replay_lookup"
        ) as persist:
            response = self.client.get("/db/matches/123456/replay")

        payload = response.get_json()
        self.assertEqual(response.status_code, 404)
        self.assertTrue(payload["scan_complete"])
        self.assertEqual(payload["retry_after_seconds"], 3600)
        self.assertEqual(persist.call_args.kwargs["ttl_seconds"], 3600)


class ReplayScanBoundsTests(unittest.TestCase):
    """The live fallback scan must never walk the whole share."""

    def setUp(self):
        self._old_warmup = os.environ.get("CACHE_WARMUP_ON_STARTUP")
        self._old_cache_dir = os.environ.get("CACHE_DIR")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["CACHE_DIR"] = str(Path(self.tmpdir.name) / "cache")
        self.app = create_app()
        self.app.config.update(TESTING=True)

    def tearDown(self):
        if self._old_warmup is None:
            os.environ.pop("CACHE_WARMUP_ON_STARTUP", None)
        else:
            os.environ["CACHE_WARMUP_ON_STARTUP"] = self._old_warmup
        if self._old_cache_dir is None:
            os.environ.pop("CACHE_DIR", None)
        else:
            os.environ["CACHE_DIR"] = self._old_cache_dir
        self.tmpdir.cleanup()

    def test_directory_cap_leaves_the_scan_incomplete(self):
        from backend.app.blueprints.db.matches import _replay_match_item

        with self.app.app_context(), patch(
            "backend.app.blueprints.db.matches._load_replay_index",
            return_value={"replays": {}},
        ), patch(
            "backend.app.blueprints.db.matches._schedule_index_refresh", return_value=False
        ), patch("backend.app.blueprints.db.matches._save_replay_index"), patch(
            "backend.app.blueprints.db.matches._fetch_replay_listing",
            side_effect=lambda path=None, timeout=None: [
                {"isDir": True, "path": "2024"},
                {"isDir": True, "path": "2025"},
            ],
        ) as listing:
            item, visited, complete = _replay_match_item(
                123456, max_dirs=2, deadline_seconds=30
            )

        self.assertIsNone(item)
        self.assertEqual(visited, 2)
        self.assertFalse(complete)
        self.assertEqual(listing.call_count, 2)

    def test_deadline_stops_before_the_first_directory(self):
        from backend.app.blueprints.db.matches import _replay_match_item

        with self.app.app_context(), patch(
            "backend.app.blueprints.db.matches._load_replay_index",
            return_value={"replays": {}},
        ), patch(
            "backend.app.blueprints.db.matches._schedule_index_refresh", return_value=False
        ), patch(
            "backend.app.blueprints.db.matches._fetch_replay_listing"
        ) as listing:
            item, visited, complete = _replay_match_item(
                123456, max_dirs=10, deadline_seconds=0
            )

        self.assertIsNone(item)
        self.assertEqual(visited, 0)
        self.assertFalse(complete)
        listing.assert_not_called()

    def test_per_listing_timeout_is_bounded_by_config(self):
        from backend.app.blueprints.db.matches import _replay_match_item

        seen_timeouts = []

        def listing(path=None, timeout=None):
            seen_timeouts.append(timeout)
            return [{"isDir": True, "path": "2024"}]

        with self.app.app_context(), patch(
            "backend.app.blueprints.db.matches._load_replay_index",
            return_value={"replays": {}},
        ), patch(
            "backend.app.blueprints.db.matches._schedule_index_refresh", return_value=False
        ), patch(
            "backend.app.blueprints.db.matches._fetch_replay_listing",
            side_effect=listing,
        ):
            self.app.config["REPLAY_LISTING_TIMEOUT_SECONDS"] = 1.5
            _replay_match_item(123456, max_dirs=1, deadline_seconds=30)

        self.assertEqual(len(seen_timeouts), 1)
        self.assertGreater(seen_timeouts[0], 0)
        self.assertLessEqual(seen_timeouts[0], 1.5)

    def test_matching_file_ends_the_scan(self):
        from backend.app.blueprints.db.matches import _replay_match_item

        with self.app.app_context(), patch(
            "backend.app.blueprints.db.matches._load_replay_index",
            return_value={"replays": {}},
        ), patch(
            "backend.app.blueprints.db.matches._schedule_index_refresh", return_value=False
        ), patch("backend.app.blueprints.db.matches._save_replay_index"), patch(
            "backend.app.blueprints.db.matches._fetch_replay_listing",
            return_value=[
                {"isDir": False, "name": "123456.zip", "path": "replays/123456.zip"}
            ],
        ):
            item, visited, complete = _replay_match_item(123456)

        self.assertEqual(item["name"], "123456.zip")
        self.assertEqual(visited, 1)
        self.assertTrue(complete)


if __name__ == "__main__":
    unittest.main()
