"""Privacy-first, first-party analytics.

What is stored: per-day aggregate counters (path, referrer host, device class) and a
count of unique visitors. Nothing identifies a person: no cookies, no IP addresses, no
user agents, no user IDs, no query strings. Unique visitors are counted with a hash of
(IP, user agent) keyed by a secret and the current day; those hashes are deleted as soon
as the day ends, so visits cannot be linked across days.

Opt-out: Do Not Track / Global Privacy Control and a first-party `dlns_optout` preference
cookie are all enforced server-side; the browser script also skips sending the beacon.
See docs/ANALYTICS.md for the legitimate-interest assessment.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import secrets
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlsplit

from flask import Blueprint, current_app, make_response, render_template, request

from ..utils.auth import require_admin

analytics_bp = Blueprint("analytics", __name__)

RETENTION_DAYS = 395
MAX_PATH_LEN = 200
MAX_PATHS_PER_DAY = 2000
RATE_LIMIT = 60
RATE_WINDOW = 60.0
OPTOUT_COOKIE = "dlns_optout"
_rate: dict[str, deque] = {}
_rate_lock = threading.Lock()
_BOT_RE = re.compile(r"bot|crawl|spider|slurp|headless|preview|curl|wget|python-requests|monitor", re.I)
_TABLET_RE = re.compile(r"ipad|tablet", re.I)
_MOBILE_RE = re.compile(r"mobi|android|iphone", re.I)
_state = {"last_purge": None}

_SCHEMA = """
CREATE TABLE IF NOT EXISTS analytics_daily (
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    referrer TEXT NOT NULL,
    device TEXT NOT NULL,
    hits INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day, path, referrer, device)
);
CREATE TABLE IF NOT EXISTS analytics_visitors_daily (
    day TEXT NOT NULL,
    visitors INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (day)
);
CREATE TABLE IF NOT EXISTS analytics_seen (
    day TEXT NOT NULL,
    h TEXT NOT NULL,
    PRIMARY KEY (day, h)
);
"""


def _db_path() -> Path:
    main_db = Path(current_app.config.get("DB_PATH") or "./data/dlns.sqlite3")
    return main_db.with_name("analytics.sqlite3")


def _connect() -> sqlite3.Connection:
    path = _db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.executescript(_SCHEMA)
    return conn


def _secret() -> bytes:
    env = os.getenv("ANALYTICS_SECRET")
    if env:
        return env.encode()
    path = _db_path().with_name(".analytics_secret")
    if not path.exists():
        path.write_text(secrets.token_hex(32))
    return path.read_text().strip().encode()


def _today() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%d")


def _client_ip() -> str:
    return request.remote_addr or ""


def _device(ua: str) -> str:
    if _TABLET_RE.search(ua):
        return "tablet"
    if _MOBILE_RE.search(ua):
        return "mobile"
    return "desktop"


def _referrer_host(raw: str) -> str:
    if not raw:
        return ""
    try:
        host = (urlsplit(raw).hostname or "").lower()
    except ValueError:
        return ""
    if host.startswith("www."):
        host = host[4:]
    own = (request.host.split(":")[0]).lower()
    if own.startswith("www."):
        own = own[4:]
    return "" if host == own else host[:100]


def _opted_out() -> bool:
    return (
        request.headers.get("DNT") == "1"
        or request.headers.get("Sec-GPC") == "1"
        or request.cookies.get(OPTOUT_COOKIE) == "1"
    )


def _rate_limited() -> bool:
    """Per-IP sliding window kept in memory only; the IP is never persisted."""
    now = time.monotonic()
    key = _client_ip()
    with _rate_lock:
        if len(_rate) > 10000:
            for k in [k for k, v in _rate.items() if not v or now - v[-1] > RATE_WINDOW]:
                del _rate[k]
        hits = _rate.setdefault(key, deque())
        while hits and now - hits[0] > RATE_WINDOW:
            hits.popleft()
        if len(hits) >= RATE_LIMIT:
            return True
        hits.append(now)
        return False


def _cap_path(conn: sqlite3.Connection, today: str, path: str) -> str:
    """Stops junk URLs from growing the table: past the cap, new paths are bucketed."""
    known = conn.execute(
        "SELECT 1 FROM analytics_daily WHERE day = ? AND path = ? LIMIT 1", (today, path)
    ).fetchone()
    if known:
        return path
    distinct = conn.execute(
        "SELECT COUNT(DISTINCT path) FROM analytics_daily WHERE day = ?", (today,)
    ).fetchone()[0]
    return path if distinct < MAX_PATHS_PER_DAY else "(other)"


def _optout_response(value: bool):
    resp = make_response(("", 204))
    if value:
        resp.set_cookie(
            OPTOUT_COOKIE, "1", max_age=60 * 60 * 24 * 365, path="/",
            samesite="Lax", secure=request.is_secure,
        )
    else:
        resp.delete_cookie(OPTOUT_COOKIE, path="/")
    return resp


@analytics_bp.post("/api/a/optout")
def opt_out():
    return _optout_response(True)


@analytics_bp.post("/api/a/optin")
def opt_in():
    return _optout_response(False)


@analytics_bp.get("/api/a/status")
def status():
    return {"optedOut": _opted_out()}


def _purge(conn: sqlite3.Connection, today: str) -> None:
    if _state["last_purge"] == today:
        return
    cutoff = (datetime.now(timezone.utc) - timedelta(days=RETENTION_DAYS)).strftime("%Y-%m-%d")
    conn.execute("DELETE FROM analytics_seen WHERE day < ?", (today,))
    conn.execute("DELETE FROM analytics_daily WHERE day < ?", (cutoff,))
    conn.execute("DELETE FROM analytics_visitors_daily WHERE day < ?", (cutoff,))
    _state["last_purge"] = today


@analytics_bp.post("/api/a/hit")
def record_hit():
    """Beacon endpoint. Always answers 204 so it never affects page behaviour."""
    if _opted_out() or _rate_limited():
        return ("", 204)

    data = request.get_json(silent=True) or {}
    path = data.get("p")
    if not isinstance(path, str) or not path.startswith("/") or path.startswith("//"):
        return ("", 204)
    path = urlsplit(path).path[:MAX_PATH_LEN] or "/"
    if path.startswith(("/admin", "/api/", "/auth", "/react-admin")):
        return ("", 204)

    ua = request.headers.get("User-Agent", "")
    if not ua or _BOT_RE.search(ua):
        return ("", 204)

    ref = data.get("r")
    referrer = _referrer_host(ref) if isinstance(ref, str) else ""
    today = _today()
    visitor = hmac.new(_secret(), f"{today}|{_client_ip()}|{ua}".encode(), hashlib.sha256).hexdigest()

    try:
        conn = _connect()
        try:
            with conn:
                _purge(conn, today)
                path = _cap_path(conn, today, path)
                conn.execute(
                    "INSERT INTO analytics_daily (day, path, referrer, device, hits) VALUES (?,?,?,?,1) "
                    "ON CONFLICT(day, path, referrer, device) DO UPDATE SET hits = hits + 1",
                    (today, path, referrer, _device(ua)),
                )
                new = conn.execute(
                    "INSERT OR IGNORE INTO analytics_seen (day, h) VALUES (?, ?)", (today, visitor)
                ).rowcount
                if new:
                    conn.execute(
                        "INSERT INTO analytics_visitors_daily (day, visitors) VALUES (?, 1) "
                        "ON CONFLICT(day) DO UPDATE SET visitors = visitors + 1",
                        (today,),
                    )
        finally:
            conn.close()
    except sqlite3.Error as exc:
        current_app.logger.warning("analytics write failed: %s", exc)
    return ("", 204)


@analytics_bp.get("/privacy")
def privacy():
    return render_template("privacy.html")


@analytics_bp.get("/admin/analytics")
@require_admin
def dashboard():
    try:
        days = int(request.args.get("days", 30))
    except ValueError:
        days = 30
    if days not in (7, 30, 90, 365):
        days = 30
    since = (datetime.now(timezone.utc) - timedelta(days=days - 1)).strftime("%Y-%m-%d")

    conn = _connect()
    try:
        q = lambda sql: conn.execute(sql, (since,)).fetchall()  # noqa: E731
        total_hits = conn.execute(
            "SELECT COALESCE(SUM(hits),0) FROM analytics_daily WHERE day >= ?", (since,)
        ).fetchone()[0]
        daily_visitors = dict(q("SELECT day, visitors FROM analytics_visitors_daily WHERE day >= ?"))
        daily_hits = dict(q("SELECT day, SUM(hits) FROM analytics_daily WHERE day >= ? GROUP BY day"))
        top_pages = q("SELECT path, SUM(hits) h FROM analytics_daily WHERE day >= ? GROUP BY path ORDER BY h DESC LIMIT 25")
        referrers = q(
            "SELECT referrer, SUM(hits) h FROM analytics_daily WHERE day >= ? AND referrer != '' "
            "GROUP BY referrer ORDER BY h DESC LIMIT 15"
        )
        devices = q("SELECT device, SUM(hits) h FROM analytics_daily WHERE day >= ? GROUP BY device ORDER BY h DESC")
    finally:
        conn.close()

    rows = []
    for i in range(days):
        d = (datetime.now(timezone.utc) - timedelta(days=i)).strftime("%Y-%m-%d")
        rows.append({"day": d, "hits": daily_hits.get(d, 0), "visitors": daily_visitors.get(d, 0)})

    return render_template(
        "admin/analytics.html",
        days=days,
        total_hits=total_hits,
        rows=rows,
        top_pages=top_pages,
        referrers=referrers,
        devices=devices,
        retention=RETENTION_DAYS,
    )
