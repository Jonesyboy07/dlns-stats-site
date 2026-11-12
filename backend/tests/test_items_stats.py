"""The Items index endpoint, `/db/items/stats`, and its counting rules.

`item_usage` is checked directly for the rules (once per game, sold only when
every copy was sold, first buy time, abilities ignored); the route tests check
the stats page's week/region scoping and the response shape.
"""

import json
import os
import shutil
import sqlite3
import tempfile
import unittest
from pathlib import Path

from backend.app.blueprints.db.items import item_breakdown, item_rows, item_text, item_usage, purchasable_items
from backend.app.cache import cache
from backend.app.main_web import create_app

SHOTS, BULLETS, ABILITY = 101, 202, 303

CATALOG = {
    SHOTS: {"name": "Headshot Booster", "slot": "weapon", "tier": 1, "cost": 800, "type": "upgrade",
            "shopable": True, "icon": "items/weapon/headshot_booster_psd.png", "image": None},
    BULLETS: {"name": "Toxic Bullets", "class_name": "upgrade_toxic_bullets", "slot": "weapon", "tier": 3, "cost": 3200, "type": "upgrade",
              "shopable": True, "icon": None, "image": "https://cdn.example/toxic.png"},
    ABILITY: {"name": "Some Ability", "slot": "", "tier": None, "cost": 0, "type": "ability",
              "shopable": False, "icon": None, "image": None},
}


def buy(item_id, at, sold=0):
    return {"item_id": item_id, "game_time_s": at, "sold_time_s": sold, "upgrade_id": 0}


def player(result, *purchases):
    return {"result": result, "raw_items_json": json.dumps(list(purchases))}


class ItemUsageTests(unittest.TestCase):
    def setUp(self):
        self.items = purchasable_items(CATALOG)

    def test_abilities_are_not_items(self):
        self.assertEqual(set(self.items), {SHOTS, BULLETS})

    def test_counts_once_per_game_with_first_buy_time(self):
        usage = item_usage([player("Win", buy(SHOTS, 300), buy(SHOTS, 120), buy(ABILITY, 0))], self.items)
        self.assertEqual(usage["player_games"], 1)
        self.assertEqual(set(usage["items"]), {SHOTS})
        self.assertEqual(usage["items"][SHOTS], {"games": 1, "wins": 1, "sold": 0, "times": [120]})

    def test_sold_only_when_every_copy_was_sold(self):
        usage = item_usage(
            [
                player("Loss", buy(SHOTS, 100, sold=900)),
                player("Loss", buy(SHOTS, 100, sold=900), buy(SHOTS, 1200)),
            ],
            self.items,
        )
        self.assertEqual(usage["items"][SHOTS]["games"], 2)
        self.assertEqual(usage["items"][SHOTS]["sold"], 1)
        self.assertEqual(usage["items"][SHOTS]["wins"], 0)

    def test_players_without_purchase_data_are_left_out(self):
        usage = item_usage(
            [player("Win", buy(BULLETS, 900)), {"result": "Win", "raw_items_json": None}, player("Loss")],
            self.items,
        )
        self.assertEqual(usage["player_games"], 1)

    def test_rows_carry_catalogue_fields_and_median(self):
        usage = item_usage(
            [player("Win", buy(BULLETS, 600)), player("Loss", buy(BULLETS, 900)), player("Win", buy(SHOTS, 60))],
            self.items,
        )
        rows = item_rows(usage["items"], self.items)
        self.assertEqual([row["id"] for row in rows], [BULLETS, SHOTS])  # most-bought first
        self.assertEqual(rows[0]["median_buy_s"], 750)
        self.assertEqual((rows[0]["games"], rows[0]["wins"]), (2, 1))
        self.assertEqual((rows[0]["tier"], rows[0]["cost"], rows[0]["slot"]), (3, 3200, "weapon"))


