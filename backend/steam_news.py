"""Deadlock's Steam announcements, so a week can link to the one it followed.

Every post on the game's Steam news feed is kept, not just the patch notes: a
hero release or a big update ("City Never Sleeps") is what a night's games came
after, and that context is the point of the link. Third-party press pieces, which
the feed also carries, are dropped by feed name.

`ISteamNews` returns the whole history in a single keyless request, so it is
fetched once and cached on disk in `data/_cache/` (git-ignored).

The URL that endpoint hands back is an internal `externalpost` link, so each
post's canonical store URL is resolved once — it redirects to the announcement
page, whose id is one above the store news id — and remembered, which means only
newly published posts cost an extra request.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

APP_ID = 1422450
NEWS_URL = (
    "https://api.steampowered.com/ISteamNews/GetNewsForApp/v2/"
    f"?appid={APP_ID}&count=200&format=json"
)
STORE_URL = f"https://store.steampowered.com/news/app/{APP_ID}/view/"

RESYNC_INTERVAL_S = 6 * 3600
REQUEST_TIMEOUT_S = 45

# Games in one sitting are minutes apart; anything longer is a new session. Used
# to tell "the patch dropped mid-broadcast" from "the patch dropped overnight".
SESSION_GAP_S = 2 * 3600

_ANNOUNCEMENTS_FEED = "steam_community_announcements"

_UA = {"User-Agent": "dlns-stats-site/1.0 (+night shift patch notes)"}


def default_cache_dir() -> Path:
    override = os.getenv("PATCH_NOTES_CACHE_DIR")
    return Path(override) if override else Path.cwd() / "data" / "_cache"


def iso_to_epoch(value: Any) -> Optional[int]:
    if not value:
        return None
    try:
        dt = datetime.fromisoformat(str(value).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return int(dt.timestamp())


def epoch_to_iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).isoformat()


def _fetch(url: str) -> str:
    with urllib.request.urlopen(urllib.request.Request(url, headers=_UA), timeout=REQUEST_TIMEOUT_S) as handle:
        return handle.read().decode("utf-8", "replace")


def resolve_store_url(external_url: str) -> Optional[str]:
    """Canonical store news URL for a note, from the URL the news API returns.

    That URL redirects to the announcement page; Steam numbers the store news
    item one below that page's id.
    """
    try:
        with urllib.request.urlopen(urllib.request.Request(external_url, headers=_UA), timeout=REQUEST_TIMEOUT_S) as handle:
            final = handle.geturl()
    except (urllib.error.URLError, OSError, ValueError):
        return None
    match = re.search(r"/announcements/detail/(\d+)", final or "")
    if not match:
        return None
    return f"{STORE_URL}{int(match.group(1)) - 1}"


def _sittings(games: Sequence[Tuple[int, int]]) -> List[Tuple[int, int, int]]:
    """Group a week's games into sittings, splitting on gaps over SESSION_GAP_S.

    Returns `(start, end, game_count)` per sitting, in order. Used both to tell a
    patch that landed mid-broadcast from one that landed overnight, and to find
    the week's own broadcast.
    """
    ordered = sorted(games)
    if not ordered:
        return []
    sittings = [[ordered[0][0], ordered[0][1], 1]]
    for start, end in ordered[1:]:
        if start - sittings[-1][1] > SESSION_GAP_S:
            sittings.append([start, end, 1])
        else:
            sittings[-1][1] = max(sittings[-1][1], end)
            sittings[-1][2] += 1
    return [tuple(sitting) for sitting in sittings]  # type: ignore[misc]


def news_for_week(
    entries: Iterable[Dict[str, Any]],
    games: Sequence[Tuple[int, int]],
) -> Optional[Dict[str, Any]]:
    """The announcement a week's games came after.

    The newest post published by the time the week's own broadcast finished, so
    every week gets one and each shows what was actually current for it. Flagged
    with `during_games` when it landed while that broadcast was running — the case
    where part of the night played on without it.

    The reference is the busiest sitting rather than the week's last game at all,
    because a handful of weeks carry a synthetic placeholder row stamped months
    away that would otherwise drag the cutoff forward.
    """
    sittings = _sittings(games)
    if not sittings:
        return None
    _, finished, _ = max(sittings, key=lambda sitting: (sitting[2], sitting[1]))
    candidates = [entry for entry in entries if entry.get("ts") is not None and entry["ts"] <= finished]
    if not candidates:
        return None
    newest = max(candidates, key=lambda entry: entry["ts"])
    return {**newest, "during_games": any(start <= newest["ts"] <= end for start, end, _ in sittings)}


class SteamNewsStore:
    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self.cache_dir = Path(cache_dir) if cache_dir else default_cache_dir()
        self.cache_path = self.cache_dir / "steam_news.json"
        self._lock = threading.Lock()
        self._entries: List[Dict[str, Any]] = []
        self._resolved: Dict[str, str] = {}
        self._synced_at = 0
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self._entries = [dict(entry) for entry in data.get("entries", [])]
            self._resolved = {str(k): str(v) for k, v in data.get("resolved_urls", {}).items()}
            self._synced_at = int(data.get("synced_at", 0))
        except (OSError, ValueError, TypeError):
            self._entries, self._resolved, self._synced_at = [], {}, 0

    def _save(self) -> None:
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(
                    {
                        "synced_at": self._synced_at,
                        "entries": self._entries,
                        "resolved_urls": self._resolved,
                    }
                ),
                encoding="utf-8",
            )
            os.replace(tmp, self.cache_path)
        except OSError:
            pass

    def sync(self) -> bool:
        """Refresh the post list from Steam, resolving any store URL we lack."""
        try:
            payload = json.loads(_fetch(NEWS_URL))
        except (urllib.error.URLError, OSError, ValueError):
            return False
        items = payload.get("appnews", {}).get("newsitems") or []
        entries = []
        for item in items:
            if item.get("feedname") != _ANNOUNCEMENTS_FEED:
                continue
            title = str(item.get("title") or "").strip()
            gid = str(item.get("gid") or "")
            published = int(item.get("date") or 0)
            if not title or not gid or not published:
                continue
            url = self._resolved.get(gid)
            if url is None:
                url = resolve_store_url(str(item.get("url") or ""))
                if url:
                    self._resolved[gid] = url
            entries.append(
                {
                    "gid": gid,
                    "title": title,
                    "ts": published,
                    "published_at": epoch_to_iso(published),
                    "url": url,
                }
            )
        if not entries:
            return False
        self._entries = entries
        self._synced_at = int(time.time())
        self._save()
        return True

    def entries(self) -> List[Dict[str, Any]]:
        with self._lock:
            if not self._entries or time.time() - self._synced_at > RESYNC_INTERVAL_S:
                self.sync()
            return list(self._entries)

    def news_for_week(self, games: Sequence[Tuple[int, int]]) -> Optional[Dict[str, Any]]:
        return news_for_week(self.entries(), games)


_default_store: Optional[SteamNewsStore] = None
_default_lock = threading.Lock()


def get_store() -> SteamNewsStore:
    global _default_store
    with _default_lock:
        if _default_store is None:
            _default_store = SteamNewsStore()
        return _default_store


def latest_news_for_games(games: Sequence[Tuple[int, int]]) -> Optional[Dict[str, Any]]:
    """The announcement a week's games came after. `games` is [(start, end)]."""
    if not games:
        return None
    try:
        return get_store().news_for_week(games)
    except Exception:  # noqa: BLE001 - a missing link must never break the week page
        return None
