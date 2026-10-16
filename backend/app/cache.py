from __future__ import annotations

import functools
import gzip
import hashlib
import threading
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from typing import Any, Callable, Optional

from flask import Response, current_app, request
from flask_caching import Cache

try:  # flask-compress prefers Brotli when present; do the same.
    import brotli  # type: ignore
except ImportError:  # pragma: no cover
    brotli = None

L1_MAX_BYTES = 128 * 1024 * 1024
L1_MAX_ENTRY_BYTES = 8 * 1024 * 1024
MIN_COMPRESS_BYTES = 512
# Entries older than this many seconds past expiry are never served stale.
MAX_STALE_SECONDS = 3600
# Short-lived routes (e.g. bans edited in the bracket editor) must never show old data.
NO_STALE_TTL_AT_OR_BELOW = 60
# Headers that describe the encoded body or the moment of the request, and so are
# rebuilt on every hit.
_VOLATILE_HEADERS = {"content-length", "content-encoding", "date", "server", "set-cookie"}


class _State:
    """Per-app cache state, so separate Flask apps never share in-memory entries."""

    def __init__(self) -> None:
        self.l1: "OrderedDict[str, dict]" = OrderedDict()
        self.l1_bytes = 0
        self.l1_lock = threading.Lock()
        self.inflight: dict[str, list] = {}
        self.inflight_lock = threading.Lock()
        self.refreshing: set[str] = set()
        self.data_ts = 0.0


