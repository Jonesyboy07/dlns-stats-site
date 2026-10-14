import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from backend.app.blueprints import db_api
from backend.app.cache import cache
from backend.app.main_web import create_app
from backend.main import (
    db_connect,
    db_init,
    ingest_match_mid_boss,
    ingest_match_objectives,
    ingest_player_deaths,
)

# Two deaths the snapshot counters report, with the exact detail the API attaches.
SAMPLE_MATCH_INFO = {
    "match_id": 123,
    "objectives": [
        {"team": 0, "team_objective_id": 9, "destroyed_time_s": 1790, "first_damage_time_s": 1781,
         "player_damage": 10183, "creep_damage": 0, "player_spirit_damage": 2010},
        {"team": 1, "team_objective_id": 10, "destroyed_time_s": 0, "first_damage_time_s": 0,
         "player_damage": 0, "creep_damage": 0, "player_spirit_damage": 0},
    ],
    "mid_boss": [
        {"team_killed": 0, "team_claimed": 1, "destroyed_time_s": 1047},
        {"team_killed": 1, "team_claimed": 0, "destroyed_time_s": 1488},
    ],
    "match_paths": {
        "interval_s": 1.0,
        "paths": [{"player_slot": 1, "x_pos": list(range(0, 800)), "y_pos": [0] * 800, "z_pos": [0] * 800}],
    },
    "players": [
        {
            "account_id": 42,
            "player_slot": 1,
            "team": 0,
            "hero_id": 11,
            "stats": [
                {"time_stamp_s": 180, "deaths": 0},
                {"time_stamp_s": 360, "deaths": 1},
                {"time_stamp_s": 540, "deaths": 2},
            ],
            "death_details": [
                {"game_time_s": 355, "killer_player_slot": 9, "time_to_kill_s": 4.5, "death_duration_s": 14,
                 "death_pos": {"x": 3, "y": 4, "z": 0}, "killer_pos": {"x": 30, "y": 40, "z": 0}},
                {"game_time_s": 530, "killer_player_slot": 10, "time_to_kill_s": 28.4, "death_duration_s": 21,
                 "death_pos": {"x": 0, "y": 0, "z": None}, "killer_pos": {"x": 60, "y": 70, "z": None}},
            ],
        }
    ],
}

# The API's per-player item log mixes shop purchases with one entry per hero-ability
# level, and 0 is the "still owned when the match ended" sentinel.
SAMPLE_ITEM_LOG = [
    {"item_id": 1, "game_time_s": 210, "sold_time_s": 0, "flags": 0, "upgrade_id": 0},
    {"item_id": 2, "game_time_s": 95, "sold_time_s": 640, "flags": 1, "upgrade_id": 0},
    # An ability: the timeline must not report a level-up as a purchase.
    {"item_id": 3, "game_time_s": 300, "sold_time_s": 0, "flags": 0, "upgrade_id": 47109322},
    # An id the catalog does not know at all.
    {"item_id": 999, "game_time_s": 120, "sold_time_s": 0, "flags": 0, "upgrade_id": 0},
]


def shop_item(**overrides):
    """A catalog row whose art the icon resolver can find on disk."""
    item = {
        "id": 1,
        "name": "Bullet Armor",
        "class_name": "upgrade_bullet_armor",
        "type": "upgrade",
        "item_slot_type": "vitality",
        "item_tier": 2,
        "cost": 1250,
        "shopable": True,
        "image": "https://cdn.example/items/bullet_armor.png",
        # The game's asset name, which differs from the display name.
        "shop_image": "https://cdn.example/assets/images/items/vitality/bullet_resilience.png",
    }
    item.update(overrides)
    return item


class _CatalogResponse:
    """Enough of a `requests.Response` for the item catalog fetch."""

    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


