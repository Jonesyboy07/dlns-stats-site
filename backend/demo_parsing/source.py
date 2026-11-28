"""Where a match's demo comes from, and how it becomes a raw `.dem` on disk.

Two sources, tried in order:

  1. The replay share (CDN). The site already indexes it (`_cache/replay_index.json`,
     built by scripts/build_replay_index.py) and serves downloads from
     REPLAY_DOWNLOAD_BASE_URL + the file's path. This is the archive: it keeps demos
     long after Valve deletes them.
  2. Valve's replay host, via deadlock-api's salts lookup. Valve keeps a demo for a few
     weeks at most, and custom lobbies often never publish one, so this only helps for
     recent matches.

What arrives is never a bare demo: the share stores a zip whose member is a
zstd-compressed `.dem` (magic 28 B5 2F FD), and Valve serves `.dem.bz2`. `extract_demo`
handles all of them by sniffing magic bytes, streaming so a 300 MB demo never sits in
memory, and checks the result really is a Source 2 demo (`PBDEMS2`).
"""

from __future__ import annotations

import bz2
import json
import shutil
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, BinaryIO, Callable, Mapping, Optional
from urllib.parse import quote

import requests

DEMO_MAGIC = b"PBDEMS2\x00"
ZSTD_MAGIC = b"\x28\xb5\x2f\xfd"
BZ2_MAGIC = b"BZh"

SALTS_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/salts"
_CHUNK = 1 << 20


class DemoNotFound(Exception):
    """Neither source has a demo for this match."""


class DemoFormatError(Exception):
    """The download is not (or does not contain) a readable demo."""


@dataclass(frozen=True)
class DemoLocation:
    source: str  # "cdn" | "valve"
    url: str


def load_replay_index(path: Path) -> Mapping[str, Mapping[str, Any]]:
    """The share's replay index, `{match_id: {name, path, size, ...}}`; empty if absent."""
    try:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    replays = payload.get("replays") if isinstance(payload, dict) else None
    return replays if isinstance(replays, dict) else {}


def cdn_url(base_url: str, item_path: str) -> str:
    """A share file's download URL, built exactly as the site builds it (db/matches.py)."""
    return f"{base_url.rstrip('/')}/{quote(item_path.lstrip('/'), safe='/')}"


def valve_demo_url(match_id: int, timeout: float = 10, get: Callable[..., Any] = requests.get) -> Optional[str]:
    """Valve's demo URL from deadlock-api's salts lookup, or None when there is none.

    A URL here only means a replay was published; Valve may have deleted it since,
    which the download then reports as DemoNotFound.
    """
    try:
        response = get(SALTS_URL.format(match_id=match_id), timeout=timeout)
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        return (response.json() or {}).get("demo_url") or None
    except ValueError:
        return None


def find_demo(
    match_id: int,
    *,
    replay_index: Mapping[str, Mapping[str, Any]],
    download_base_url: Optional[str],
    try_valve: bool = False,
    salts_lookup: Callable[[int], Optional[str]] = valve_demo_url,
) -> DemoLocation:
    """The best place to download `match_id`'s demo from. Raises DemoNotFound."""
    item = replay_index.get(str(match_id))
    if item and item.get("path") and download_base_url:
        return DemoLocation("cdn", cdn_url(download_base_url, item["path"]))
    if try_valve:
        url = salts_lookup(match_id)
        if url:
            return DemoLocation("valve", url)
    raise DemoNotFound(f"no demo for match {match_id}")


def download(url: str, dest: Path, timeout: float = 60, get: Callable[..., Any] = requests.get) -> Path:
    """Stream `url` to `dest`. A 404 or 403 is DemoNotFound (Valve deletes old demos)."""
    dest = Path(dest)
    dest.parent.mkdir(parents=True, exist_ok=True)
    with get(url, stream=True, timeout=timeout) as response:
        if response.status_code in (403, 404):
            raise DemoNotFound(f"{response.status_code} for {url}")
        response.raise_for_status()
        with open(dest, "wb") as handle:
            for chunk in response.iter_content(_CHUNK):
                if chunk:
                    handle.write(chunk)
    return dest


def _zstd_reader(stream: BinaryIO) -> BinaryIO:
    """A streaming zstd decompressor over `stream`."""
    try:
        from compression import zstd  # Python 3.14+

        return zstd.ZstdFile(stream, mode="rb")
    except ImportError:
        pass
    try:
        import zstandard  # optional dependency

        return zstandard.ZstdDecompressor().stream_reader(stream)
    except ImportError as exc:  # pragma: no cover - depends on the environment
        raise DemoFormatError(
            "The demo is zstd-compressed: run on Python 3.14+ or install `zstandard`."
        ) from exc


def _decompress_to(open_stream: Callable[[], BinaryIO], dest: Path) -> Path:
    """Write the demo behind `open_stream` to `dest`, undoing zstd or bz2 by magic bytes.

    `open_stream` is called twice -- once to sniff, once to copy -- so it must reopen
    from the start each time (a zip member or a file path both can).
    """
    with open_stream() as probe:
        head = probe.read(8)
    with open_stream() as raw:
        if head.startswith(ZSTD_MAGIC):
            reader: BinaryIO = _zstd_reader(raw)
        elif head.startswith(BZ2_MAGIC):
            reader = bz2.BZ2File(raw, mode="rb")
        elif head.startswith(DEMO_MAGIC):
            reader = raw
        else:
            raise DemoFormatError(f"unrecognised demo encoding (magic {head[:8].hex()})")
        with reader, open(dest, "wb") as out:
            shutil.copyfileobj(reader, out, _CHUNK)

    with open(dest, "rb") as check:
        if check.read(8) != DEMO_MAGIC:
            raise DemoFormatError("decompressed file is not a Source 2 demo")
    return dest


def extract_demo(archive: Path, work_dir: Path, match_id: int) -> Path:
    """A raw `.dem` from whatever was downloaded: a zip (any member encoding), a
    `.dem.bz2`, a zstd file, or a bare demo. Returns `<work_dir>/<match_id>.dem`.

    Only the demo member is read from a zip, and it is written under a fixed name, so a
    member's own path can never place a file outside `work_dir`.
    """
    archive = Path(archive)
    work_dir = Path(work_dir)
    work_dir.mkdir(parents=True, exist_ok=True)
    dest = work_dir / f"{match_id}.dem"

    if zipfile.is_zipfile(archive):
        with zipfile.ZipFile(archive) as bundle:
            members = [
                info for info in bundle.infolist()
                if not info.is_dir() and info.filename.lower().endswith((".dem", ".dem.bz2", ".dem.zst"))
            ]
            if not members:
                raise DemoFormatError(f"no demo inside {archive.name}")
            # Prefer the member named for the match, as the share's zips are.
            members.sort(key=lambda info: (not Path(info.filename).name.startswith(str(match_id)), info.filename))
            member = members[0]
            return _decompress_to(lambda: bundle.open(member), dest)

    return _decompress_to(lambda: open(archive, "rb"), dest)