class ItemTextTests(unittest.TestCase):
    RAW = {
        "description": {"desc": "Your bullets build up a <span class=\"highlight\">Bleed</span> &amp; more."},
        "is_active_item": False,
        "tooltip_sections": [
            {"section_attributes": [{"properties": ["DotDuration"], "important_properties": ["DotHealthPercent", "HealA", "HealB"]}]}
        ],
        "properties": {
            "DotHealthPercent": {"value": "1.9", "label": "Bleed Damage", "postfix": "% DPS"},
            "HealA": {"value": "-40", "label": "Incoming Healing", "postfix": "%"},
            "HealB": {"value": "-40", "label": "Incoming Healing", "postfix": "%"},
            "DotDuration": {"value": "4", "label": "Duration", "postfix": "s"},
            "AbilityCooldownBetweenCharge": {"value": "-1.0", "label": "Charge Delay", "postfix": "s"},
        },
    }

    def test_plain_description_and_ordered_bonuses(self):
        text = item_text(self.RAW)
        self.assertEqual(text["description"], "Your bullets build up a Bleed & more.")
        self.assertEqual(
            text["bonuses"],
            [
                {"label": "Bleed Damage", "value": "1.9% DPS"},
                {"label": "Incoming Healing", "value": "-40%"},
                {"label": "Duration", "value": "4s"},
            ],
        )

    def test_sign_prefix_and_active_cooldown(self):
        raw = {
            "is_active_item": True,
            "tooltip_sections": [{"section_attributes": [{"elevated_properties": ["BonusHealth"], "loc_string": "Go <b>fast</b>"}]}],
            "properties": {
                "BonusHealth": {"value": "125", "label": "Bonus Health", "prefix": "{s:sign}"},
                "AbilityCooldown": {"value": 60.0, "label": "Cooldown", "postfix": "s"},
            },
        }
        text = item_text(raw)
        self.assertEqual(text["description"], "Go fast")
        self.assertEqual(text["bonuses"], [{"label": "Bonus Health", "value": "+125"}, {"label": "Cooldown", "value": "60s"}])

    def test_missing_item(self):
        self.assertEqual(item_text(None), {"description": "", "bonuses": []})


class ItemBreakdownTests(unittest.TestCase):
    def test_buckets_heroes_players_and_recent(self):
        items = purchasable_items(CATALOG)
        rows = [
            {**player("Win", buy(BULLETS, 100)), "match_id": 1, "account_id": 7, "hero_id": 2, "persona_name": "Ann", "start_time": "2026-10-01"},
            {**player("Loss", buy(BULLETS, 1000)), "match_id": 2, "account_id": 7, "hero_id": 2, "persona_name": "Ann", "start_time": "2026-10-08"},
            {**player("Win", buy(BULLETS, 2400, sold=2500)), "match_id": 2, "account_id": 8, "hero_id": 7, "persona_name": "Bo", "start_time": "2026-10-08"},
            {**player("Win", buy(SHOTS, 50)), "match_id": 3, "account_id": 8, "hero_id": 7, "persona_name": "Bo", "start_time": "2026-10-15"},
        ]
        data = item_breakdown(rows, BULLETS, items)
        self.assertEqual(data["player_games"], 4)
        self.assertEqual(data["totals"], {"games": 3, "wins": 2, "sold": 1, "median_buy_s": 1000})
        self.assertEqual([(b["purchases"], b["wins"]) for b in data["buy_timing"]], [(1, 1), (0, 0), (0, 0), (1, 0), (0, 0), (0, 0), (1, 1)])
        self.assertEqual([(h["hero_id"], h["games"], h["wins"], h["hero_games"]) for h in data["heroes"]], [(2, 2, 1, 2), (7, 1, 1, 2)])
        self.assertEqual([(p["account_id"], p["name"], p["games"], p["player_games"]) for p in data["players"]], [(7, "Ann", 2, 2), (8, "Bo", 1, 2)])
        self.assertEqual([r["match_id"] for r in data["recent"]], [2, 2, 1])
        self.assertEqual([b["buy_s"] for b in data["buys"]], [100, 1000, 2400])
        self.assertEqual(sorted(data["builds"]), [(1, 7), (2, 7), (2, 8)])


class ItemsStatsRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        # mkdtemp + ignore_errors on cleanup: Windows keeps the SQLite handle open
        # past the request, and TemporaryDirectory.cleanup() would raise on it.
        self.tmpdir = Path(tempfile.mkdtemp(prefix="dlns-items-stats-"))
        self.db_path = self.tmpdir / "dlns.sqlite3"
        os.environ["DB_PATH"] = str(self.db_path)
        os.environ["CACHE_DIR"] = str(self.tmpdir / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        with self.app.app_context():
            cache.set("dlns_item_catalog", CATALOG)
            # The item page reads the description from the raw catalogue; never fetch it.
            cache.set("dlns_items_list", [{"id": BULLETS, "description": {"desc": "Bleeds <b>them</b>."}}])

        rows = [
            # match, account, result, purchases
            (1, 1, "Win", [buy(SHOTS, 100)]),              # week 60, EU
            (1, 2, "Loss", [buy(SHOTS, 200), buy(BULLETS, 900)]),
            (2, 1, "Win", [buy(BULLETS, 700)]),            # week 61, EU
            (2, 2, "Loss", [buy(SHOTS, 50, sold=600)]),
            (3, 3, "Win", [buy(BULLETS, 800)]),            # week 61, NA
            (3, 4, "Loss", []),
        ]
        conn = sqlite3.connect(self.db_path)
        try:
            conn.executescript(
                """
                INSERT INTO matches (match_id, duration_s, winning_team, event_title, event_week,
                    event_team_a, event_team_b, event_region) VALUES
                    (1, 1800, 0, 'Night Shift', 60, 'Owls', 'Rats', 'EU'),
                    (2, 1800, 0, 'Night Shift', 61, 'Owls', 'Rats', 'EU'),
                    (3, 1800, 0, 'Night Shift', 61, 'Cats', 'Dogs', 'NA');
                """
            )
            conn.executemany(
                "INSERT INTO players (match_id, account_id, player_slot, team, hero_id, result, raw_items_json, player_damage) "
                "VALUES (?, ?, 1, 0, 7, ?, ?, 1000)",
                [(m, a, r, json.dumps(p)) for m, a, r, p in rows],
            )
            conn.executescript(
                """
                INSERT INTO users (account_id, persona_name) VALUES (1, 'Ann'), (2, 'Bo');
                INSERT INTO player_damage_sources (match_id, account_id, source, damage) VALUES
                    (1, 2, 'upgrade_toxic_bullets', 300),
                    (2, 1, 'upgrade_toxic_bullets', 100),
                    (2, 1, 'Bullet', 900);
                """
            )
            conn.commit()
        finally:
            conn.close()

    def tearDown(self):
        with self.app.app_context():
            cache.clear()
        for key, value in self._old_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def _get(self, query=""):
        response = self.client.get(f"/db/items/stats?{query}")
        self.assertEqual(response.status_code, 200)
        return response.get_json()

    def test_range_and_region(self):
        data = self._get("weeks=60-61&region=eu")
        self.assertEqual((data["range"], data["region"], data["matches"], data["player_games"]), ([60, 61], "EU", 2, 4))
        items = {row["id"]: row for row in data["items"]}
        self.assertEqual((items[SHOTS]["games"], items[SHOTS]["wins"], items[SHOTS]["sold"]), (3, 1, 1))
        self.assertEqual((items[BULLETS]["games"], items[BULLETS]["wins"]), (2, 1))
        self.assertEqual(items[BULLETS]["median_buy_s"], 800)

    def test_default_is_the_stats_page_default(self):
        # No ?weeks= -> the latest two weeks, all regions; the empty NA player is skipped.
        data = self._get()
        self.assertEqual((data["range"], data["region"], data["matches"], data["player_games"]), ([60, 61], "All", 3, 5))

    def test_single_week_other_region(self):
        data = self._get("weeks=61&region=na")
        self.assertEqual([(row["id"], row["games"], row["wins"]) for row in data["items"]], [(BULLETS, 1, 1)])

    def test_item_page(self):
        response = self.client.get(f"/db/items/{BULLETS}/stats?weeks=60-61&region=eu")
        self.assertEqual(response.status_code, 200)
        data = response.get_json()
        self.assertEqual((data["matches"], data["player_games"]), (2, 4))
        self.assertEqual(data["item"]["name"], "Toxic Bullets")
        self.assertEqual(data["item"]["description"], "Bleeds them.")
        self.assertEqual(data["totals"], {"games": 2, "wins": 1, "sold": 0, "median_buy_s": 800})
        self.assertEqual([p["name"] for p in data["players"]], ["Ann", "Bo"])
        self.assertEqual(data["recent"][0]["match_id"], 2)
        self.assertNotIn("builds", data)
        # 400 item damage over its 2 games; the builders dealt 2000 hero damage in total.
        self.assertEqual(data["damage"], {"total": 400, "per_game": 200, "share": 0.2})

    def test_item_page_without_damage(self):
        data = self.client.get(f"/db/items/{SHOTS}/stats?weeks=60-61").get_json()
        self.assertEqual(data["totals"]["games"], 3)
        self.assertIsNone(data["damage"])

    def test_unknown_and_ability_items_are_not_found(self):
        self.assertEqual(self.client.get("/db/items/999/stats").status_code, 404)
        self.assertEqual(self.client.get(f"/db/items/{ABILITY}/stats").status_code, 404)

    def test_empty_event(self):
        data = self._get("event_title=Nope")
        self.assertEqual((data["range"], data["matches"], data["items"]), (None, 0, []))


if __name__ == "__main__":
    unittest.main()