class SWRCache(Cache):
    """flask-caching with a fast, stampede-safe, stale-while-revalidate `cached`.

    * L1: bounded in-process LRU, so hits skip disk reads and unpickling.
    * L2: the configured flask-caching backend, which survives restarts.
    * Expired entries are served immediately while one background thread refreshes them.
    * Concurrent misses for the same key share a single computation.
    * Gzip/Brotli bodies are built once at fill time, not on every request.
    """

    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, **kwargs)
        self._pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="cache-refresh")

    @property
    def _state(self) -> _State:
        extensions = current_app.extensions
        state = extensions.get("swr_state")
        if state is None:
            state = extensions.setdefault("swr_state", _State())
        return state

    @property
    def _l1(self) -> "OrderedDict[str, dict]":
        return self._state.l1

    @property
    def _l1_lock(self) -> threading.Lock:
        return self._state.l1_lock

    @property
    def _l1_bytes(self) -> int:
        return self._state.l1_bytes

    @_l1_bytes.setter
    def _l1_bytes(self, value: int) -> None:
        self._state.l1_bytes = value

    @property
    def _inflight(self) -> dict[str, list]:
        return self._state.inflight

    @property
    def _inflight_lock(self) -> threading.Lock:
        return self._state.inflight_lock

    @property
    def _refreshing(self) -> set[str]:
        return self._state.refreshing

    # ---- L1 ---------------------------------------------------------------
    @staticmethod
    def _entry_size(entry: dict) -> int:
        return len(entry["body"]) + len(entry.get("gz") or b"") + len(entry.get("br") or b"")

    def _l1_get(self, key: str) -> Optional[dict]:
        with self._l1_lock:
            entry = self._l1.get(key)
            if entry is not None:
                self._l1.move_to_end(key)
            return entry

    def _l1_put(self, key: str, entry: dict) -> None:
        size = self._entry_size(entry)
        if size > L1_MAX_ENTRY_BYTES:
            return
        with self._l1_lock:
            old = self._l1.pop(key, None)
            if old is not None:
                self._l1_bytes -= self._entry_size(old)
            self._l1[key] = entry
            self._l1_bytes += size
            while self._l1_bytes > L1_MAX_BYTES and self._l1:
                _, evicted = self._l1.popitem(last=False)
                self._l1_bytes -= self._entry_size(evicted)

    def clear(self) -> Any:  # type: ignore[override]
        with self._l1_lock:
            self._l1.clear()
            self._l1_bytes = 0
        return super().clear()

    # ---- helpers ----------------------------------------------------------
    @contextmanager
    def _single_flight(self, key: str):
        with self._inflight_lock:
            slot = self._inflight.setdefault(key, [threading.Lock(), 0])
            slot[1] += 1
        try:
            with slot[0]:
                yield
        finally:
            with self._inflight_lock:
                slot[1] -= 1
                if slot[1] <= 0:
                    self._inflight.pop(key, None)

    def _lookup(self, key: str) -> Optional[dict]:
        entry = self._l1_get(key)
        if entry is None:
            entry = self.get(key)
            if not isinstance(entry, dict) or "body" not in entry:
                return None
            self._l1_put(key, entry)
        now = time.time()
        if now >= entry["stale_until"]:
            return None
        if entry.get("created", now) < self._state.data_ts:
            # The data changed after this was built: never call it fresh. Short-lived
            # routes (no stale window) are dropped; the rest are served while they rebuild.
            if entry["stale_until"] <= entry["fresh_until"]:
                return None
            return {**entry, "fresh_until": 0.0}
        return entry

    def invalidate_data(self) -> None:
        """Mark every cached response as built from outdated data (all workers do this
        themselves via the DB watcher). Cheaper and gentler than `clear()`."""
        self._state.data_ts = time.time()

    def _store(
        self,
        key: str,
        resp: Response,
        ttl: int,
        response_filter: Optional[Callable],
        stale_for: Optional[int] = None,
    ) -> Optional[dict]:
        if resp.headers.pop("X-No-Cache", None):
            return None
        if (
            resp.status_code != 200
            or resp.direct_passthrough
            or resp.is_streamed
            or resp.headers.get("Set-Cookie")
        ):
            return None
        if response_filter is not None and not response_filter(resp):
            return None

        body = resp.get_data()
        mimetype = resp.mimetype or ""
        compressible = len(body) >= MIN_COMPRESS_BYTES and (
            mimetype.startswith("text/") or mimetype.endswith(("json", "xml", "javascript"))
        )
        now = time.time()
        if stale_for is not None:
            stale_window = max(0, int(stale_for))
        else:
            stale_window = 0 if ttl <= NO_STALE_TTL_AT_OR_BELOW else min(ttl * 2, MAX_STALE_SECONDS)
        entry = {
            "body": body,
            "status": resp.status_code,
            "headers": [(k, v) for k, v in resp.headers.items() if k.lower() not in _VOLATILE_HEADERS],
            "gz": gzip.compress(body, 6, mtime=0) if compressible else None,
            "br": brotli.compress(body, quality=5) if (compressible and brotli) else None,
            "created": now,
            "fresh_until": now + ttl,
            "stale_until": now + ttl + stale_window,
        }
        self._l1_put(key, entry)
        self.set(key, entry, timeout=ttl + stale_window + 5)
        return entry

    @staticmethod
    def _respond(entry: dict, state: str) -> Response:
        body = entry["body"]
        headers = list(entry["headers"])
        encoding = None
        if entry.get("gz") or entry.get("br"):
            accepted = request.headers.get("Accept-Encoding", "").lower()
            if entry.get("br") and "br" in accepted:
                body, encoding = entry["br"], "br"
            elif entry.get("gz") and "gzip" in accepted:
                body, encoding = entry["gz"], "gzip"
            headers = [(k, v) for k, v in headers if k.lower() != "vary"] + [
                ("Vary", "Accept-Encoding")
            ]
        if encoding:
            headers.append(("Content-Encoding", encoding))
        headers.append(("Content-Length", str(len(body))))
        headers.append(("X-Cache", state))
        return Response(body, status=entry["status"], headers=headers)

    @staticmethod
    def _key(path: str, query_string: bool) -> str:
        if not query_string or not request.args:
            return f"swr:{path}"
        args = request.args
        flat = "&".join(f"{k}={v}" for k in sorted(args) for v in args.getlist(k))
        return f"swr:{path}?{hashlib.md5(flat.encode('utf-8')).hexdigest()}"

    def _refresh(self, app, key, view, args, kwargs, ttl, response_filter, full_path, stale_for) -> None:
        with app.test_request_context(full_path):
            try:
                with self._single_flight(key):
                    entry = self._l1_get(key)
                    if entry is not None and time.time() < entry["fresh_until"]:
                        return
                    resp = app.make_response(view(*args, **kwargs))
                    self._store(key, resp, ttl, response_filter, stale_for)
            except Exception:
                app.logger.exception("Background cache refresh failed for %s", key)
            finally:
                with self._inflight_lock:
                    self._refreshing.discard(key)

    # ---- public decorator -------------------------------------------------
    def cached(  # type: ignore[override]
        self,
        timeout: Optional[int] = None,
        key_prefix: Any = None,
        unless: Optional[Callable[[], bool]] = None,
        forced_update: Any = None,
        response_filter: Optional[Callable] = None,
        query_string: bool = False,
        stale_for: Optional[int] = None,
        **kwargs: Any,
    ):
        """`stale_for`: seconds an expired answer may still be served while it refreshes."""
        if key_prefix is not None or forced_update is not None or kwargs:
            return super().cached(
                timeout=timeout,
                key_prefix=key_prefix if key_prefix is not None else "view/%s",
                unless=unless,
                forced_update=forced_update,
                response_filter=response_filter,
                query_string=query_string,
                **kwargs,
            )

        def decorator(view: Callable) -> Callable:
            @functools.wraps(view)
            def wrapper(*args: Any, **kw: Any):
                app = current_app._get_current_object()  # type: ignore[attr-defined]
                cache_type = str(app.config.get("CACHE_TYPE", "")).lower()
                if (
                    request.method != "GET"
                    or cache_type in ("nullcache", "null")
                    or (unless is not None and unless())
                ):
                    return view(*args, **kw)

                ttl = int(timeout if timeout is not None else app.config.get("CACHE_DEFAULT_TIMEOUT", 300))
                key = self._key(request.path, query_string)

                entry = self._lookup(key)
                if entry is not None:
                    if time.time() < entry["fresh_until"]:
                        return self._respond(entry, "HIT")
                    with self._inflight_lock:
                        start = key not in self._refreshing
                        if start:
                            self._refreshing.add(key)
                    if start:
                        self._pool.submit(
                            self._refresh,
                            app, key, view, args, kw, ttl, response_filter, request.full_path, stale_for,
                        )
                    return self._respond(entry, "STALE")

                with self._single_flight(key):
                    entry = self._lookup(key)
                    if entry is not None and time.time() < entry["fresh_until"]:
                        return self._respond(entry, "HIT")
                    resp = app.make_response(view(*args, **kw))
                    entry = self._store(key, resp, ttl, response_filter, stale_for)
                return self._respond(entry, "MISS") if entry else resp

            return wrapper

        return decorator


# Shared Cache instance
# Initialize with app in the create_app factory
cache = SWRCache()