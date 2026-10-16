from __future__ import annotations

import gzip
import json
import threading
import time
import unittest

from flask import Flask, jsonify

from backend.app.cache import SWRCache


def make_app(timeout=1000):
    app = Flask(__name__)
    cache = SWRCache()
    cache.init_app(app, config={"CACHE_TYPE": "SimpleCache"})
    calls = {"n": 0, "delay": 0.0, "status": 200}

    @app.get("/data")
    @cache.cached(timeout=timeout, query_string=True)
    def data():
        from flask import request

        calls["n"] += 1
        if calls["delay"]:
            time.sleep(calls["delay"])
        resp = jsonify({"n": calls["n"], "q": request.args.get("q"), "pad": "x" * 2000})
        resp.status_code = calls["status"]
        return resp

    @app.get("/ready")
    @cache.cached(
        timeout=timeout,
        response_filter=lambda r: bool((r.get_json(silent=True) or {}).get("available")),
    )
    def ready():
        calls["n"] += 1
        return jsonify({"available": calls["n"] > 1})

    return app, cache, calls


class SWRCacheTests(unittest.TestCase):
    def test_hit_after_miss_and_query_string_keys(self):
        app, _, calls = make_app()
        c = app.test_client()
        r1 = c.get("/data?q=a")
        r2 = c.get("/data?q=a")
        r3 = c.get("/data?q=b")
        self.assertEqual(r1.headers["X-Cache"], "MISS")
        self.assertEqual(r2.headers["X-Cache"], "HIT")
        self.assertEqual(r3.headers["X-Cache"], "MISS")
        self.assertEqual(calls["n"], 2)
        self.assertEqual(r1.get_json(), r2.get_json())

    def test_serves_precompressed_gzip(self):
        app, _, _ = make_app()
        c = app.test_client()
        c.get("/data")
        r = c.get("/data", headers={"Accept-Encoding": "gzip"})
        self.assertEqual(r.headers.get("Content-Encoding"), "gzip")
        self.assertEqual(json.loads(gzip.decompress(r.data))["q"], None)
        plain = c.get("/data")
        self.assertNotIn("Content-Encoding", plain.headers)
        self.assertEqual(json.loads(plain.data)["n"], 1)

    def test_filter_and_non_200_are_not_cached(self):
        app, _, calls = make_app()
        c = app.test_client()
        self.assertFalse(c.get("/ready").get_json()["available"])
        self.assertTrue(c.get("/ready").get_json()["available"])
        self.assertEqual(c.get("/ready").headers["X-Cache"], "HIT")

        calls["status"] = 404
        c.get("/data?q=err")
        c.get("/data?q=err")
        self.assertEqual(calls["n"], 4)

    def test_stale_entry_is_served_then_refreshed(self):
        app, cache, calls = make_app(timeout=120)
        c = app.test_client()
        c.get("/data")
        with app.app_context():
            for entry in cache._l1.values():
                entry["fresh_until"] = time.time() - 1
        stale = c.get("/data")
        self.assertEqual(stale.headers["X-Cache"], "STALE")
        self.assertEqual(stale.get_json()["n"], 1)
        deadline = time.time() + 3
        while time.time() < deadline and calls["n"] < 2:
            time.sleep(0.02)
        self.assertEqual(calls["n"], 2)
        time.sleep(0.1)
        self.assertEqual(c.get("/data").get_json()["n"], 2)

    def test_concurrent_cold_requests_compute_once(self):
        app, _, calls = make_app()
        calls["delay"] = 0.3
        results = []

        def hit():
            results.append(app.test_client().get("/data").get_json()["n"])

        threads = [threading.Thread(target=hit) for _ in range(6)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        self.assertEqual(calls["n"], 1)
        self.assertEqual(results, [1] * 6)

    def test_clear_drops_memory_tier(self):
        app, cache, calls = make_app()
        c = app.test_client()
        c.get("/data")
        with app.app_context():
            cache.clear()
        self.assertEqual(c.get("/data").headers["X-Cache"], "MISS")


if __name__ == "__main__":
    unittest.main()
