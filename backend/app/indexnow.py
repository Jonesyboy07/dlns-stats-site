"""IndexNow submission support (Bing, Yandex, Seznam and friends).

IndexNow asks the site to serve a key file at ``/<key>.txt`` and then POST a
small JSON payload whenever URLs are created or change. The key is optional: if
``INDEXNOW_KEY`` is unset the feature is inert and the key route 404s.
"""

from __future__ import annotations

import re
from typing import Any, Iterable
from urllib.parse import urlparse

import requests
from flask import current_app

DEFAULT_ENDPOINT = "https://api.indexnow.org/indexnow"
MAX_URLS_PER_REQUEST = 10_000
_KEY_RE = re.compile(r"^[A-Za-z0-9-]{8,128}$")


def configured_key() -> str:
    key = str(current_app.config.get("INDEXNOW_KEY", "") or "").strip()
    return key if _KEY_RE.match(key) else ""


def key_file_path(key: str) -> str:
    return f"/{key}.txt"


def key_location(key: str, base_url: str) -> str:
    return f"{base_url.rstrip('/')}{key_file_path(key)}"


def _absolute(value: str, base_url: str) -> str:
    value = str(value).strip()
    if value.startswith(("http://", "https://")):
        return value
    return f"{base_url}{value}" if value.startswith("/") else f"{base_url}/{value}"


def submit_urls(paths: Iterable[str], *, timeout: float = 10.0) -> dict[str, Any]:
    """Submit paths or absolute URLs to IndexNow.

    Returns a small result dict so CLI callers can report status without needing
    to know the protocol's success codes.
    """
    key = configured_key()
    if not key:
        return {"ok": False, "status": 0, "message": "INDEXNOW_KEY is not configured or invalid"}

    base_url = str(current_app.config.get("BASE_URL", "") or "").strip().rstrip("/")
    host = urlparse(base_url).netloc
    if not host:
        return {"ok": False, "status": 0, "message": "BASE_URL must be an absolute public origin"}

    urls = [_absolute(path, base_url) for path in paths if str(path or "").strip()]
    if not urls:
        return {"ok": False, "status": 0, "message": "No URLs supplied"}
    urls = urls[:MAX_URLS_PER_REQUEST]

    payload = {
        "host": host,
        "key": key,
        "keyLocation": key_location(key, base_url),
        "urlList": urls,
    }
    endpoint = str(current_app.config.get("INDEXNOW_ENDPOINT", DEFAULT_ENDPOINT) or DEFAULT_ENDPOINT)
    try:
        response = requests.post(endpoint, json=payload, timeout=timeout)
    except Exception as exc:  # network failures are reported, not raised
        return {"ok": False, "status": 0, "message": str(exc)}

    return {
        "ok": response.status_code in (200, 202),
        "status": response.status_code,
        "message": (response.text or "").strip()[:300],
        "submitted": len(urls),
    }


def recent_paths(limit: int = 50) -> list[str]:
    """Newest valid matches, which are the URLs that change most often."""
    from .blueprints.db_api import get_ro_conn

    limit = max(1, min(int(limit or 0), MAX_URLS_PER_REQUEST))
    conn = get_ro_conn()
    try:
        rows = conn.execute(
            "SELECT match_id FROM matches "
            "WHERE match_id > 0 AND duration_s IS NOT NULL "
            "ORDER BY match_id DESC LIMIT ?",
            (limit,),
        ).fetchall()
        return [f"/matches/{row[0]}" for row in rows]
    finally:
        conn.close()
