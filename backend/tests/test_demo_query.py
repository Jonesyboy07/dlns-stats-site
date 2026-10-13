import json
import unittest

from backend.app.utils.demo_query import EVENT_SOURCES, parse_result, tick_seconds


class ParseResultTests(unittest.TestCase):
    def test_parses_plain_ndjson(self):
        raw = b'{"tick":1,"n":2}\n{"tick":3,"n":4}\n'
        self.assertEqual(parse_result(raw), [{"tick": 1, "n": 2}, {"tick": 3, "n": 4}])

    def test_parses_zstd_compressed_ndjson(self):
        try:
            from compression import zstd
        except ImportError:  # pragma: no cover - needs the optional dependency
            self.skipTest("no zstd binding available")
        payload = b'{"t":1}\n{"t":2}\n'
        self.assertEqual(parse_result(zstd.compress(payload)), [{"t": 1}, {"t": 2}])

    def test_empty_result_is_an_empty_list(self):
        self.assertEqual(parse_result(b""), [])

    def test_parquet_is_rejected_rather_than_misread(self):
        with self.assertRaises(RuntimeError) as ctx:
            parse_result(b"PAR1\x15\x00\x15\x10")
        self.assertIn("ndjson", str(ctx.exception))


class TickSecondsTests(unittest.TestCase):
    """`BossKilledEvent` puts tick and gametime side by side, so the mapping is known."""

    def test_maps_a_tick_through_the_calibrated_clock(self):
        clock = {"tick_rate": 64.0, "offset_s": 64.875}
        self.assertAlmostEqual(tick_seconds(28575, clock), 511.359375, places=4)
        self.assertAlmostEqual(tick_seconds(40142, clock), 692.09375, places=4)

    def test_handles_a_missing_tick(self):
        self.assertIsNone(tick_seconds(None, {"tick_rate": 64.0, "offset_s": 0.0}))

    def test_falls_back_to_the_default_rate_without_calibration(self):
        # 64 ticks/second is the demo rate; only used when calibration found nothing.
        self.assertAlmostEqual(tick_seconds(640, {}), 10.0, places=6)


class EventSourceTests(unittest.TestCase):
    def test_every_source_selects_a_tick_and_is_not_empty(self):
        for name, source in EVENT_SOURCES.items():
            self.assertIn("tick", source["sql"].lower(), name)
            self.assertTrue(source["label"], name)

    def test_per_tick_entity_queries_quote_mixed_case_columns(self):
        # The demo engine lowercases unquoted identifiers, so `m_iTeamNum` and
        # `CBodyComponent__m_vecX` only resolve when quoted.
        sql = EVENT_SOURCES["camp_punched"]["sql"]
        self.assertIn('"CBodyComponent__m_vecX"', sql)
        self.assertIn("delta_type = 'delete'", sql)


if __name__ == "__main__":
    unittest.main()