class TimelineIngestTests(unittest.TestCase):
    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory()
        self.db_path = Path(self.tmpdir.name) / "dlns.sqlite3"
        self.conn = db_connect(self.db_path)
        db_init(self.conn)
        self.conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (?, ?)", (123, 1903))
        self.conn.commit()

    def tearDown(self):
        self.conn.close()
        self.tmpdir.cleanup()

    def test_objectives_are_stored_including_survivors(self):
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT team, objective_id, destroyed_time_s, player_spirit_damage "
            "FROM match_objectives ORDER BY objective_id"
        ).fetchall()
        self.assertEqual(rows, [(0, 9, 1790, 2010), (1, 10, 0, 0)])

    def test_objectives_reingest_replaces_rows(self):
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()
        ingest_match_objectives(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        count = self.conn.execute("SELECT COUNT(*) FROM match_objectives WHERE match_id = 123").fetchone()[0]
        self.assertEqual(count, 2)

    def test_mid_boss_rows_keep_api_order(self):
        ingest_match_mid_boss(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT boss_index, team_claimed, destroyed_time_s FROM match_mid_boss ORDER BY boss_index"
        ).fetchall()
        self.assertEqual(rows, [(0, 1, 1047), (1, 0, 1488)])

    def test_deaths_use_exact_detail_time_and_position(self):
        ingest_player_deaths(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT death_index, death_time_s, position_x, position_y, position_z, "
            "midpoint_distance, killer_player_slot, time_to_kill_s, death_duration_s "
            "FROM player_deaths ORDER BY death_index"
        ).fetchall()
        first = rows[0]
        self.assertEqual(first[0], 1)
        self.assertEqual(first[1], 355)  # exact time from death_details, not the snapshot
        self.assertEqual((first[2], first[3], first[4]), (3.0, 4.0, 0.0))
        self.assertAlmostEqual(first[5], 5.0)  # 3-4-5 from the death position
        self.assertEqual(first[6], 9)
        self.assertAlmostEqual(first[7], 4.5)
        self.assertEqual(first[8], 14)

        # A death with an incomplete position keeps the time but no distance.
        self.assertEqual(rows[1][1], 530)
        self.assertIsNone(rows[1][5])
        self.assertEqual(rows[1][6], 10)

    def test_deaths_store_the_killers_position(self):
        ingest_player_deaths(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        rows = self.conn.execute(
            "SELECT killer_position_x, killer_position_y, killer_position_z "
            "FROM player_deaths ORDER BY death_index"
        ).fetchall()
        # The killer stands somewhere else than the victim, or the map's line would
        # be a dot.
        self.assertEqual(rows[0], (30.0, 40.0, 0.0))
        self.assertEqual(rows[1], (60.0, 70.0, None))

    def test_death_count_matches_the_authoritative_player_count(self):
        ingest_player_deaths(self.conn, 123, SAMPLE_MATCH_INFO)
        self.conn.commit()

        count = self.conn.execute("SELECT COUNT(*) FROM player_deaths WHERE match_id = 123").fetchone()[0]
        self.assertEqual(count, len(SAMPLE_MATCH_INFO["players"][0]["death_details"]))

    def test_deaths_without_details_fall_back_to_snapshots(self):
        info = {
            "match_paths": SAMPLE_MATCH_INFO["match_paths"],
            "players": [{
                "account_id": 42,
                "player_slot": 1,
                "stats": [{"time_stamp_s": 180, "deaths": 0}, {"time_stamp_s": 360, "deaths": 1}],
            }],
        }
        ingest_player_deaths(self.conn, 123, info)
        self.conn.commit()

        row = self.conn.execute(
            "SELECT death_time_s, position_x, midpoint_distance, killer_player_slot, "
            "time_to_kill_s, death_duration_s, killer_position_x, killer_position_y, "
            "killer_position_z FROM player_deaths"
        ).fetchone()
        self.assertEqual(row[0], 360)  # snapshot time is the best available
        self.assertEqual(row[1], 360.0)  # sampled from match_paths
        self.assertEqual(row[2], 360.0)
        # Only the detail path reports a killer, so there is nothing to draw a line to.
        self.assertEqual(row[3:], (None, None, None, None, None, None))


class PlayerDeathColumnMigrationTests(unittest.TestCase):
    """A database created before the killer-position columns existed gains them."""

    def setUp(self):
        self.tmpdir = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        self.db_path = Path(self.tmpdir.name) / "old.sqlite3"
        # The shape the table had before the killer position was captured.
        conn = sqlite3.connect(self.db_path)
        conn.execute(
            "CREATE TABLE player_deaths ("
            "match_id INTEGER NOT NULL, account_id INTEGER NOT NULL, "
            "death_index INTEGER NOT NULL, death_time_s INTEGER, "
            "position_x REAL, position_y REAL, position_z REAL, "
            "midpoint_distance_x REAL, midpoint_distance_y REAL, midpoint_distance_z REAL, "
            "midpoint_distance REAL, killer_player_slot INTEGER, time_to_kill_s REAL, "
            "death_duration_s INTEGER, "
            "PRIMARY KEY (match_id, account_id, death_index))"
        )
        conn.commit()
        conn.close()

    def tearDown(self):
        self.tmpdir.cleanup()

    def test_db_init_adds_the_killer_position_columns(self):
        conn = db_connect(self.db_path)
        db_init(conn)

        cols = {row[1] for row in conn.execute("PRAGMA table_info(player_deaths)")}
        self.assertIn("killer_position_x", cols)
        self.assertIn("killer_position_y", cols)
        self.assertIn("killer_position_z", cols)
        conn.close()

    def test_an_upgraded_database_accepts_the_new_rows(self):
        conn = db_connect(self.db_path)
        db_init(conn)
        conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (?, ?)", (123, 1903))
        conn.commit()

        ingest_player_deaths(conn, 123, SAMPLE_MATCH_INFO)
        conn.commit()

        rows = conn.execute(
            "SELECT killer_position_x, killer_position_y FROM player_deaths ORDER BY death_index"
        ).fetchall()
        self.assertEqual(rows, [(30.0, 40.0), (60.0, 70.0)])
        conn.close()


class MatchEventsRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        # mkdtemp + ignore_errors on cleanup: Windows keeps the SQLite handle open
        # past the request, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-timeline-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        # Serve the catalogue from a fixture so the route never reaches the upstream
        # API. Resolving it goes through the real code path, so the icon asserted for
        # "Bullet Armor" is the file this repo actually ships.
        self.catalog = mock.patch(
            "backend.app.blueprints.db_api.requests.get",
            return_value=_CatalogResponse([
                shop_item(),
                shop_item(
                    id=2,
                    name="Test Trinket",
                    class_name="upgrade_test_trinket",
                    item_tier=3,
                    image="https://cdn.example/items/test_trinket.png",
                    shop_image="",
                ),
                shop_item(
                    id=3,
                    name="Alchemical Flask",
                    class_name="citadel_ability_alchemical_flask",
                    type="ability",
                ),
            ]),
        )
        self.catalog.start()
        self.addCleanup(self.catalog.stop)

        with self.app.app_context():
            cache.delete("dlns_item_catalog")
            cache.delete("dlns_item_icon_index")
            db_api._item_catalog()

        with sqlite3.connect(self.db_path) as conn:
            conn.execute("INSERT INTO matches (match_id, duration_s) VALUES (123, 1903)")
            conn.execute("INSERT INTO users (account_id, persona_name) VALUES (42, 'Tester')")
            conn.execute(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, raw_items_json) "
                "VALUES (123, 42, 1, 0, 11, ?)",
                (json.dumps(SAMPLE_ITEM_LOG),),
            )
            conn.executemany(
                "INSERT INTO match_objectives (match_id, team, objective_id, destroyed_time_s, "
                "first_damage_time_s, player_damage, creep_damage, player_spirit_damage) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                [
                    (123, 0, 9, 1790, 1781, 10183, 0, 2010),
                    # A lane objective: slot 3 is lane 4.
                    (123, 1, 3, 481, 59, 4575, 1000, 190),
                    # Survived the match: stored, but not a timeline event.
                    (123, 1, 10, 0, 0, 0, 0, 0),
                ],
            )
            conn.execute(
                "INSERT INTO match_mid_boss (match_id, boss_index, team_killed, team_claimed, destroyed_time_s) "
                "VALUES (123, 0, 0, 1, 1047)"
            )
            conn.execute(
                "INSERT INTO player_deaths (match_id, account_id, death_index, death_time_s, "
                "killer_player_slot, time_to_kill_s, death_duration_s, position_x, "
                "killer_position_x, killer_position_y) "
                "VALUES (123, 42, 1, 355, 9, 4.5, 14, 120.5, 900.25, 700.5)"
            )

    def tearDown(self):
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_events_merge_sources_in_time_order(self):
        response = self.client.get("/db/matches/123/events")

        self.assertEqual(response.status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload["available"])
        self.assertEqual(payload["duration_s"], 1903)
        self.assertEqual(payload["counts"], {"objectives": 2, "mid_boss": 1, "deaths": 1, "purchases": 2})
        self.assertEqual(
            [e["type"] for e in payload["events"]], ["death", "objective", "mid_boss", "objective"]
        )
        self.assertEqual([e["time_s"] for e in payload["events"]], [355, 481, 1047, 1790])

    def test_death_and_objective_payloads_are_complete(self):
        events = self.client.get("/db/matches/123/events").get_json()["events"]

        death = events[0]
        self.assertEqual(death["persona_name"], "Tester")
        self.assertEqual(death["killer_player_slot"], 9)
        self.assertEqual(death["position"], {"x": 120.5, "y": None, "z": None})
        # Both ends of the kill line, so the map can draw it.
        self.assertEqual(death["killer_position"], {"x": 900.25, "y": 700.5, "z": None})

        lane_objective = events[1]
        self.assertEqual(lane_objective["objective"], "Tier 1 Walker (Lane 3)")
        self.assertEqual(lane_objective["lane"], 4)  # slot 3 is lane 4
        self.assertEqual(lane_objective["team"], 1)

        self.assertEqual(events[2]["team"], 1)  # team_claimed
        self.assertEqual(events[2]["boss_index"], 0)

        titan = events[3]
        self.assertEqual(titan["objective"], "Titan (Base Guardian)")
        self.assertIsNone(titan["lane"])  # Titan belongs to no lane
        self.assertEqual(titan["player_spirit_damage"], 2010)

    def test_match_without_timeline_rows_reports_unavailable(self):
        payload = self.client.get("/db/matches/999/events").get_json()

        self.assertFalse(payload["available"])
        self.assertEqual(payload["events"], [])
        self.assertEqual(payload["count"], 0)
        self.assertEqual(payload["purchases"], [])

    def test_purchases_carry_the_time_the_item_and_the_seller_art(self):
        purchases = self.client.get("/db/matches/123/events").get_json()["purchases"]

        self.assertEqual([p["item"] for p in purchases], ["Test Trinket", "Bullet Armor"])
        self.assertEqual([p["time_s"] for p in purchases], [95, 210])

        sold = purchases[0]
        self.assertEqual(sold["sold_time_s"], 640)
        self.assertEqual(sold["team"], 0)
        self.assertEqual(sold["account_id"], 42)
        self.assertEqual(sold["persona_name"], "Tester")
        self.assertEqual(sold["item_id"], 2)
        self.assertEqual(sold["slot"], "vitality")
        self.assertEqual(sold["tier"], 3)
        # No shipped art matches this name, so the upstream image is what is left.
        self.assertIsNone(sold["icon"])
        self.assertEqual(sold["image"], "https://cdn.example/items/test_trinket.png")

        held = purchases[1]
        # 0 means the player still owned it; the client shows no sell time for it.
        self.assertIsNone(held["sold_time_s"])
        # Resolved through the shared resolver, from the asset name and not the name.
        self.assertEqual(held["icon"], "items/vitality/bullet_resilience_psd.png")

    def test_purchases_skip_abilities_and_unknown_ids(self):
        purchases = self.client.get("/db/matches/123/events").get_json()["purchases"]

        self.assertNotIn(3, [p["item_id"] for p in purchases])
        self.assertNotIn(999, [p["item_id"] for p in purchases])

    def test_purchases_stay_out_of_the_event_list(self):
        payload = self.client.get("/db/matches/123/events").get_json()

        self.assertNotIn("purchase", [e["type"] for e in payload["events"]])
        self.assertEqual(payload["count"], len(payload["events"]))

    def test_a_match_without_item_logs_still_reports_purchases_as_empty(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE players SET raw_items_json = NULL WHERE match_id = 123")

        payload = self.client.get("/db/matches/123/events").get_json()

        self.assertEqual(payload["purchases"], [])
        self.assertEqual(payload["counts"]["purchases"], 0)


if __name__ == "__main__":
    unittest.main()
