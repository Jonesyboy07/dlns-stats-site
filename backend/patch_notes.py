"""Deadlock patch notes, so a week can link to the one it was played on.

The notes are posted to Steam's news feed for app 1422450. `ISteamNews` returns
the whole post history in a single keyless request, which is plenty for a season,
so it is fetched once and cached on disk in `data/_cache/` (git-ignored).

The URL that endpoint hands back is an internal `externalpost` link, so each
note's canonical store URL is resolved once — it redirects to the announcement
page, whose id is one above the store news id — and remembered, which means only
newly posted notes cost an extra request.

Only posts that read as patch notes are kept; the feed also carries hero reveals
and marketing posts, which are not what a week's stats should link to.
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

_PATCH_WORDS = ("update", "patch", "hotfix")
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


def looks_like_patch_note(title: str) -> bool:
    return any(word in str(title or "").lower() for word in _PATCH_WORDS)


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


def _sessions(games: Sequence[Tuple[int, int]]) -> List[Tuple[int, int]]:
    """Group a week's games into sittings, splitting on gaps over SESSION_GAP_S."""
    ordered = sorted(games)
    if not ordered:
        return []
    sessions = [[ordered[0][0], ordered[0][1]]]
    for start, end in ordered[1:]:
        if start - sessions[-1][1] > SESSION_GAP_S:
            sessions.append([start, end])
        else:
            sessions[-1][1] = max(sessions[-1][1], end)
    return [tuple(session) for session in sessions]  # type: ignore[misc]


def notes_in_window(
    notes: Iterable[Dict[str, Any]],
    games: Sequence[Tuple[int, int]],
) -> List[Dict[str, Any]]:
    """Patch notes posted during a week, each flagged with `during_games`.

    The window is the week's first game start to its last game end, so a note
    posted in the long gap between two nights is included but not flagged: the
    night did not carry on under the new patch. A note inside a sitting, or in the
    short gap between two games of one, is flagged because it did.
    """
    sessions = _sessions(games)
    if not sessions:
        return []
    lo = min(session[0] for session in sessions)
    hi = max(session[1] for session in sessions)
    found = []
    for note in notes:
        ts = note.get("ts")
        if ts is None or not (lo <= ts <= hi):
            continue
        found.append(
            {
                **note,
                "during_games": any(start <= ts <= end for start, end in sessions),
            }
        )
    return sorted(found, key=lambda note: note["ts"])


class PatchNotesStore:
    def __init__(self, cache_dir: Optional[Path] = None) -> None:
        self.cache_dir = Path(cache_dir) if cache_dir else default_cache_dir()
        self.cache_path = self.cache_dir / "patch_notes.json"
        self._lock = threading.Lock()
        self._notes: List[Dict[str, Any]] = []
        self._resolved: Dict[str, str] = {}
        self._synced_at = 0
        self._load()

    def _load(self) -> None:
        try:
            data = json.loads(self.cache_path.read_text(encoding="utf-8"))
            self._notes = [dict(note) for note in data.get("notes", [])]
            self._resolved = {str(k): str(v) for k, v in data.get("resolved_urls", {}).items()}
            self._synced_at = int(data.get("synced_at", 0))
        except (OSError, ValueError, TypeError):
            self._notes, self._resolved, self._synced_at = [], {}, 0

    def _save(self) -> None:
        try:
            self.cache_dir.mkdir(parents=True, exist_ok=True)
            tmp = self.cache_path.with_suffix(".tmp")
            tmp.write_text(
                json.dumps(
                    {
                        "synced_at": self._synced_at,
                        "notes": self._notes,
                        "resolved_urls": self._resolved,
                    }
                ),
                encoding="utf-8",
            )
            os.replace(tmp, self.cache_path)
        except OSError:
            pass

    def sync(self) -> bool:
        """Refresh the note list from Steam, resolving any store URL we lack."""
        try:
            payload = json.loads(_fetch(NEWS_URL))
        except (urllib.error.URLError, OSError, ValueError):
            return False
        items = payload.get("appnews", {}).get("newsitems") or []
        notes = []
        for item in items:
            if item.get("feedname") != _ANNOUNCEMENTS_FEED:
                continue
            title = str(item.get("title") or "").strip()
            if not title or not looks_like_patch_note(title):
                continue
            gid = str(item.get("gid") or "")
            published = int(item.get("date") or 0)
            if not gid or not published:
                continue
            url = self._resolved.get(gid)
            if url is None:
                url = resolve_store_url(str(item.get("url") or ""))
                if url:
                    self._resolved[gid] = url
            notes.append(
                {
                    "gid": gid,
                    "title": title,
                    "ts": published,
                    "published_at": epoch_to_iso(published),
                    "url": url,
                }
            )
        if not notes:
            return False
        self._notes = notes
        self._synced_at = int(time.time())
        self._save()
        return True

    def notes(self) -> List[Dict[str, Any]]:
        with self._lock:
            if not self._notes or time.time() - self._synced_at > RESYNC_INTERVAL_S:
                self.sync()
            return list(self._notes)

    def notes_in_window(self, games: Sequence[Tuple[int, int]]) -> List[Dict[str, Any]]:
        return notes_in_window(self.notes(), games)


_default_store: Optional[PatchNotesStore] = None
_default_lock = threading.Lock()


def get_store() -> PatchNotesStore:
    global _default_store
    with _default_lock:
        if _default_store is None:
            _default_store = PatchNotesStore()
        return _default_store


def notes_in_week(games: Sequence[Tuple[int, int]]) -> List[Dict[str, Any]]:
    """Patch notes posted during a week's play windows. `games` is [(start, end)]."""
    if not games:
        return []
    try:
        return get_store().notes_in_window(games)
    except Exception:  # noqa: BLE001 - a missing link must never break the week page
        return []
