from __future__ import annotations

import time
import unittest
from unittest import mock

from flask import Flask, jsonify

from backend.app.blueprints.db import core
from backend.app.cache import SWRCache, cache


def catalog_app():
    app = Flask(__name__)
    cache.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
    return app


class SharedCatalogTests(unittest.TestCase):
    def setUp(self):
        self.app = catalog_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.addCleanup(self.ctx.pop)

    def fetch(self):
        return core._shared_catalog("t_catalog", "https://up.example/items", "Test", 1800)

    def test_outage_costs_one_request_not_one_per_visitor(self):
        with mock.patch("requests.get", side_effect=OSError("down")) as get:
            self.assertEqual(self.fetch(), [])
            self.assertEqual(self.fetch(), [])
            self.assertEqual(self.fetch(), [])
        self.assertEqual(get.call_count, 1)

    def test_expired_catalog_serves_last_good_then_refreshes(self):
        first = mock.Mock(status_code=200)
        first.json.return_value = [{"id": 1}]
        second = mock.Mock(status_code=200)
        second.json.return_value = [{"id": 2}]
        with mock.patch("requests.get", side_effect=[first, second]) as get:
            self.assertEqual(self.fetch(), [{"id": 1}])
            cache.delete("t_catalog")  # the fresh copy expires; last-good remains
            self.assertEqual(self.fetch(), [{"id": 1}])  # served instantly
            deadline = time.time() + 3
            while time.time() < deadline and cache.get("t_catalog") is None:
                time.sleep(0.02)
            self.assertEqual(cache.get("t_catalog"), [{"id": 2}])
        self.assertEqual(get.call_count, 2)

    def test_failed_refresh_keeps_serving_last_good(self):
        ok = mock.Mock(status_code=200)
        ok.json.return_value = [{"id": 1}]
        with mock.patch("requests.get", side_effect=[ok, OSError("down")]):
            self.fetch()
            cache.delete("t_catalog")
            self.assertEqual(self.fetch(), [{"id": 1}])
            time.sleep(0.2)
            self.assertEqual(self.fetch(), [{"id": 1}])


class RouteCacheOptionTests(unittest.TestCase):
    def test_uncacheable_responses_are_not_stored_or_leaked(self):
        app = Flask(__name__)
        c = SWRCache()
        c.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
        calls = {"n": 0}

        @app.get("/flaky")
        @c.cached(timeout=1000)
        def flaky():
            calls["n"] += 1
            return core.uncacheable(jsonify({"n": calls["n"]}))

        client = app.test_client()
        r1 = client.get("/flaky")
        client.get("/flaky")
        self.assertEqual(calls["n"], 2)
        self.assertNotIn("X-No-Cache", r1.headers)

    def test_invalidate_data_serves_long_ttl_stale_and_drops_short_ttl(self):
        app = Flask(__name__)
        c = SWRCache()
        c.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
        calls = {"long": 0, "short": 0}

        @app.get("/long")
        @c.cached(timeout=600)
        def long_view():
            calls["long"] += 1
            return jsonify({"n": calls["long"]})

        @app.get("/short")
        @c.cached(timeout=30)
        def short_view():
            calls["short"] += 1
            return jsonify({"n": calls["short"]})

        client = app.test_client()
        client.get("/long")
        client.get("/short")
        time.sleep(0.01)
        with app.app_context():
            c.invalidate_data()
        self.assertEqual(client.get("/long").headers["X-Cache"], "STALE")
        self.assertEqual(client.get("/short").headers["X-Cache"], "MISS")

    def test_stale_for_lets_short_ttl_routes_serve_stale(self):
        app = Flask(__name__)
        c = SWRCache()
        c.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
        calls = {"n": 0}

        @app.get("/live")
        @c.cached(timeout=30, stale_for=600)
        def live():
            calls["n"] += 1
            return jsonify({"n": calls["n"]})

        @app.get("/strict")
        @c.cached(timeout=30)
        def strict():
            calls["n"] += 1
            return jsonify({"n": calls["n"]})

        client = app.test_client()
        client.get("/live")
        client.get("/strict")
        with app.app_context():
            for entry in c._l1.values():
                entry["fresh_until"] -= 31
                entry["stale_until"] -= 31
        self.assertEqual(client.get("/live").headers["X-Cache"], "STALE")
        # A short-TTL route without stale_for never serves stale data.
        self.assertEqual(client.get("/strict").headers["X-Cache"], "MISS")


if __name__ == "__main__":
    unittest.main()
