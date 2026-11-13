import os
import tempfile
import unittest
from pathlib import Path

from backend.app.blueprints.db.items import MAX_CARD_IDS, _parse_ids, item_cards
from backend.app.cache import cache
from backend.app.main_web import create_app


def item(**fields):
    base = {"id": 1, "name": "Item", "class_name": "upgrade_item", "component_items": []}
    base.update(fields)
    return base


CATALOGUE = [
    item(id=10, name="Close Quarters", class_name="upgrade_close_quarters", shop_image="https://cdn/cq.png"),
    item(
        id=20,
        name="Point Blank",
        class_name="upgrade_point_blank",
        component_items=["upgrade_close_quarters", "upgrade_missing"],
        shop_image_webp="https://cdn/pb.webp",
        shop_image="https://cdn/pb.png",
    ),
    item(id=30, name="Spiritual Overflow", class_name="upgrade_overflow", component_items=["upgrade_close_quarters"], image="https://cdn/so.png"),
    "not an item",
]


class ItemCardsTests(unittest.TestCase):
    def test_returns_item_verbatim_with_build_paths(self):
        cards = item_cards(CATALOGUE, [10, 20])

        self.assertEqual(set(cards), {"10", "20"})
        self.assertIs(cards["20"]["item"], CATALOGUE[1])
        # Built from: known components only, image picked like dl-item-card does.
        self.assertEqual(cards["20"]["components"], [{"name": "Close Quarters", "image": "https://cdn/cq.png"}])
        # Builds into: every item listing it as a component, webp preferred.
        self.assertEqual(
            cards["10"]["parents"],
            [
                {"name": "Point Blank", "image": "https://cdn/pb.webp"},
                {"name": "Spiritual Overflow", "image": "https://cdn/so.png"},
            ],
        )
        self.assertEqual(cards["20"]["parents"], [])

    def test_unknown_ids_are_left_out(self):
        self.assertEqual(item_cards(CATALOGUE, [999]), {})

    def test_parse_ids_dedupes_drops_junk_and_caps(self):
        self.assertEqual(_parse_ids("3, 1,abc,,3,-2,0"), [3, 1])
        self.assertEqual(_parse_ids(None), [])
        many = ",".join(str(n) for n in range(1, MAX_CARD_IDS + 50))
        self.assertEqual(len(_parse_ids(many)), MAX_CARD_IDS)


class ItemCardsRouteTests(unittest.TestCase):
    def setUp(self):
        self._old_env = {key: os.environ.get(key) for key in ("DB_PATH", "CACHE_DIR", "CACHE_WARMUP_ON_STARTUP")}
        self.tmp = tempfile.TemporaryDirectory(ignore_cleanup_errors=True)
        os.environ["DB_PATH"] = str(Path(self.tmp.name) / "dlns.sqlite3")
        os.environ["CACHE_DIR"] = str(Path(self.tmp.name) / "cache")
        os.environ["CACHE_WARMUP_ON_STARTUP"] = "false"
        self.app = create_app()
        self.app.config["TESTING"] = True
        self.client = self.app.test_client()
        with self.app.app_context():
            cache.set("dlns_items_list", CATALOGUE, timeout=600)

    def tearDown(self):
        for key, old in self._old_env.items():
            if old is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = old
        self.tmp.cleanup()

    def test_serves_requested_cards(self):
        payload = self.client.get("/db/items/cards?ids=20,999").get_json()
        self.assertEqual(list(payload["items"]), ["20"])
        self.assertEqual(payload["items"]["20"]["item"]["name"], "Point Blank")

    def test_no_ids_is_an_empty_result(self):
        self.assertEqual(self.client.get("/db/items/cards").get_json(), {"items": {}})


if __name__ == "__main__":
    unittest.main()
