"""Item-icon resolution: which shipped PNG represents an upstream item.

The catalog's display names do not match the filenames cut from the game files —
"Bullet Armor" ships as ``bullet_resilience_psd.png`` and "Armor Piercer" as
``armor_piercing_rounds_psd.png`` — and the upstream row only sometimes carries the
asset name in ``shop_image``. Rebuilding a filename from the display name therefore
404s, so the lookup lives here once: the item list, the match build panel and the item
catalog all resolve through this module instead of guessing.

Keys ignore punctuation and case because the two sides disagree on both (Hunter's Aura
is ``hunter's_aura_psd.png`` locally but ``hunters_aura.png`` upstream), with ``&``
read as ``and``.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Mapping, Optional

from flask import current_app

from ..cache import cache

# The shipped item art, relative to the project root.
ITEM_IMAGE_PARTS = ("public", "images", "items")

# One cache entry for the whole folder listing; it only changes when art is added.
ICON_INDEX_CACHE_KEY = "dlns_item_icon_index"


def icon_key(value: Any) -> str:
    """A punctuation-, case- and separator-insensitive key for an icon name."""
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower().replace("&", "and"))


def shop_item_name(item: Mapping[str, Any]) -> Optional[str]:
    """The display name of a purchasable item, or None for internal/duplicate rows.

    Rows whose name repeats the class name, and ``upgrade_*`` internals, are never real
    purchases: they carry no art and should not be listed as shop items.
    """
    name = str(item.get("name") or "")
    class_name = str(item.get("class_name") or "")
    if not name or name == class_name or name.startswith("upgrade_"):
        return None
    return name


def icon_index(root: Path) -> Dict[str, str]:
    """Map candidate keys to shipped paths beneath ``root``.

    Each file contributes ``'<slot>/<key>'`` plus a slot-agnostic ``'*/<key>'``, because
    the asset API's item category drifts from the folders shipped here (Dispel Magic is
    "spirit" upstream and "vitality" here).
    """
    index: Dict[str, str] = {}
    for path in sorted(Path(root).rglob("*.png")):
        rel = path.relative_to(root).as_posix()
        slot, _, filename = rel.partition("/")
        if not filename:
            continue
        stem = filename[:-4]
        if stem.endswith("_psd"):
            stem = stem[:-4]
        key = icon_key(stem)
        if not key:
            continue
        index.setdefault(f"{slot}/{key}", rel)
        index.setdefault(f"*/{key}", rel)
    return index


def item_image_root(app_root: Any) -> Path:
    """``<project root>/public/images/items`` from Flask's ``app.root_path``.

    ``root_path`` is ``backend/app``, so its parent's parent is the project root.
    """
    return Path(app_root).resolve().parents[1].joinpath(*ITEM_IMAGE_PARTS)


def resolve_icon(item: Mapping[str, Any], index: Mapping[str, str]) -> Optional[str]:
    """The shipped path for an upstream item, or None when no file matches.

    The asset name from ``shop_image`` is tried before the display name, since the game
    tracks renames in its own asset path: most items whose display name differs from the
    shipped file only resolve this way.
    """
    slot = str(item.get("item_slot_type") or "")
    shop_image = str(item.get("shop_image") or "")
    shop_base = shop_image.rsplit("/", 1)[-1].rsplit(".", 1)[0] if shop_image else ""
    candidates = []
    for key in (icon_key(shop_base), icon_key(shop_item_name(item) or "")):
        if key:
            candidates += [f"{slot}/{key}", f"*/{key}"]
    return next((index[key] for key in candidates if key in index), None)


def item_icon_index() -> Dict[str, str]:
    """`icon_index()` for the running app, cached so the folder is walked once."""
    cached = cache.get(ICON_INDEX_CACHE_KEY)
    if cached is not None:
        return cached
    root = item_image_root(current_app.root_path)
    try:
        index = icon_index(root)
    except OSError:
        current_app.logger.warning("Item icon folder unreadable: %s", root)
        index = {}
    if index:
        cache.set(ICON_INDEX_CACHE_KEY, index, timeout=21600)
    return index
