"""Canonical upstream Deadlock API endpoints.

The asset catalog used to live on the dedicated ``assets.deadlock-api.com``
host. That hostname was retired upstream and now resolves to NXDOMAIN, which
surfaced as ``[Errno 11001] getaddrinfo failed`` in the web logs. The catalog
moved under the main API host at ``api.deadlock-api.com/v1/assets/*``.

Keeping the endpoints in one import-cheap module means a future host move is a
one-line change instead of an eight-site hunt.

This module deliberately lives outside the ``app`` package so the standalone
``backend/main.py`` ingest script can import it without pulling in Flask.
"""

from __future__ import annotations

ASSETS_API_BASE = "https://api.deadlock-api.com/v1/assets"

# Full catalogs (each returns a JSON array).
ITEMS_URL = f"{ASSETS_API_BASE}/items"
HEROES_URL = f"{ASSETS_API_BASE}/heroes"

# Single-entity lookups. Callers append query params (language, client_version)
# via their HTTP client, so these stay free of query strings.
ITEM_DETAILS_URL = f"{ASSETS_API_BASE}/items/{{item_id}}"
HERO_DETAILS_URL = f"{ASSETS_API_BASE}/heroes/{{hero_id}}"

__all__ = [
    "ASSETS_API_BASE",
    "ITEMS_URL",
    "HEROES_URL",
    "ITEM_DETAILS_URL",
    "HERO_DETAILS_URL",
]
