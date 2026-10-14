import os
import tempfile
import unittest
from pathlib import Path

from backend.app.cache import cache
from backend.app.main_web import create_app


def shop_item(**overrides):
    item = {
        "id": 1,
        "name": "Bullet Armor",
        "class_name": "upgrade_bullet_armor",
        "item_slot_type": "vitality",
        "item_tier": 2,
        "cost": 1250,
        "shopable": True,
        "image": "https://cdn.example/items/bullet_armor.png",
        "shop_image": "https://cdn.example/assets/images/items/vitality/bullet_resilience.png",
    }
    item.update(overrides)
    return item


class ItemsListRouteTests(unittest.TestCase):
    """`/dlns/items` hands the client a resolved `icon`, and never the internal rows.

    The resolution runs against the art actually shipped in this repo, so these
    assertions cover the real filenames rather than a fixture.
    """

    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        # The app keeps a read-only DB connection open, which can still be locked at
        # cleanup on Windows; the assertions have already run by then.
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()

        # Seed the raw catalogue so the route never reaches the upstream API.
        with self.app.app_context():
            cache.delete("dlns_items_list_enriched")
            cache.delete("dlns_item_icon_index")
            cache.set(
                "dlns_items_list",
                [
                    shop_item(),
                    # Internal variant: name repeats the class name, no art.
                    shop_item(id=2, name="upgrade_stabilizer", class_name="upgrade_stabilizer", item_slot_type="weapon"),
                    # A real item whose art was never cut — the client shows the API image.
                    shop_item(
                        id=3,
                        name="Toughness",
                        class_name="upgrade_toughness",
                        image="https://cdn.example/items/health.png",
                        shop_image="",
                    ),
                ],
                timeout=600,
            )

    def tearDown(self):
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self.tmp.cleanup()

    def test_resolves_the_icon_from_the_shipped_art(self):
        payload = self.client.get("/dlns/items").get_json()
        by_name = {row["name"]: row for row in payload}

        # The display name ("Bullet Armor") does not match the file, so only the asset
        # name in shop_image can resolve it.
        self.assertEqual(by_name["Bullet Armor"]["icon"], "items/vitality/bullet_resilience_psd.png")

        # No shipped art: icon stays null so the client uses `image` instead.
        self.assertIsNone(by_name["Toughness"]["icon"])
        self.assertEqual(by_name["Toughness"]["image"], "https://cdn.example/items/health.png")

    def test_drops_internal_rows(self):
        payload = self.client.get("/dlns/items").get_json()
        self.assertEqual(sorted(row["name"] for row in payload), ["Bullet Armor", "Toughness"])

    def test_keeps_the_upstream_fields_the_page_reads(self):
        payload = self.client.get("/dlns/items").get_json()
        row = next(r for r in payload if r["name"] == "Bullet Armor")
        for key in ("id", "item_slot_type", "item_tier", "cost", "shopable", "image", "shop_image"):
            self.assertIn(key, row)


if __name__ == "__main__":
    unittest.main()
