import tempfile
import unittest
from pathlib import Path

from backend.app.utils.item_icons import (
    icon_index,
    icon_key,
    item_image_root,
    resolve_icon,
    shop_item_name,
)


def write_png(root: Path, rel: str) -> None:
    path = root / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(b"\x89PNG\r\n\x1a\n")


class IconKeyTests(unittest.TestCase):
    def test_ignores_case_separators_and_punctuation(self):
        self.assertEqual(icon_key("Bullet Armor"), "bulletarmor")
        self.assertEqual(icon_key("bullet_armor_psd"), "bulletarmorpsd")
        self.assertEqual(icon_key("High-Velocity Rounds"), "highvelocityrounds")
        self.assertEqual(icon_key("Hunter's Aura"), "huntersaura")
        self.assertEqual(icon_key(None), "")

    def test_reads_ampersand_as_and(self):
        self.assertEqual(icon_key("Mo & Krill"), icon_key("Mo and Krill"))


class ShopItemNameTests(unittest.TestCase):
    def test_returns_the_display_name_of_a_real_item(self):
        self.assertEqual(shop_item_name({"name": "Extended Magazine", "class_name": "upgrade_clip_size"}), "Extended Magazine")

    def test_rejects_rows_that_are_not_purchasable_items(self):
        # The catalog carries hundreds of internals whose name repeats the class name.
        self.assertIsNone(shop_item_name({"name": "upgrade_clip_size", "class_name": "upgrade_clip_size"}))
        self.assertIsNone(shop_item_name({"name": "upgrade_stabilizer", "class_name": "upgrade_stabilizer"}))
        self.assertIsNone(shop_item_name({"name": "", "class_name": "upgrade_clip_size"}))
        self.assertIsNone(shop_item_name({}))


class IconIndexTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "items"

    def tearDown(self):
        self.tmp.cleanup()

    def test_indexes_slot_scoped_and_slot_agnostic_keys(self):
        write_png(self.root, "vitality/bullet_resilience_psd.png")
        index = icon_index(self.root)
        self.assertEqual(index["vitality/bulletresilience"], "vitality/bullet_resilience_psd.png")
        self.assertEqual(index["*/bulletresilience"], "vitality/bullet_resilience_psd.png")

    def test_strips_the_psd_suffix_and_keeps_differently_named_files(self):
        write_png(self.root, "weapon/stalker.png")
        write_png(self.root, "weapon/spirit_rend.png")
        index = icon_index(self.root)
        self.assertEqual(index["weapon/stalker"], "weapon/stalker.png")
        self.assertEqual(index["*/spiritrend"], "weapon/spirit_rend.png")

    def test_missing_folder_indexes_nothing(self):
        self.assertEqual(icon_index(Path(self.tmp.name) / "nope"), {})


class ResolveIconTests(unittest.TestCase):
    """The bug this module exists for: the file is not named after the display name."""

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name) / "items"
        write_png(self.root, "vitality/bullet_resilience_psd.png")
        write_png(self.root, "legendaries/aerial_mastery_psd.png")
        write_png(self.root, "vitality/dispel_magic_psd.png")
        write_png(self.root, "weapon/monster_rounds_psd.png")
        self.index = icon_index(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_resolves_through_the_asset_name_when_the_display_name_differs(self):
        item = {
            "name": "Bullet Armor",
            "class_name": "upgrade_bullet_armor",
            "item_slot_type": "vitality",
            "shop_image": "https://cdn.example/assets/items/vitality/bullet_resilience.png",
        }
        self.assertEqual(resolve_icon(item, self.index), "vitality/bullet_resilience_psd.png")

    def test_matches_the_display_name_when_the_asset_name_is_absent(self):
        item = {"name": "Monster Rounds", "class_name": "upgrade_monster_rounds", "item_slot_type": "weapon"}
        self.assertEqual(resolve_icon(item, self.index), "weapon/monster_rounds_psd.png")

    def test_falls_back_across_folders_because_the_upstream_slot_drifts(self):
        # Dispel Magic is "spirit" upstream but ships under vitality/ here.
        item = {"name": "Dispel Magic", "class_name": "upgrade_dispel_magic", "item_slot_type": "spirit"}
        self.assertEqual(resolve_icon(item, self.index), "vitality/dispel_magic_psd.png")

    def test_still_matches_when_the_asset_name_has_a_legacy_filename(self):
        item = {
            "name": "Aerial Supremacy",
            "class_name": "upgrade_aerial_supremacy",
            "item_slot_type": "vitality",
            "shop_image": "https://cdn.example/assets/items/vitality/aerial_mastery.png",
        }
        self.assertEqual(resolve_icon(item, self.index), "legendaries/aerial_mastery_psd.png")

    def test_returns_none_when_no_file_matches(self):
        item = {"name": "Toughness", "class_name": "upgrade_toughness", "item_slot_type": "vitality"}
        self.assertIsNone(resolve_icon(item, self.index))
        self.assertIsNone(resolve_icon({}, self.index))


class ItemImageRootTests(unittest.TestCase):
    def test_finds_the_shipped_item_folder_in_this_repo(self):
        # `root_path` is backend/app; the art ships beside it under public/images/items.
        app_root = Path(__file__).resolve().parents[2] / "backend" / "app"
        root = item_image_root(app_root)
        self.assertEqual(root.parts[-3:], ("public", "images", "items"))
        self.assertTrue(root.is_dir(), root)
        self.assertTrue(any(root.rglob("*.png")), "expected shipped item art")


if __name__ == "__main__":
    unittest.main()
