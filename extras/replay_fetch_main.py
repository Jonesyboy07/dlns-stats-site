#!/usr/bin/env python3

import atexit
import bz2
import json
import os
import queue
import re
import sqlite3
import sys
import threading
import time
import email.utils
import random
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timedelta, timezone
from functools import lru_cache
from pathlib import Path
from typing import Any, TextIO

try:
	from fake_useragent import UserAgent
except ImportError:
	UserAgent = None  # type: ignore[assignment]


BASE_DIR = Path(__file__).resolve().parent
DB_FILE = Path(os.getenv("REPLAY_DB_FILE", str(BASE_DIR / "replay_data.db")))

# Legacy files are imported once into SQLite, then removed. These are never
# used as live state after the migration flag is set in the database.
LEGACY_MATCHES_FILE = BASE_DIR / "matches.json"
LEGACY_REPLAY_LINKS_FILE = BASE_DIR / "replay_links.json"
LEGACY_MANUAL_REPLAY_URLS_FILE = BASE_DIR / "manual_replay_urls.json"
LEGACY_LOOKUP_CACHE_FILE = BASE_DIR / "replay_lookup_cache.json"
LEGACY_DOWNLOAD_STATE_FILE = BASE_DIR / "replay_download_state.json"
LEGACY_JSON_FILES = (
	LEGACY_MATCHES_FILE,
	LEGACY_REPLAY_LINKS_FILE,
	LEGACY_MANUAL_REPLAY_URLS_FILE,
	LEGACY_LOOKUP_CACHE_FILE,
	LEGACY_DOWNLOAD_STATE_FILE,
)
STATS_FILE = BASE_DIR / "stats.txt"
LOG_FILE = BASE_DIR / "log.txt"
DOWNLOADS_DIR = BASE_DIR / "downloads"
ZIPS_DIR = BASE_DIR / "zips"
MATCHES_TREE_URL = os.getenv("MATCHES_TREE_URL", "http://127.0.0.1:5050/db/matches/tree")
MATCHES_TREE_FALLBACK_URL = os.getenv("MATCHES_TREE_FALLBACK_URL", "https://dlns-stats.co.uk/db/matches/tree")
OUTPUT_ROOT = Path(os.getenv("OUTPUT_ROOT", "/srv/filebrowser/files/replay_storage"))
UNSORTED_INPUT_DIR = Path(os.getenv("UNSORTED_INPUT_DIR", "/srv/filebrowser/files/FileShare/unsorted/"))

API_BASE = os.getenv("DEADLOCK_API_BASE", "https://api.deadlock-api.com").rstrip("/")
API_KEY = os.getenv("DEADLOCK_API_KEY")


def env_int(name: str, default: int, minimum: int = 1, maximum: int = 128) -> int:
	value = os.getenv(name)
	if value is None:
		return default
	try:
		parsed = int(value)
	except ValueError:
		return default
	return max(minimum, min(parsed, maximum))


FETCH_WORKERS = env_int("FETCH_WORKERS", 16)
DOWNLOAD_WORKERS = env_int("DOWNLOAD_WORKERS", 16)
VERIFY_WORKERS = env_int("VERIFY_WORKERS", 16)
# Deflate level 1 is several times faster than the default 6 for little size cost.
ZIP_COMPRESS_LEVEL = env_int("ZIP_COMPRESS_LEVEL", 1, minimum=0, maximum=9)
IO_CHUNK_BYTES = 4 * 1024 * 1024
# Set REPLAY_VERBOSE=1 to log every low-level step (HTTP, zip, cleanup, ...).
VERBOSE_LOG = os.getenv("REPLAY_VERBOSE", "0").lower() in {"1", "true", "yes"}
SORT_WORKERS = env_int("SORT_WORKERS", 8)
KEEP_INTERMEDIATE_FILES = os.getenv("KEEP_INTERMEDIATE_FILES", "0").lower() in {"1", "true", "yes"}
FORCE_REFRESH_LOOKUPS = os.getenv("FORCE_REFRESH_LOOKUPS", "0").lower() in {"1", "true", "yes"}
FORCE_REPROCESS_DOWNLOADS = os.getenv("FORCE_REPROCESS_DOWNLOADS", "0").lower() in {"1", "true", "yes"}
VERIFY_PROGRESS_EVERY = 100
PROGRESS_LOG_EVERY = env_int("PROGRESS_LOG_EVERY", 25, minimum=1, maximum=100000)
HTTP_RETRY_ATTEMPTS = env_int("HTTP_RETRY_ATTEMPTS", 5, minimum=1, maximum=20)
DOWNLOAD_RETRY_ATTEMPTS = env_int("DOWNLOAD_RETRY_ATTEMPTS", 5, minimum=1, maximum=20)
RETRY_BASE_SECONDS = env_int("RETRY_BASE_SECONDS", 2, minimum=1, maximum=60)
RETRY_MAX_SECONDS = env_int("RETRY_MAX_SECONDS", 30, minimum=1, maximum=300)
RATE_LIMIT_FALLBACK_SECONDS = env_int("RATE_LIMIT_FALLBACK_SECONDS", 60, minimum=1, maximum=3600)
RATE_LIMIT_EXTRA_WAIT_SECONDS = env_int("RATE_LIMIT_EXTRA_WAIT_SECONDS", 5, minimum=1, maximum=600)
# The API may advertise a ~1 hour Retry-After on a shared bucket while other requests
# still succeed, so never sleep longer than this per 429; retry instead.
RATE_LIMIT_MAX_WAIT_SECONDS = env_int("RATE_LIMIT_MAX_WAIT_SECONDS", 30, minimum=1, maximum=3600)
RATE_LIMIT_MAX_RETRIES = env_int("RATE_LIMIT_MAX_RETRIES", 12, minimum=1, maximum=100)
LOOKUP_RETRY_PASSES = env_int("LOOKUP_RETRY_PASSES", 2, minimum=0, maximum=10)
LOOKUP_RETRY_DELAY_SECONDS = env_int("LOOKUP_RETRY_DELAY_SECONDS", 20, minimum=0, maximum=600)
# Expired (404/403/410) replay URLs are not re-attempted until this many hours pass.
EXPIRED_RECHECK_HOURS = env_int("EXPIRED_RECHECK_HOURS", 24, minimum=0, maximum=24 * 365)

# A browser-like User-Agent is selected per request. fake-useragent is optional at
# runtime so a missing/broken UA provider never prevents Option 4 from working.
_FALLBACK_USER_AGENTS = (
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:142.0) Gecko/20100101 Firefox/142.0",
	"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Safari/605.1.15",
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
)


def _build_user_agent_provider() -> Any:
	if UserAgent is None:
		return None
	try:
		return UserAgent(browsers=["Chrome", "Firefox", "Edge", "Safari"])
	except Exception:
		try:
			return UserAgent()
		except Exception:
			return None


_USER_AGENT_PROVIDER = _build_user_agent_provider()


def random_user_agent() -> str:
	if _USER_AGENT_PROVIDER is not None:
		try:
			value = str(_USER_AGENT_PROVIDER.random).strip()
			if value:
				return value
		except Exception:
			pass
	return random.choice(_FALLBACK_USER_AGENTS)

PERMANENT_UNAVAILABLE_HTTP_CODES = {400, 403, 404, 410, 422}
EXPIRED_DEMO_HTTP_CODES = {403, 404, 410}
TRANSIENT_HTTP_CODES = {408, 425, 429, 500, 502, 503, 504, 520, 521, 522, 524}

_SLUG_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")
_INVALID_SEGMENT_CHARS_RE = re.compile(r"[\\/:*?\"<>|]")
_WHITESPACE_RE = re.compile(r"\s+")
_MATCH_ID_PREFIX_RE = re.compile(r"^(\d+)")
_ZIP_MATCH_ID_RE = re.compile(r"^(\d+)(?:_.*)?\.zip$", re.IGNORECASE)

_LOG_LOCK = threading.Lock()
_LOG_HANDLE: TextIO | None = None


_NOISY_SCOPES = {"http", "fetch", "download", "zip", "extract", "materialize", "cleanup", "normalize", "process"}
_IMPORTANT_MARKERS = ("fail", "error", "warning", "retry", "rate limit", "corrupt", "refusing", "skip rewrite")


def log(scope: str, message: str) -> None:
	if scope in _NOISY_SCOPES and not VERBOSE_LOG:
		lower = message.lower()
		if not any(marker in lower for marker in _IMPORTANT_MARKERS):
			return
	line = f"[{now_iso()}] [{scope}] {message}"
	print(line, flush=True)
	try:
		global _LOG_HANDLE
		with _LOG_LOCK:
			if _LOG_HANDLE is None or _LOG_HANDLE.closed:
				_LOG_HANDLE = LOG_FILE.open("a", encoding="utf-8", buffering=1)
			_LOG_HANDLE.write(line)
			_LOG_HANDLE.write("\n")
	except Exception:
		pass


def reset_log_file() -> None:
	global _LOG_HANDLE
	with _LOG_LOCK:
		if _LOG_HANDLE is not None and not _LOG_HANDLE.closed:
			_LOG_HANDLE.close()
		_LOG_HANDLE = None
	with LOG_FILE.open("w", encoding="utf-8"):
		pass


def write_text_file(path: Path, text: str) -> None:
	"""Atomically replace a UTF-8 text file."""
	path.parent.mkdir(parents=True, exist_ok=True)
	temp_path = path.with_name(f".{path.name}.{os.getpid()}.{threading.get_ident()}.tmp")
	try:
		with temp_path.open("w", encoding="utf-8", newline="\n") as handle:
			handle.write(text)
			if text and not text.endswith("\n"):
				handle.write("\n")
			handle.flush()
			os.fsync(handle.fileno())
		temp_path.replace(path)
	finally:
		try:
			if temp_path.exists():
				temp_path.unlink()
		except OSError:
			pass


class RateLimitGate:
	"""Coordinate Deadlock API 429 handling across all fetch workers.

	The worker that first observes a rate limit becomes the single probe worker.
	It may retry when the advertised/fallback cooldown expires. Every other worker
	waits an additional grace period. A successful probe opens the gate early.
	"""

	def __init__(self) -> None:
		self._condition = threading.Condition()
		self._blocked_until = 0.0
		self._probe_ident: int | None = None

	def wait(self) -> None:
		ident = threading.get_ident()
		with self._condition:
			while self._blocked_until > 0:
				now = time.monotonic()
				is_probe = ident == self._probe_ident
				release_at = self._blocked_until if is_probe else self._blocked_until + RATE_LIMIT_EXTRA_WAIT_SECONDS
				remaining = release_at - now
				if remaining <= 0:
					# Only the probe may pass while the shared cooldown is active.
					if is_probe:
						return
					# Non-probes can resume after their extra grace period even if
					# the probe has not completed yet. Clear stale cooldown then.
					self._blocked_until = 0.0
					self._probe_ident = None
					self._condition.notify_all()
					return
				self._condition.wait(timeout=remaining)

	def limited(self, retry_after_seconds: float) -> None:
		ident = threading.get_ident()
		retry_after_seconds = max(1.0, retry_after_seconds)
		with self._condition:
			was_blocked = self._blocked_until > time.monotonic()
			new_until = time.monotonic() + retry_after_seconds
			if self._blocked_until <= time.monotonic():
				self._probe_ident = ident
			elif self._probe_ident is None:
				self._probe_ident = ident
			self._blocked_until = max(self._blocked_until, new_until)
			probe = self._probe_ident
			self._condition.notify_all()
		if not was_blocked:
			log("rate", f"API rate limited; pausing lookups ~{retry_after_seconds:.0f}s (workers add {RATE_LIMIT_EXTRA_WAIT_SECONDS}s)")

	def success(self) -> None:
		ident = threading.get_ident()
		with self._condition:
			if self._blocked_until <= 0:
				return
			# A successful API request proves the limit is no longer active.
			self._blocked_until = 0.0
			self._probe_ident = None
			self._condition.notify_all()
		log("rate", "API rate limit cleared")


_API_RATE_LIMIT_GATE = RateLimitGate()


def should_log_progress(completed: int, total: int, had_error: bool = False) -> bool:
	if had_error:
		return True
	if completed == total:
		return True
	return completed % PROGRESS_LOG_EVERY == 0


def log_progress_status(
	scope: str,
	completed: int,
	total: int,
	item_label: str,
	status: str,
	error: str | None = None,
	had_error: bool = False,
) -> None:
	start = _PROGRESS_START.setdefault(scope, time.monotonic())
	elapsed = max(0.001, time.monotonic() - start)
	rate = completed / elapsed
	eta = int((total - completed) / rate) if rate > 0 else 0
	timing = f"{rate:.1f}/s, elapsed {int(elapsed)}s, eta {eta}s"
	if error:
		log(scope, f"[{completed}/{total}] {item_label}: {status} ({error}) [{timing}]")
	elif should_log_progress(completed, total, had_error=had_error):
		log(scope, f"[{completed}/{total}] {item_label}: {status} [{timing}]")


_PROGRESS_START: dict[str, float] = {}


def now_iso() -> str:
	return datetime.now(timezone.utc).isoformat()


def _open_db_connection() -> sqlite3.Connection:
	"""Open the SQLite connection owned exclusively by the DB worker thread."""
	DB_FILE.parent.mkdir(parents=True, exist_ok=True)
	conn = sqlite3.connect(DB_FILE, timeout=30)
	conn.row_factory = sqlite3.Row
	conn.execute("PRAGMA foreign_keys = ON")
	conn.execute("PRAGMA journal_mode = WAL")
	conn.execute("PRAGMA synchronous = NORMAL")
	conn.execute("PRAGMA busy_timeout = 30000")
	return conn


class DatabaseWorker:
	"""Serialize every SQLite interaction through one dedicated thread.

	Other threads submit small callables that receive the worker-owned connection.
	Reads and writes therefore share one ordered queue and never fight over SQLite
	connections/transactions. Synchronous callers wait only for their own result.
	"""

	def __init__(self) -> None:
		self._queue: queue.Queue[tuple[Any, threading.Event, dict[str, Any]] | None] = queue.Queue()
		self._thread = threading.Thread(target=self._run, name="sqlite-worker", daemon=True)
		self._started = False
		self._start_lock = threading.Lock()
		self._worker_ident: int | None = None
		self._conn: sqlite3.Connection | None = None

	def start(self) -> None:
		with self._start_lock:
			if self._started:
				return
			self._started = True
			self._thread.start()

	def _run(self) -> None:
		self._worker_ident = threading.get_ident()
		conn = _open_db_connection()
		self._conn = conn
		try:
			while True:
				job = self._queue.get()
				try:
					if job is None:
						return
					fn, done, box = job
					try:
						box["result"] = fn(conn)
					except BaseException as exc:
						try:
							conn.rollback()
						except Exception:
							pass
						box["error"] = exc
					finally:
						done.set()
				finally:
					self._queue.task_done()
		finally:
			self._conn = None
			conn.close()

	def call(self, fn: Any) -> Any:
		self.start()
		# Internal DB helpers may call another DB helper while already executing on
		# the DB thread. Execute directly to avoid deadlocking on our own queue.
		if threading.get_ident() == self._worker_ident:
			assert self._conn is not None
			return fn(self._conn)

		done = threading.Event()
		box: dict[str, Any] = {}
		self._queue.put((fn, done, box))
		done.wait()
		if "error" in box:
			raise box["error"]
		return box.get("result")

	def stop(self) -> None:
		with self._start_lock:
			if not self._started or not self._thread.is_alive():
				return
			self._queue.put(None)
		self._thread.join(timeout=10)


_DB = DatabaseWorker()
atexit.register(_DB.stop)


def db_call(fn: Any) -> Any:
	"""Run one database operation on the dedicated SQLite worker thread."""
	return _DB.call(fn)


def initialize_database() -> None:
	"""Create/upgrade the SQLite store and migrate legacy state once.

	Schema v3 intentionally keeps discovery and processing separate:
	- replays: one canonical row per match for replay discovery
	- downloads: one canonical row per match for download/processing state
	All access still goes through the dedicated DB worker thread.
	"""
	def create_schema(conn: sqlite3.Connection) -> None:
		# Core tables are created first so upgrades can copy old data safely.
		conn.executescript(
			"""
			CREATE TABLE IF NOT EXISTS meta (
				key TEXT PRIMARY KEY,
				value TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS matches (
				match_id INTEGER PRIMARY KEY,
				series_title TEXT NOT NULL DEFAULT 'Unknown Series',
				series_slug TEXT NOT NULL DEFAULT 'unknown-series',
				week_num INTEGER NOT NULL DEFAULT 0,
				week_label TEXT NOT NULL DEFAULT 'week-unknown',
				region TEXT NOT NULL DEFAULT 'Unknown Region',
				team_a TEXT NOT NULL DEFAULT '',
				team_b TEXT NOT NULL DEFAULT '',
				has_teams INTEGER NOT NULL DEFAULT 0 CHECK (has_teams IN (0, 1)),
				stage TEXT NOT NULL DEFAULT 'regular',
				game_title TEXT NOT NULL DEFAULT '',
				game_name TEXT NOT NULL DEFAULT '',
				updated_at TEXT NOT NULL
			);

			CREATE TABLE IF NOT EXISTS replays (
				match_id INTEGER PRIMARY KEY,
				demo_url TEXT,
				source TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				lookup_attempts INTEGER NOT NULL DEFAULT 0 CHECK (lookup_attempts >= 0),
				last_lookup_at TEXT,
				last_success_at TEXT,
				error TEXT,
				FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS downloads (
				match_id INTEGER PRIMARY KEY,
				demo_url TEXT,
				status TEXT NOT NULL DEFAULT 'pending',
				attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
				first_attempt_at TEXT,
				last_attempt_at TEXT,
				completed_at TEXT,
				output_zip_path TEXT,
				error TEXT,
				FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
			);

			CREATE TABLE IF NOT EXISTS manual_replay_urls (
				match_id INTEGER PRIMARY KEY,
				demo_url TEXT NOT NULL,
				updated_at TEXT NOT NULL
			);
			"""
		)

		# Upgrade schema v2 in-place. Old tables are merged into the canonical v3
		# tables before being removed, so existing installations keep their state.
		table_names = {
			str(row["name"])
			for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
		}

		if "replay_links" in table_names:
			conn.execute(
				"""INSERT INTO replays(match_id, demo_url, source, status, lookup_attempts,
				last_lookup_at, last_success_at, error)
				SELECT match_id, demo_url, demo_url_source, COALESCE(status, 'pending'),
				CASE WHEN fetched_at IS NULL THEN 0 ELSE 1 END,
				fetched_at, CASE WHEN demo_url IS NOT NULL THEN fetched_at ELSE NULL END, error
				FROM replay_links
				WHERE 1
				ON CONFLICT(match_id) DO UPDATE SET
					demo_url=excluded.demo_url,
					source=excluded.source,
					status=excluded.status,
					lookup_attempts=MAX(replays.lookup_attempts, excluded.lookup_attempts),
					last_lookup_at=COALESCE(excluded.last_lookup_at, replays.last_lookup_at),
					last_success_at=COALESCE(excluded.last_success_at, replays.last_success_at),
					error=excluded.error"""
			)

		if "lookup_cache" in table_names:
			# lookup_cache may contain a newer success than replay_links. Prefer a
			# URL-bearing row, otherwise retain the canonical replay row above.
			rows = conn.execute("SELECT * FROM lookup_cache").fetchall()
			for row in rows:
				mid = int(row["match_id"])
				existing = conn.execute("SELECT * FROM replays WHERE match_id=?", (mid,)).fetchone()
				url = row["demo_url"]
				if existing is None or url:
					conn.execute(
						"""INSERT INTO replays(match_id, demo_url, source, status, lookup_attempts,
						last_lookup_at, last_success_at, error)
						VALUES (?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(match_id) DO UPDATE SET
							demo_url=excluded.demo_url, source=excluded.source, status=excluded.status,
							lookup_attempts=MAX(replays.lookup_attempts, excluded.lookup_attempts),
							last_lookup_at=COALESCE(excluded.last_lookup_at, replays.last_lookup_at),
							last_success_at=COALESCE(excluded.last_success_at, replays.last_success_at),
							error=excluded.error""",
						(mid, url, row["demo_url_source"], row["status"] or "pending",
						 1 if row["fetched_at"] else 0, row["fetched_at"],
						 row["fetched_at"] if url else None, row["error"]),
					)

		if "download_state" in table_names:
			conn.execute(
				"""INSERT INTO downloads(match_id, demo_url, status, attempts, first_attempt_at,
				last_attempt_at, completed_at, output_zip_path, error)
				SELECT match_id, demo_url, status, CASE WHEN last_attempt_at IS NULL THEN 0 ELSE 1 END,
				last_attempt_at, last_attempt_at,
				CASE WHEN status IN ('ok','already_local','already_local_member_normalized') THEN last_attempt_at ELSE NULL END,
				output_zip_path, error
				FROM download_state
				WHERE 1
				ON CONFLICT(match_id) DO UPDATE SET
					demo_url=excluded.demo_url, status=excluded.status,
					attempts=MAX(downloads.attempts, excluded.attempts),
					first_attempt_at=COALESCE(downloads.first_attempt_at, excluded.first_attempt_at),
					last_attempt_at=COALESCE(excluded.last_attempt_at, downloads.last_attempt_at),
					completed_at=COALESCE(excluded.completed_at, downloads.completed_at),
					output_zip_path=excluded.output_zip_path, error=excluded.error"""
			)

		conn.executescript(
			"""
			DROP TABLE IF EXISTS replay_links;
			DROP TABLE IF EXISTS lookup_cache;
			DROP TABLE IF EXISTS download_state;

			CREATE INDEX IF NOT EXISTS idx_replays_status ON replays(status);
			CREATE INDEX IF NOT EXISTS idx_replays_missing_url ON replays(match_id) WHERE demo_url IS NULL;
			CREATE INDEX IF NOT EXISTS idx_replays_last_lookup ON replays(last_lookup_at);
			CREATE INDEX IF NOT EXISTS idx_downloads_status ON downloads(status);
			CREATE INDEX IF NOT EXISTS idx_downloads_last_attempt ON downloads(last_attempt_at);
			CREATE INDEX IF NOT EXISTS idx_matches_series_week ON matches(series_slug, week_num);
			"""
		)
		_set_meta(conn, "schema_version", "3")
		conn.commit()

	db_call(create_schema)
	cleanup_done = get_meta("legacy_json_cleanup_complete") == "1"
	if not cleanup_done:
		migrate_legacy_json_once()

	log("db", f"SQLite queue worker ready: {DB_FILE} (schema v3)")


def _set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
	conn.execute(
		"""INSERT INTO meta(key, value, updated_at) VALUES (?, ?, ?)
		   ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at""",
		(key, value, now_iso()),
	)


def set_meta(key: str, value: str) -> None:
	def op(conn: sqlite3.Connection) -> None:
		_set_meta(conn, key, value)
		conn.commit()
	db_call(op)


def get_meta(key: str, default: str | None = None) -> str | None:
	def op(conn: sqlite3.Connection) -> str | None:
		row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
		return str(row["value"]) if row else default
	return db_call(op)


def _read_legacy_json(path: Path) -> Any:
	with path.open("r", encoding="utf-8") as f:
		return json.load(f)


def _upsert_matches_conn(conn: sqlite3.Connection, entries: list[dict[str, Any]]) -> None:
	if not entries:
		return
	ts = now_iso()
	conn.executemany(
		"""INSERT INTO matches(
			match_id, series_title, series_slug, week_num, week_label, region,
			team_a, team_b, has_teams, stage, game_title, game_name, updated_at
		) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(match_id) DO UPDATE SET
			series_title=excluded.series_title,
			series_slug=excluded.series_slug,
			week_num=excluded.week_num,
			week_label=excluded.week_label,
			region=excluded.region,
			team_a=excluded.team_a,
			team_b=excluded.team_b,
			has_teams=excluded.has_teams,
			stage=excluded.stage,
			game_title=excluded.game_title,
			game_name=excluded.game_name,
			updated_at=excluded.updated_at""",
		[
			(
				int(row["match_id"]), str(row.get("series_title") or "Unknown Series"),
				str(row.get("series_slug") or "unknown-series"), int(row.get("week_num") or 0),
				str(row.get("week_label") or "week-unknown"), str(row.get("region") or "Unknown Region"),
				str(row.get("team_a") or ""), str(row.get("team_b") or ""),
				1 if row.get("has_teams") or (row.get("team_a") and row.get("team_b")) else 0,
				str(row.get("stage") or "regular"), str(row.get("game_title") or ""),
				str(row.get("game_name") or ""), ts,
			)
			for row in entries if isinstance(row, dict) and isinstance(row.get("match_id"), int)
		],
	)


def upsert_matches(entries: list[dict[str, Any]], conn: sqlite3.Connection | None = None) -> None:
	if not entries:
		return
	if conn is not None:
		_upsert_matches_conn(conn, entries)
		return
	def op(db: sqlite3.Connection) -> None:
		_upsert_matches_conn(db, entries)
		db.commit()
	db_call(op)


def load_matches_from_db() -> list[dict[str, Any]]:
	def op(conn: sqlite3.Connection) -> list[dict[str, Any]]:
		rows = conn.execute("SELECT * FROM matches ORDER BY match_id").fetchall()
		return [
			{
				"match_id": int(row["match_id"]),
				"series_title": row["series_title"], "series_slug": row["series_slug"],
				"week_num": int(row["week_num"]), "week_label": row["week_label"],
				"region": row["region"], "team_a": row["team_a"], "team_b": row["team_b"],
				"has_teams": bool(row["has_teams"]), "stage": row["stage"],
				"game_title": row["game_title"], "game_name": row["game_name"],
			}
			for row in rows
		]
	return db_call(op)


def load_replay_states() -> dict[int, dict[str, Any]]:
	def op(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
		rows = conn.execute("SELECT * FROM replays").fetchall()
		return {
			int(row["match_id"]): {
				"match_id": int(row["match_id"]),
				"demo_url": row["demo_url"],
				"demo_url_source": row["source"],
				"fetched_at": row["last_lookup_at"],
				"status": row["status"],
				"error": row["error"],
				"lookup_attempts": int(row["lookup_attempts"]),
				"last_success_at": row["last_success_at"],
			}
			for row in rows
		}
	return db_call(op)


def save_replay_links(rows: list[dict[str, Any]], source_matches: str) -> None:
	"""Persist replay discovery results into the one canonical replays table.

	A changed last_lookup_at represents a real lookup and increments lookup_attempts.
	Cached successful rows keep the same timestamp, so merely rebuilding the output
	payload does not inflate attempt counters.
	"""
	def op(conn: sqlite3.Connection) -> None:
		_upsert_matches_conn(conn, rows)
		for r in rows:
			match_id = int(r["match_id"])
			lookup_at = r.get("fetched_at")
			demo_url = r.get("demo_url")
			existing = conn.execute(
				"SELECT last_lookup_at, lookup_attempts, last_success_at FROM replays WHERE match_id=?",
				(match_id,),
			).fetchone()
			attempts = int(existing["lookup_attempts"]) if existing else 0
			if lookup_at and (existing is None or existing["last_lookup_at"] != lookup_at):
				attempts += 1
			last_success_at = existing["last_success_at"] if existing else None
			if demo_url:
				last_success_at = lookup_at or now_iso()
			conn.execute(
				"""INSERT INTO replays(match_id, demo_url, source, status, lookup_attempts,
				last_lookup_at, last_success_at, error)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(match_id) DO UPDATE SET
					demo_url=excluded.demo_url, source=excluded.source, status=excluded.status,
					lookup_attempts=excluded.lookup_attempts, last_lookup_at=excluded.last_lookup_at,
					last_success_at=excluded.last_success_at, error=excluded.error""",
				(match_id, demo_url, r.get("demo_url_source"), str(r.get("status") or "missing_demo_url"),
				 attempts, lookup_at, last_success_at, r.get("error")),
			)
		_set_meta(conn, "replays_generated_at", now_iso())
		_set_meta(conn, "replays_source", source_matches)
		_set_meta(conn, "replays_api_base", API_BASE)
		conn.commit()
	db_call(op)


def load_replay_links_payload() -> dict[str, Any]:
	def op(conn: sqlite3.Connection) -> dict[str, Any]:
		rows = conn.execute(
			"""SELECT m.*, r.demo_url, r.source AS demo_url_source,
			          r.last_lookup_at AS fetched_at, r.status, r.error,
			          r.lookup_attempts, r.last_success_at
			   FROM matches m JOIN replays r ON r.match_id = m.match_id
			   ORDER BY m.match_id"""
		).fetchall()
		items = [{
			"match_id": int(row["match_id"]), "series_title": row["series_title"],
			"series_slug": row["series_slug"], "week_num": int(row["week_num"]),
			"week_label": row["week_label"], "region": row["region"],
			"team_a": row["team_a"], "team_b": row["team_b"], "has_teams": bool(row["has_teams"]),
			"stage": row["stage"], "game_title": row["game_title"], "game_name": row["game_name"],
			"demo_url": row["demo_url"], "demo_url_source": row["demo_url_source"],
			"fetched_at": row["fetched_at"], "status": row["status"], "error": row["error"],
			"lookup_attempts": int(row["lookup_attempts"]), "last_success_at": row["last_success_at"],
		} for row in rows]
		source = conn.execute("SELECT value FROM meta WHERE key='replays_source'").fetchone()
		generated = conn.execute("SELECT value FROM meta WHERE key='replays_generated_at'").fetchone()
		return {
			"generated_at": generated["value"] if generated else now_iso(),
			"source_matches": source["value"] if source else DB_FILE.name,
			"api_base": API_BASE,
			"total": len(items),
			"with_demo_url": sum(1 for r in items if r.get("demo_url")),
			"missing_demo_url": sum(1 for r in items if not r.get("demo_url")),
			"errors": sum(1 for r in items if r.get("status") not in {"ok", "missing_demo_url", "unavailable"}),
			"items": items,
		}
	return db_call(op)


def load_download_states() -> dict[int, dict[str, Any]]:
	def op(conn: sqlite3.Connection) -> dict[int, dict[str, Any]]:
		rows = conn.execute("SELECT * FROM downloads").fetchall()
		return {int(row["match_id"]): dict(row) for row in rows}
	return db_call(op)


def save_download_states(entries: dict[int, dict[str, Any]]) -> None:
	def op(conn: sqlite3.Connection) -> None:
		for mid, row in entries.items():
			existing = conn.execute("SELECT attempts, first_attempt_at FROM downloads WHERE match_id=?", (mid,)).fetchone()
			last_attempt = str(row.get("last_attempt_at") or now_iso())
			incoming_attempts = row.get("attempts")
			if incoming_attempts is None:
				attempts = int(existing["attempts"]) if existing else 0
				# A caller-provided last_attempt_at indicates this run actually tried it.
				attempts += 1
			else:
				attempts = int(incoming_attempts)
			first_attempt = (existing["first_attempt_at"] if existing else None) or last_attempt
			status = str(row.get("status") or "unknown")
			completed_at = row.get("completed_at")
			if status in {"ok", "already_local", "already_local_member_normalized"} and not completed_at:
				completed_at = last_attempt
			conn.execute(
				"""INSERT INTO downloads(match_id, demo_url, status, attempts, first_attempt_at,
				last_attempt_at, completed_at, output_zip_path, error)
				VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
				ON CONFLICT(match_id) DO UPDATE SET
					demo_url=excluded.demo_url, status=excluded.status, attempts=excluded.attempts,
					first_attempt_at=excluded.first_attempt_at, last_attempt_at=excluded.last_attempt_at,
					completed_at=excluded.completed_at, output_zip_path=excluded.output_zip_path,
					error=excluded.error""",
				(mid, row.get("demo_url"), status, attempts, first_attempt, last_attempt,
				 completed_at, row.get("output_zip_path"), row.get("error")),
			)
		conn.commit()
	db_call(op)


@lru_cache(maxsize=1)
def load_manual_replay_url_map() -> dict[int, str]:
	def op(conn: sqlite3.Connection) -> dict[int, str]:
		rows = conn.execute("SELECT match_id, demo_url FROM manual_replay_urls ORDER BY match_id").fetchall()
		return {int(row["match_id"]): str(row["demo_url"]) for row in rows if row["demo_url"]}
	lookup = db_call(op)
	log("manual", f"Loaded {len(lookup)} manual replay URL overrides from SQLite")
	return lookup


def get_manual_demo_url(match_id: int) -> str | None:
	return load_manual_replay_url_map().get(match_id)


def migrate_legacy_json_once() -> None:
	"""Import old JSON state, remove it, and mark cleanup complete in SQLite."""
	present = [path for path in LEGACY_JSON_FILES if path.exists()]
	if not present:
		set_meta("legacy_json_cleanup_complete", "1")
		set_meta("legacy_json_cleanup_at", now_iso())
		return

	log("db", f"First-run legacy migration: {len(present)} JSON file(s) found")
	legacy: dict[Path, Any] = {}
	for path in present:
		try:
			legacy[path] = _read_legacy_json(path)
		except Exception as e:
			log("db", f"Could not read {path.name}: {e}")

	def import_op(conn: sqlite3.Connection) -> None:
		if LEGACY_MATCHES_FILE in legacy:
			try:
				_upsert_matches_conn(conn, collect_match_entries(legacy[LEGACY_MATCHES_FILE]))
			except Exception as e:
				log("db", f"Could not import {LEGACY_MATCHES_FILE.name}: {e}")

		if LEGACY_REPLAY_LINKS_FILE in legacy:
			try:
				payload = legacy[LEGACY_REPLAY_LINKS_FILE]
				rows = [r for r in payload.get("items", []) if isinstance(r, dict)] if isinstance(payload, dict) else []
				_upsert_matches_conn(conn, rows)
				for r in rows:
					if not isinstance(r.get("match_id"), int):
						continue
					lookup_at = r.get("fetched_at")
					url = r.get("demo_url")
					conn.execute(
						"""INSERT INTO replays(match_id, demo_url, source, status, lookup_attempts,
						last_lookup_at, last_success_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(match_id) DO UPDATE SET demo_url=excluded.demo_url,
						source=excluded.source, status=excluded.status,
						lookup_attempts=MAX(replays.lookup_attempts, excluded.lookup_attempts),
						last_lookup_at=COALESCE(excluded.last_lookup_at, replays.last_lookup_at),
						last_success_at=COALESCE(excluded.last_success_at, replays.last_success_at),
						error=excluded.error""",
						(int(r["match_id"]), url, r.get("demo_url_source"), str(r.get("status") or "missing_demo_url"),
						 1 if lookup_at else 0, lookup_at, lookup_at if url else None, r.get("error")),
					)
				_set_meta(conn, "replays_source", str(payload.get("source_matches") or LEGACY_MATCHES_FILE.name))
			except Exception as e:
				log("db", f"Could not import {LEGACY_REPLAY_LINKS_FILE.name}: {e}")

		if LEGACY_MANUAL_REPLAY_URLS_FILE in legacy:
			try:
				payload = legacy[LEGACY_MANUAL_REPLAY_URLS_FILE]
				raw = payload.get("urls_by_match_id", {}) if isinstance(payload, dict) else {}
				ts = now_iso()
				conn.executemany(
					"""INSERT INTO manual_replay_urls(match_id, demo_url, updated_at) VALUES (?, ?, ?)
					ON CONFLICT(match_id) DO UPDATE SET demo_url=excluded.demo_url, updated_at=excluded.updated_at""",
					[(int(mid), str(url).strip(), ts) for mid, url in raw.items() if str(url).strip()],
				)
			except Exception as e:
				log("db", f"Could not import {LEGACY_MANUAL_REPLAY_URLS_FILE.name}: {e}")

		if LEGACY_LOOKUP_CACHE_FILE in legacy:
			try:
				payload = legacy[LEGACY_LOOKUP_CACHE_FILE]
				raw_entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
				for mid, row in raw_entries.items():
					if not isinstance(row, dict):
						continue
					lookup_at = row.get("fetched_at")
					url = row.get("demo_url")
					conn.execute(
						"""INSERT INTO replays(match_id, demo_url, source, status, lookup_attempts,
						last_lookup_at, last_success_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
						ON CONFLICT(match_id) DO UPDATE SET
							demo_url=COALESCE(excluded.demo_url, replays.demo_url),
							source=COALESCE(excluded.source, replays.source),
							status=CASE WHEN excluded.demo_url IS NOT NULL THEN excluded.status ELSE replays.status END,
							lookup_attempts=MAX(replays.lookup_attempts, excluded.lookup_attempts),
							last_lookup_at=COALESCE(excluded.last_lookup_at, replays.last_lookup_at),
							last_success_at=COALESCE(excluded.last_success_at, replays.last_success_at),
							error=CASE WHEN excluded.demo_url IS NOT NULL THEN excluded.error ELSE replays.error END""",
						(int(mid), url, row.get("demo_url_source"), str(row.get("status") or "pending"),
						 1 if lookup_at else 0, lookup_at, lookup_at if url else None, row.get("error")),
					)
			except Exception as e:
				log("db", f"Could not import {LEGACY_LOOKUP_CACHE_FILE.name}: {e}")

		if LEGACY_DOWNLOAD_STATE_FILE in legacy:
			try:
				payload = legacy[LEGACY_DOWNLOAD_STATE_FILE]
				raw_entries = payload.get("entries", {}) if isinstance(payload, dict) else {}
				for mid, row in raw_entries.items():
					if not isinstance(row, dict):
						continue
					last = str(row.get("last_attempt_at") or now_iso())
					status = str(row.get("status") or "unknown")
					conn.execute(
						"""INSERT INTO downloads(match_id, demo_url, status, attempts, first_attempt_at,
						last_attempt_at, completed_at, output_zip_path, error)
						VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)
						ON CONFLICT(match_id) DO UPDATE SET demo_url=excluded.demo_url,
						status=excluded.status, attempts=MAX(downloads.attempts, excluded.attempts),
						first_attempt_at=COALESCE(downloads.first_attempt_at, excluded.first_attempt_at),
						last_attempt_at=excluded.last_attempt_at,
						completed_at=COALESCE(excluded.completed_at, downloads.completed_at),
						output_zip_path=excluded.output_zip_path, error=excluded.error""",
						(int(mid), row.get("demo_url"), status, last, last,
						 last if status in {"ok", "already_local", "already_local_member_normalized"} else None,
						 row.get("output_zip_path"), row.get("error")),
					)
			except Exception as e:
				log("db", f"Could not import {LEGACY_DOWNLOAD_STATE_FILE.name}: {e}")
		conn.commit()

	db_call(import_op)

	removed = 0
	for path in present:
		try:
			path.unlink()
			removed += 1
			log("db", f"Removed legacy JSON: {path.name}")
		except OSError as e:
			log("db", f"Could not remove legacy JSON {path.name}: {e}")

	def finish_op(conn: sqlite3.Connection) -> None:
		_set_meta(conn, "legacy_json_cleanup_complete", "1")
		_set_meta(conn, "legacy_json_cleanup_at", now_iso())
		_set_meta(conn, "legacy_json_files_removed", str(removed))
		conn.commit()
	db_call(finish_op)
	load_manual_replay_url_map.cache_clear()
	log("db", f"Legacy JSON migration complete; removed {removed}/{len(present)} file(s)")

def is_unavailable_error_text(text: str) -> bool:
	lower = text.lower()
	markers = [
		"not found",
		"unavailable",
		"no replay",
		"does not exist",
		"invalid match",
	]
	return any(marker in lower for marker in markers)


def classify_lookup_http_status(code: int, error_text: str) -> str:
	if code == 429:
		return "rate_limited"
	if code in PERMANENT_UNAVAILABLE_HTTP_CODES:
		return "unavailable"
	if is_unavailable_error_text(error_text):
		return "unavailable"
	if code in TRANSIENT_HTTP_CODES:
		return "http_error"
	return "http_error"


def format_http_error(e: urllib.error.HTTPError) -> str:
	detail = f"HTTP {e.code}: {e.reason}"
	try:
		body_bytes = e.read()
		if body_bytes:
			body_text = body_bytes.decode("utf-8", errors="ignore").strip()
			if body_text:
				detail = f"{detail} | {body_text[:240]}"
	except Exception:
		pass
	return detail


def should_use_cached_lookup(entry: dict[str, Any]) -> bool:
	"""Only a successful lookup with a usable demo URL is a cache hit.

	Every state without a URL is re-checked on every workflow run. A replay can
	appear after the match record itself, so Option 4 must keep asking until one
	is available.
	"""
	status = str(entry.get("status") or "")
	if status == "ok" and entry.get("demo_url"):
		return True

	# Any row without a usable URL is deliberately NOT a cache hit. This includes
	# missing_demo_url, unavailable, rate limits and transient failures. Replays
	# often appear after the match itself, so Option 4 must ask again every run.
	return False


def row_output_zip_path(row: dict[str, Any]) -> Path:
	match_id = int(row["match_id"])
	demo_url = str(row["demo_url"])
	download_name = pick_download_filename(match_id, demo_url)
	zip_name = derive_zip_filename(download_name, match_id)
	_, output_zip_path = build_output_paths(row, zip_name)
	return output_zip_path


def should_skip_download_from_state(row: dict[str, Any], state_entry: dict[str, Any]) -> bool:
	if FORCE_REPROCESS_DOWNLOADS:
		return False

	status = str(state_entry.get("status") or "")
	demo_url = str(row.get("demo_url") or "")
	if status in {"ok", "already_local", "already_local_member_normalized"}:
		if str(state_entry.get("demo_url") or "") != demo_url:
			return False
		path_text = str(state_entry.get("output_zip_path") or "")
		if not path_text:
			return False
		return file_has_content(Path(path_text))

	if status == "demo_expired":
		# The replay file is gone from Valve's servers. Re-checking on every run only
		# burns requests, so wait EXPIRED_RECHECK_HOURS unless the URL changed.
		if str(state_entry.get("demo_url") or "") != demo_url:
			return False
		try:
			last = datetime.fromisoformat(str(state_entry.get("last_attempt_at") or ""))
			if last.tzinfo is None:
				last = last.replace(tzinfo=timezone.utc)
			return datetime.now(timezone.utc) - last < timedelta(hours=EXPIRED_RECHECK_HOURS)
		except ValueError:
			return False

	if status in {"download_error", "extract_error", "zip_error", "zip_verify_error", "organize_error", "worker_error"}:
		# Never let a previous failure suppress the next workflow run. Successful
		# outputs are still skipped above, but failed work is always retryable.
		return False

	return False


def safe_text(value: Any, fallback: str = "unknown") -> str:
	text = str(value).strip() if value is not None else ""
	return text or fallback



def compact_match_context(row: dict[str, Any]) -> str:
	parts = [
		safe_text(row.get("series_title") or row.get("series_slug")),
		safe_text(row.get("week_label")),
		safe_text(row.get("region")),
		safe_text(row.get("stage")),
		safe_text(row.get("game_title") or row.get("game_name")),
	]
	return " / ".join(parts)


def compact_match_context_no_series(row: dict[str, Any]) -> str:
	parts = [
		safe_text(row.get("week_label")),
		safe_text(row.get("region")),
		safe_text(row.get("stage")),
		safe_text(row.get("game_title") or row.get("game_name")),
	]
	return " / ".join(parts)


def compact_match_teams(row: dict[str, Any]) -> str:
	team_a = safe_text(row.get("team_a"), fallback="")
	team_b = safe_text(row.get("team_b"), fallback="")
	if team_a and team_b:
		return f"{team_a} vs {team_b}"
	if team_a:
		return team_a
	if team_b:
		return team_b
	return ""


def compact_match_line(row: dict[str, Any]) -> str:
	match_id = safe_text(row.get("match_id"))
	context = compact_match_context(row)
	teams = compact_match_teams(row)
	parts = [match_id]
	if teams:
		parts.append(teams)
	parts.append(f"[{context}]")
	return " - ".join(parts)


def compact_match_line_no_series(row: dict[str, Any]) -> str:
	match_id = safe_text(row.get("match_id"))
	context = compact_match_context_no_series(row)
	teams = compact_match_teams(row)
	parts = [match_id]
	if teams:
		parts.append(teams)
	parts.append(f"[{context}]")
	return " - ".join(parts)


def grouped_rows(rows: list[dict[str, Any]], include_error: bool = False) -> list[tuple[str, list[dict[str, Any]]]]:
	groups: dict[str, list[dict[str, Any]]] = {}
	for row in rows:
		status = safe_text(row.get("status"))
		key = status
		if include_error:
			key = f"{status}::{safe_text(row.get('error'), fallback='no error message provided')}"
		groups.setdefault(key, []).append(row)
	return sorted(groups.items(), key=lambda item: (-len(item[1]), item[0]))


def grouped_rows_by_series(rows: list[dict[str, Any]]) -> list[tuple[str, list[dict[str, Any]]]]:
	groups: dict[str, list[dict[str, Any]]] = {}
	for row in rows:
		series_name = safe_text(row.get("series_title") or row.get("series_slug"))
		groups.setdefault(series_name, []).append(row)
	return sorted(groups.items(), key=lambda item: (-len(item[1]), item[0].lower()))


def format_group_heading(rows: list[dict[str, Any]], include_error: bool = False) -> str:
	first = rows[0]
	status = safe_text(first.get("status"))
	count = len(rows)
	if include_error:
		error = safe_text(first.get("error"), fallback="no error message provided")
		return f"{count} match{'es' if count != 1 else ''} - {status}: {error}"
	return f"{count} match{'es' if count != 1 else ''}"


def write_stats_report(
	path: Path,
	replay_links_payload: dict[str, Any],
	download_results: list[dict[str, Any]] | None = None,
	verification: dict[str, int] | None = None,
) -> None:
	items = replay_links_payload.get("items", []) if isinstance(replay_links_payload, dict) else []
	rows = [row for row in items if isinstance(row, dict)]
	with_demo_url = [row for row in rows if row.get("demo_url")]
	missing_demo_url = [row for row in rows if row.get("status") in {"missing_demo_url", "unavailable"}]
	fetch_errors = [row for row in rows if row.get("status") not in {"ok", "missing_demo_url", "unavailable"}]

	download_results = download_results or []
	download_errors = [
		row
		for row in download_results
		if isinstance(row, dict) and row.get("status") not in {
			"ok",
			"already_local",
			"already_local_member_normalized",
			"state_skipped",
			"retry_deferred",
			"expired_skipped",
			"demo_expired",
		}
	]

	lines: list[str] = []
	lines.append("Deadlock Replay Stats")
	lines.append(f"Generated at: {now_iso()}")
	lines.append(f"Replay database: {DB_FILE}")
	lines.append(f"Source matches: {safe_text(replay_links_payload.get('source_matches'), fallback='unknown')}")
	lines.append(f"API base: {API_BASE}")
	lines.append("")
	lines.append("At a Glance")
	lines.append(f"- Replay rows: {len(rows)}")
	lines.append(f"- Replays found: {len(with_demo_url)}")
	lines.append(f"- Replays missing: {len(missing_demo_url)}")
	lines.append(f"- Lookup errors: {len(fetch_errors)}")
	if download_results:
		downloaded = sum(1 for row in download_results if row.get("downloaded"))
		skipped_download = sum(1 for row in download_results if row.get("skipped_download"))
		already_local = sum(1 for row in download_results if row.get("already_local"))
		zipped = sum(1 for row in download_results if row.get("zipped"))
		download_error_count = sum(1 for row in download_results if row.get("download_errors"))
		zip_error_count = sum(1 for row in download_results if row.get("zip_errors"))
		lines.append(f"- Downloaded: {downloaded}")
		lines.append(f"- Reused local files: {skipped_download + already_local}")
		lines.append(f"- ZIPs created: {zipped}")
		lines.append(f"- Processing errors: {download_error_count + zip_error_count}")
		expired = sum(1 for row in download_results if row.get("status") in {"demo_expired", "expired_skipped"})
		lines.append(f"- Expired replays (gone from server): {expired}")
	if verification is not None:
		lines.append(f"- ZIP files present: {verification.get('zip_files', 0)}")
		lines.append(f"- Normalized ZIP internal members: {verification.get('normalized_zip_members', 0)}")
		lines.append(f"- Removed public DEM files: {verification.get('removed_dem_files', 0)}")

	lines.append("")
	lines.append("Missing Replay URLs")
	if missing_demo_url:
		for series_name, series_rows in grouped_rows_by_series(missing_demo_url):
			lines.append(f"- {series_name} ({len(series_rows)})")
			for row in series_rows:
				lines.append(f"  - {compact_match_line_no_series(row)}")
	else:
		lines.append("- None")

	lines.append("")
	lines.append("Lookup Errors")
	if fetch_errors:
		for series_name, series_rows in grouped_rows_by_series(fetch_errors):
			lines.append(f"- {series_name} ({len(series_rows)})")
			for group_key, group_rows_list in grouped_rows(series_rows, include_error=True):
				lines.append(f"  - {format_group_heading(group_rows_list, include_error=True)}")
				for row in group_rows_list:
					lines.append(f"    - {compact_match_line_no_series(row)}")
	else:
		lines.append("- None")

	if download_errors:
		lines.append("")
		lines.append("Download / Packaging Errors")
		for series_name, series_rows in grouped_rows_by_series(download_errors):
			lines.append(f"- {series_name} ({len(series_rows)})")
			for group_key, group_rows_list in grouped_rows(series_rows, include_error=True):
				lines.append(f"  - {format_group_heading(group_rows_list, include_error=True)}")
				for row in group_rows_list:
					lines.append(f"    - {compact_match_line_no_series(row)}")

	write_text_file(path, "\n".join(lines))


def load_match_metadata_index() -> dict[int, dict[str, Any]]:
	log("sort", "Loading match metadata index from SQLite")
	lookup: dict[int, dict[str, Any]] = {}

	for row in load_matches_from_db():
		lookup[int(row["match_id"])] = row

	payload = load_replay_links_payload()
	for row in payload.get("items", []):
		if isinstance(row, dict) and isinstance(row.get("match_id"), int):
			lookup[int(row["match_id"])] = row

	log("sort", f"Loaded {len(lookup)} match rows from SQLite")
	return lookup

def build_fallback_match_metadata(match_id: int) -> dict[str, Any]:
	manual_override = get_manual_demo_url(match_id)
	series_slug = "manual-overrides" if manual_override else "unknown-series"
	series_title = "Manual Overrides" if manual_override else "Unknown Series"
	return {
		"match_id": match_id,
		"series_title": series_title,
		"series_slug": series_slug,
		"week_num": 0,
		"week_label": "week-unknown",
		"region": "Unknown Region",
		"team_a": "",
		"team_b": "",
		"stage": "unknown",
		"game_title": "",
		"game_name": "",
	}


def walk_match_ids(node: Any, out: set[int]) -> None:
	if isinstance(node, dict):
		for k, v in node.items():
			if k == "match_id" and isinstance(v, int):
				out.add(v)
			else:
				walk_match_ids(v, out)
		return

	if isinstance(node, list):
		for item in node:
			walk_match_ids(item, out)


def slugify(text: str) -> str:
	value = text.strip().lower()
	value = value.replace("&", " and ")
	value = _SLUG_NON_ALNUM_RE.sub("-", value)
	value = value.strip("-")
	return value or "unknown"


def safe_segment(text: str, fallback: str = "unknown") -> str:
	value = text.strip()
	value = _INVALID_SEGMENT_CHARS_RE.sub("-", value)
	value = _WHITESPACE_RE.sub(" ", value)
	value = value.strip(" .")
	return value or fallback


def detect_series_stage(game_obj: dict[str, Any], match_obj: dict[str, Any]) -> str:
	candidates = [
		str(game_obj.get("game") or ""),
		str(game_obj.get("title") or ""),
		str(match_obj.get("game") or ""),
	]
	joined = " ".join(candidates).lower()
	if "final" in joined:
		return "finals"
	if "challenger" in joined:
		return "challenger"
	if "semi" in joined:
		return "semi"
	return "regular"


def collect_match_entries(data: Any) -> list[dict[str, Any]]:
	log("collect", "Collecting match entries from source tree")
	entries_by_id: dict[int, dict[str, Any]] = {}
	series_list = data.get("series", []) if isinstance(data, dict) else []

	if not isinstance(series_list, list):
		return []

	for series in series_list:
		if not isinstance(series, dict):
			continue

		series_title = str(series.get("title") or "Unknown Series")
		series_slug = slugify(series_title)
		weeks = series.get("weeks", [])
		if not isinstance(weeks, list):
			continue

		for week_obj in weeks:
			if not isinstance(week_obj, dict):
				continue

			week_value = week_obj.get("week")
			week_num = int(week_value) if isinstance(week_value, int) else 0
			week_label = f"week-{week_num:02d}" if week_num > 0 else "week-unknown"
			games = week_obj.get("games", [])
			if not isinstance(games, list):
				continue

			for game_obj in games:
				if not isinstance(game_obj, dict):
					continue

				region = safe_segment(str(game_obj.get("region") or "Unknown Region"))
				raw_team_a = str(game_obj.get("team_a") or "").strip()
				raw_team_b = str(game_obj.get("team_b") or "").strip()
				team_a = safe_segment(raw_team_a, fallback="") if raw_team_a else ""
				team_b = safe_segment(raw_team_b, fallback="") if raw_team_b else ""
				game_title = safe_segment(str(game_obj.get("title") or game_obj.get("game") or ""), fallback="")

				matches: list[dict[str, Any]]
				matches_obj = game_obj.get("matches")
				if isinstance(matches_obj, list):
					matches = [m for m in matches_obj if isinstance(m, dict)]
				else:
					single_match_id = game_obj.get("match_id")
					if not isinstance(single_match_id, int):
						continue
					matches = [{
						"match_id": single_match_id,
						"game": str(game_obj.get("game") or game_obj.get("title") or ""),
					}]

				for match_obj in matches:
					if not isinstance(match_obj, dict):
						continue

					match_id = match_obj.get("match_id")
					if not isinstance(match_id, int):
						continue

					game_name = safe_segment(str(match_obj.get("game") or ""), fallback="")
					stage = detect_series_stage(game_obj, match_obj)

					entry = {
						"match_id": match_id,
						"series_title": series_title,
						"series_slug": series_slug,
						"week_num": week_num,
						"week_label": week_label,
						"region": region,
						"team_a": team_a,
						"team_b": team_b,
						"has_teams": bool(team_a and team_b),
						"stage": stage,
						"game_title": game_title,
						"game_name": game_name,
					}

					entries_by_id[match_id] = entry

	entries = [entries_by_id[mid] for mid in sorted(entries_by_id)]
	log("collect", f"Collected {len(entries)} unique matches")
	return entries


def retry_delay_seconds(attempt: int) -> int:
	return min(RETRY_MAX_SECONDS, RETRY_BASE_SECONDS * (2 ** max(0, attempt - 1)))


def parse_rate_limit_wait(headers: Any) -> float:
	"""Return server-advertised rate-limit wait, or the configured fallback."""
	now_wall = time.time()
	try:
		retry_after = headers.get("Retry-After")
		if retry_after:
			text = str(retry_after).strip()
			try:
				return max(1.0, float(text))
			except ValueError:
				try:
					dt = email.utils.parsedate_to_datetime(text)
					if dt.tzinfo is None:
						dt = dt.replace(tzinfo=timezone.utc)
					return max(1.0, dt.timestamp() - now_wall)
				except Exception:
					pass

		for name in ("X-RateLimit-Reset", "RateLimit-Reset", "X-Rate-Limit-Reset"):
			value = headers.get(name)
			if not value:
				continue
			try:
				reset = float(str(value).strip())
				# Most APIs expose either epoch seconds or seconds-until-reset.
				if reset > 10_000_000:
					return max(1.0, reset - now_wall)
				return max(1.0, reset)
			except ValueError:
				continue
	except Exception:
		pass
	return float(RATE_LIMIT_FALLBACK_SECONDS)


def is_deadlock_api_url(url: str) -> bool:
	try:
		return urllib.parse.urlparse(url).netloc.lower() == urllib.parse.urlparse(API_BASE).netloc.lower()
	except Exception:
		return url.startswith(API_BASE)


def is_retryable_http_error(exc: urllib.error.HTTPError) -> bool:
	return exc.code in TRANSIENT_HTTP_CODES or exc.code >= 500


def http_get_json(url: str) -> Any:
	is_api = is_deadlock_api_url(url)
	last_error: Exception | None = None

	rate_limit_hits = 0
	attempt = 0

	while attempt < HTTP_RETRY_ATTEMPTS:
		attempt += 1
		if is_api:
			_API_RATE_LIMIT_GATE.wait()

		headers = {
			"Accept": "application/json",
			"User-Agent": random_user_agent(),
		}
		if API_KEY and is_api:
			headers["X-API-KEY"] = API_KEY

		log("http", f"GET {url} (attempt {attempt}/{HTTP_RETRY_ATTEMPTS})")
		req = urllib.request.Request(url=url, headers=headers, method="GET")
		try:
			with urllib.request.urlopen(req, timeout=30) as response:
				body = response.read().decode("utf-8")
				payload = json.loads(body)
			if is_api:
				_API_RATE_LIMIT_GATE.success()
			log("http", f"GET complete {url} (bytes={len(body)}, attempt={attempt})")
			return payload
		except urllib.error.HTTPError as e:
			last_error = e
			if is_api and e.code == 429:
				rate_limit_hits += 1
				wait_seconds = min(parse_rate_limit_wait(e.headers), float(RATE_LIMIT_MAX_WAIT_SECONDS))
				_API_RATE_LIMIT_GATE.limited(wait_seconds)
				if rate_limit_hits > RATE_LIMIT_MAX_RETRIES:
					raise
				# Rate-limit waits do not use up the normal retry budget. The gate
				# owns the wait, so avoid an additional local backoff.
				attempt -= 1
				continue
			if not is_retryable_http_error(e) or attempt >= HTTP_RETRY_ATTEMPTS:
				raise
		except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
			last_error = e
			if attempt >= HTTP_RETRY_ATTEMPTS:
				raise
		except json.JSONDecodeError as e:
			last_error = e
			# A truncated/proxy response can be transient; retry before surfacing it.
			if attempt >= HTTP_RETRY_ATTEMPTS:
				raise

		delay = retry_delay_seconds(attempt)
		log("http", f"Transient GET failure for {url}; retrying in {delay}s: {last_error}")
		time.sleep(delay)

	raise RuntimeError(f"GET failed after retries: {url}: {last_error}")


def fetch_demo_url_for_match(match_id: int) -> dict[str, Any]:
	manual_demo_url = get_manual_demo_url(match_id)
	if manual_demo_url:
		log("fetch", f"Match {match_id} using manual replay URL override")
		return {
			"match_id": match_id,
			"demo_url": manual_demo_url,
			"demo_url_source": "manual",
			"fetched_at": now_iso(),
			"status": "ok",
			"error": None,
		}

	url = f"{API_BASE}/v1/matches/{match_id}/salts"
	log("fetch", f"Fetching demo URL for match {match_id}")
	try:
		payload = http_get_json(url)
		demo_url = payload.get("demo_url") if isinstance(payload, dict) else None
		log("fetch", f"Match {match_id} fetch result status={'ok' if demo_url else 'missing_demo_url'}")
		return {
			"match_id": match_id,
			"demo_url": demo_url,
			"demo_url_source": "api" if demo_url else None,
			"fetched_at": now_iso(),
			"status": "ok" if demo_url else "missing_demo_url",
			"error": None,
		}
	except urllib.error.HTTPError as e:
		error_text = format_http_error(e)
		status = classify_lookup_http_status(e.code, error_text)
		return {
			"match_id": match_id,
			"demo_url": None,
			"demo_url_source": None,
			"fetched_at": now_iso(),
			"status": status,
			"error": error_text,
		}
	except urllib.error.URLError as e:
		return {
			"match_id": match_id,
			"demo_url": None,
			"demo_url_source": None,
			"fetched_at": now_iso(),
			"status": "network_error",
			"error": str(e.reason),
		}
	except (json.JSONDecodeError, TimeoutError) as e:
		return {
			"match_id": match_id,
			"demo_url": None,
			"demo_url_source": None,
			"fetched_at": now_iso(),
			"status": "parse_error",
			"error": str(e),
		}


def enrich_with_demo_url(entry: dict[str, Any]) -> dict[str, Any]:
	match_id = int(entry["match_id"])
	result = fetch_demo_url_for_match(match_id)
	return {
		**entry,
		"demo_url": result["demo_url"],
		"demo_url_source": result.get("demo_url_source"),
		"fetched_at": result["fetched_at"],
		"status": result["status"],
		"error": result["error"],
	}


def get_matches_tree_urls() -> list[str]:
	"""Return ordered match-tree URLs, preferring the local app endpoint."""
	urls: list[str] = []

	multi = os.getenv("MATCHES_TREE_URLS")
	if multi:
		for raw_url in multi.split(","):
			url = raw_url.strip()
			if url and url not in urls:
				urls.append(url)

	for url in [MATCHES_TREE_URL, MATCHES_TREE_FALLBACK_URL]:
		url = str(url or "").strip()
		if url and url not in urls:
			urls.append(url)

	return urls


def is_valid_matches_tree(data: Any) -> bool:
	return isinstance(data, dict) and isinstance(data.get("series"), list)


def fetch_and_store_matches_tree() -> list[dict[str, Any]] | None:
	"""Fetch the match tree from every configured source and persist the union.

	Sources are queried in priority order (local app first). Each source may be
	cached or partial, so matches missing from a higher-priority source are still
	picked up from the others instead of being silently dropped. Returns the
	merged match entries, or None if no source responded.
	"""
	last_error: Exception | None = None
	merged: dict[int, dict[str, Any]] = {}
	used_sources: list[str] = []

	for url in get_matches_tree_urls():
		log("matches", f"Fetching match tree from {url}")
		try:
			data = http_get_json(url)
		except Exception as e:
			last_error = e
			log("matches", f"Failed to fetch match tree from {url}: {e}")
			continue

		if not is_valid_matches_tree(data):
			log("matches", f"Invalid match tree payload from {url}; trying next source")
			continue

		entries = collect_match_entries(data)
		new_count = 0
		for entry in entries:
			if entry["match_id"] not in merged:
				merged[entry["match_id"]] = entry
				new_count += 1
		used_sources.append(url)
		log("matches", f"Source {url}: {len(entries)} matches ({new_count} not seen in earlier sources)")

	if not used_sources:
		if last_error is not None:
			log("matches", f"Failed to fetch match tree from all sources. Last error: {last_error}")
		else:
			log("matches", "Failed to fetch match tree from all sources; no usable URLs configured")
		return None

	entries = [merged[mid] for mid in sorted(merged)]
	upsert_matches(entries)
	set_meta("matches_source_url", ", ".join(used_sources))
	set_meta("matches_refreshed_at", now_iso())
	log("matches", f"Stored {len(entries)} matches in {DB_FILE.name} (sources={len(used_sources)})")
	return entries


def fetch_all_match_replay_links() -> None:
	log("fetch-all", "Starting replay link fetch workflow")
	fetched = fetch_and_store_matches_tree()
	known: dict[int, dict[str, Any]] = {int(e["match_id"]): e for e in load_matches_from_db()}
	if fetched is not None:
		source_label = get_meta("matches_source_url", DB_FILE.name) or DB_FILE.name
		for entry in fetched:
			known[int(entry["match_id"])] = entry
	else:
		source_label = DB_FILE.name
		if known:
			log("fetch-all", f"Live match-tree fetch failed; using {len(known)} cached matches from SQLite")
	# Previously known matches are kept so a partial/stale source never drops them.
	entries = [known[mid] for mid in sorted(known)]

	if not entries:
		log("fetch-all", "No match IDs available from live source or SQLite cache")
		return

	log("fetch-all", f"Found {len(entries)} match IDs")
	lookup_cache = load_replay_states()
	results_by_match: dict[int, dict[str, Any]] = {}
	entries_to_fetch: list[dict[str, Any]] = []
	cached_hits = 0

	for entry in entries:
		match_id = int(entry["match_id"])
		cached = lookup_cache.get(match_id)
		if cached and not FORCE_REFRESH_LOOKUPS and should_use_cached_lookup(cached):
			results_by_match[match_id] = {
				**entry,
				"demo_url": cached.get("demo_url"),
				"demo_url_source": cached.get("demo_url_source"),
				"fetched_at": cached.get("fetched_at") or now_iso(),
				"status": cached.get("status") or "missing_demo_url",
				"error": cached.get("error"),
			}
			cached_hits += 1
			continue
		entries_to_fetch.append(entry)

	log("fetch-all", f"Lookup cache hits: {cached_hits}")
	log("fetch-all", f"Fetching from API: {len(entries_to_fetch)}")
	log("fetch-all", f"Using {FETCH_WORKERS} worker threads")
	load_manual_replay_url_map()

	TRANSIENT_LOOKUP_STATUSES = {"rate_limited", "http_error", "network_error", "parse_error", "worker_error"}

	def run_lookups(batch: list[dict[str, Any]], label: str) -> None:
		with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
			future_to_match = {
				executor.submit(enrich_with_demo_url, entry): entry
				for entry in batch
			}
			completed = 0
			for future in as_completed(future_to_match):
				base = future_to_match[future]
				match_id = int(base["match_id"])
				try:
					row = future.result()
				except Exception as e:
					row = {**base, "demo_url": None, "demo_url_source": None, "fetched_at": now_iso(), "status": "worker_error", "error": str(e)}

				results_by_match[match_id] = row
				completed += 1
				status = str(row.get("status") or "unknown")
				log_progress_status(label, completed, len(batch), f"Match {match_id}", status, had_error=status in TRANSIENT_LOOKUP_STATUSES)

	run_lookups(entries_to_fetch, "fetch-all")

	# Transient failures (rate limits, network blips) get extra passes after a cooldown
	# so one bad moment does not leave a match without a replay URL until the next run.
	for retry_pass in range(1, LOOKUP_RETRY_PASSES + 1):
		failed = [e for e in entries_to_fetch if results_by_match[int(e["match_id"])].get("status") in TRANSIENT_LOOKUP_STATUSES]
		if not failed:
			break
		log("fetch-all", f"Retry pass {retry_pass}/{LOOKUP_RETRY_PASSES}: {len(failed)} lookups failed transiently; retrying in {LOOKUP_RETRY_DELAY_SECONDS}s")
		time.sleep(LOOKUP_RETRY_DELAY_SECONDS)
		run_lookups(failed, "fetch-retry")

	status_counts: dict[str, int] = {}
	for entry in entries_to_fetch:
		row = results_by_match[int(entry["match_id"])]
		status_counts[str(row.get("status"))] = status_counts.get(str(row.get("status")), 0) + 1
	if status_counts:
		log("fetch-all", "Lookup results: " + ", ".join(f"{k}={v}" for k, v in sorted(status_counts.items())))

	results = [results_by_match[int(entry["match_id"])] for entry in entries]
	save_replay_links(results, source_label)

	ok = sum(1 for r in results if r.get("demo_url"))
	missing = sum(1 for r in results if r.get("status") in {"missing_demo_url", "unavailable"})
	errors = len(results) - ok - missing
	payload = load_replay_links_payload()
	write_stats_report(STATS_FILE, payload)

	log("fetch-all", "Replay link fetch complete")
	log("fetch-all", f"Saved to SQLite: {DB_FILE}")
	log("fetch-all", f"With demo URL: {ok}")
	log("fetch-all", f"Missing demo URL: {missing}")
	log("fetch-all", f"Errors: {errors}")

def safe_download_file(url: str, destination: Path) -> None:
	"""Download atomically, retrying transient/partial failures.

	The final destination is replaced only after a complete non-empty response has
	been written. A failed attempt never leaves a .part file that can be mistaken
	for a valid replay later.
	"""
	temp_path = destination.with_suffix(destination.suffix + ".part")
	last_error: Exception | None = None

	for attempt in range(1, DOWNLOAD_RETRY_ATTEMPTS + 1):
		cleanup_file(temp_path)
		log("download", f"Starting download attempt {attempt}/{DOWNLOAD_RETRY_ATTEMPTS}: {url} -> {destination}")
		req = urllib.request.Request(
			url=url,
			headers={"User-Agent": random_user_agent()},
			method="GET",
		)

		try:
			bytes_written = 0
			with urllib.request.urlopen(req, timeout=120) as response, temp_path.open("wb") as out:
				content_length = response.headers.get("Content-Length")
				expected_bytes = int(content_length) if content_length and content_length.isdigit() else None
				while True:
					chunk = response.read(IO_CHUNK_BYTES)
					if not chunk:
						break
					out.write(chunk)
					bytes_written += len(chunk)

			if bytes_written <= 0:
				raise IOError("download returned an empty response")
			if expected_bytes is not None and bytes_written != expected_bytes:
				raise IOError(f"incomplete download: expected {expected_bytes} bytes, got {bytes_written}")

			temp_path.replace(destination)
			log("download", f"Download complete: {destination} ({bytes_written} bytes, attempt={attempt})")
			return
		except urllib.error.HTTPError as e:
			last_error = e
			cleanup_file(temp_path)
			if not is_retryable_http_error(e) or attempt >= DOWNLOAD_RETRY_ATTEMPTS:
				raise
		except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as e:
			last_error = e
			cleanup_file(temp_path)
			if attempt >= DOWNLOAD_RETRY_ATTEMPTS:
				raise

		delay = retry_delay_seconds(attempt)
		log("download", f"Transient download failure; retrying in {delay}s: {last_error}")
		time.sleep(delay)

	raise RuntimeError(f"Download failed after retries: {url}: {last_error}")


def pick_download_filename(match_id: int, demo_url: str) -> str:
	parsed = urllib.parse.urlparse(demo_url)
	basename = Path(parsed.path).name.strip()

	if not basename:
		basename = f"{match_id}.dem"

	prefix = f"{match_id}_"
	if not basename.startswith(prefix):
		basename = f"{prefix}{basename}"

	return basename


def derive_dem_filename(download_filename: str) -> str:
	if download_filename.endswith(".dem.bz2"):
		return download_filename[: -len(".bz2")]

	if download_filename.endswith(".bz2"):
		stem = download_filename[: -len(".bz2")]
		if stem.endswith(".dem"):
			return stem
		return f"{stem}.dem"

	if download_filename.endswith(".dem"):
		return download_filename

	stem = Path(download_filename).stem
	return f"{stem}.dem"


def is_bz2_file(path: Path) -> bool:
	return path.name.endswith(".bz2")


def decompress_bz2_to_dem(input_bz2: Path, output_dem: Path) -> None:
	log("extract", f"Decompressing {input_bz2} -> {output_dem}")
	temp_path = output_dem.with_suffix(output_dem.suffix + ".part")
	bytes_written = 0
	with bz2.open(input_bz2, "rb") as src, temp_path.open("wb") as dst:
		while True:
			chunk = src.read(IO_CHUNK_BYTES)
			if not chunk:
				break
			dst.write(chunk)
			bytes_written += len(chunk)
	temp_path.replace(output_dem)
	log("extract", f"Decompress complete: {output_dem} ({bytes_written} bytes)")


def copy_raw_to_dem(input_path: Path, output_dem: Path) -> None:
	log("materialize", f"Copying raw DEM data: {input_path} -> {output_dem}")
	temp_path = output_dem.with_suffix(output_dem.suffix + ".part")
	bytes_written = 0

	with input_path.open("rb") as src, temp_path.open("wb") as dst:
		while True:
			chunk = src.read(IO_CHUNK_BYTES)
			if not chunk:
				break
			dst.write(chunk)
			bytes_written += len(chunk)

	temp_path.replace(output_dem)
	log("materialize", f"Raw DEM copy complete: {output_dem} ({bytes_written} bytes)")


def file_looks_like_text_error(path: Path) -> bool:
	try:
		with path.open("rb") as handle:
			head = handle.read(1024).lower()
	except Exception:
		return False

	if not head:
		return True

	text_markers = [
		b"<!doctype html",
		b"<html",
		b"<head",
		b"<body",
		b"access denied",
		b"not found",
		b"forbidden",
		b"error",
	]

	return any(marker in head for marker in text_markers)


def materialize_dem_file(download_path: Path, dem_path: Path) -> None:
	log("materialize", f"Materialize file: {download_path} -> {dem_path}")

	if download_path == dem_path:
		log("materialize", "Source and destination are same path, skipping copy")
		return

	if is_bz2_file(download_path):
		temp_path = dem_path.with_suffix(dem_path.suffix + ".part")

		try:
			decompress_bz2_to_dem(download_path, dem_path)
			return
		except Exception as e:
			cleanup_file(temp_path)

			try:
				with download_path.open("rb") as handle:
					signature = handle.read(3)
			except Exception:
				signature = b""

			if signature == b"BZh":
				log(
					"extract",
					f"Bzip2 header found but decompression failed. Cached file may be corrupt: {download_path} ({e})",
				)
				raise

			if file_looks_like_text_error(download_path):
				log(
					"extract",
					f"Download does not look like bzip2 or DEM data. Refusing to package possible error page: {download_path}",
				)
				raise RuntimeError(f"Downloaded file is not valid bzip2/DEM data: {download_path}") from e

			log(
				"extract",
				f"File has .bz2 extension but is not bzip2. Treating as raw DEM data: {download_path}",
			)
			copy_raw_to_dem(download_path, dem_path)
			return

	copy_raw_to_dem(download_path, dem_path)


def compress_to_zip(input_file: Path, zip_path: Path, arcname: str | None = None) -> None:
	archive_name = arcname or input_file.name
	log("zip", f"Creating zip {zip_path} from {input_file} as {archive_name}")
	with zipfile.ZipFile(zip_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=ZIP_COMPRESS_LEVEL) as zf:
		zf.write(input_file, arcname=archive_name)
	log("zip", f"Zip created: {zip_path}")


def stream_bz2_to_zip(input_bz2: Path, zip_path: Path, arcname: str) -> None:
	"""Decompress bz2 straight into a zip member, skipping the intermediate .dem."""
	temp_path = zip_path.with_suffix(zip_path.suffix + ".part")
	try:
		with bz2.open(input_bz2, "rb") as src, zipfile.ZipFile(
			temp_path, mode="w", compression=zipfile.ZIP_DEFLATED, compresslevel=ZIP_COMPRESS_LEVEL
		) as zf, zf.open(arcname, "w", force_zip64=True) as dst:
			while True:
				chunk = src.read(IO_CHUNK_BYTES)
				if not chunk:
					break
				dst.write(chunk)
		temp_path.replace(zip_path)
	except BaseException:
		cleanup_file(temp_path)
		raise


def move_file(source: Path, destination: Path) -> None:
	"""Atomically place a file, falling back to a copy across filesystems."""
	try:
		os.replace(source, destination)
	except OSError:
		materialize_dem_file(source, destination)


def zip_contains_member(zip_path: Path, member_name: str) -> bool:
	log("zip", f"Verifying zip member '{member_name}' in {zip_path}")
	with zipfile.ZipFile(zip_path, mode="r") as zf:
		names = zf.namelist()
		present = member_name in names
	log("zip", f"Zip member check result: present={present} names={names}")
	return present


def rewrite_zip_with_member_name(source_zip: Path, target_zip: Path, member_name: str) -> bool:
	"""Rebuild a zip to ensure it contains exactly member_name as the demo entry."""
	log("normalize", f"Rewriting zip member name: {source_zip} -> {target_zip} member={member_name}")
	temp_target = target_zip.with_suffix(target_zip.suffix + ".part")
	with zipfile.ZipFile(source_zip, mode="r") as src:
		names = [name for name in src.namelist() if not name.endswith("/")]
		if len(names) != 1:
			log("normalize", f"Skip rewrite: expected 1 entry, got {len(names)}")
			return False

		entry = names[0]
		data = src.read(entry)

	with zipfile.ZipFile(temp_target, mode="w", compression=zipfile.ZIP_DEFLATED) as dst:
		dst.writestr(member_name, data)

	temp_target.replace(target_zip)
	log("normalize", f"Rewrite complete: {target_zip}")
	return True


def ensure_zip_has_matchid_dem(zip_path: Path, match_id: int) -> tuple[bool, bool]:
	"""Ensure zip contains match_id.dem while preserving zip filename."""
	expected_member = f"{match_id}.dem"
	if not file_has_content(zip_path):
		return False, False

	try:
		if zip_contains_member(zip_path, expected_member):
			return True, False

		# Rebuild in-place if needed (e.g., salted internal DEM name).
		if rewrite_zip_with_member_name(zip_path, zip_path, expected_member):
			log("normalize", f"Rewrote ZIP member in-place: {zip_path} -> {expected_member}")
			return True, True
	except Exception as e:
		log("normalize", f"Failed to normalize ZIP members for {zip_path}: {e}")

	return False, False


def derive_zip_filename(download_filename: str, match_id: int) -> str:
	# Keep salted naming on zip files when present.
	if download_filename.endswith(".dem.bz2"):
		return f"{download_filename[:-len('.dem.bz2')]}.zip"
	if download_filename.endswith(".dem"):
		return f"{download_filename[:-len('.dem')]}.zip"
	if download_filename.endswith(".bz2"):
		return f"{download_filename[:-len('.bz2')]}.zip"
	if download_filename:
		return f"{Path(download_filename).stem}.zip"
	return f"{match_id}.zip"


def build_output_paths(row: dict[str, Any], zip_name: str) -> tuple[Path, Path]:
	match_id = int(row["match_id"])
	series_slug = slugify(str(row.get("series_slug") or row.get("series_title") or "unknown-series"))
	week_num = int(row.get("week_num") or 0)
	week_label = f"week-{week_num:02d}" if week_num > 0 else safe_segment(str(row.get("week_label") or "week-unknown"))
	region_segment = slugify(str(row.get("region") or "unknown-region"))
	team_a = safe_segment(str(row.get("team_a") or ""), fallback="")
	team_b = safe_segment(str(row.get("team_b") or ""), fallback="")
	stage = slugify(str(row.get("stage") or "regular"))
	game_name = safe_segment(str(row.get("game_name") or row.get("game_title") or ""), fallback="")
	game_title = safe_segment(str(row.get("game_title") or row.get("game_name") or ""), fallback="")

	context_parts = [stage]
	if game_name:
		context_parts.append(slugify(game_name))
	context_segment = "_".join(part for part in context_parts if part)

	if team_a and team_b:
		match_folder_name = safe_segment(
			f"{match_id} - {team_a} vs {team_b}"
			+ (f" - {context_segment}" if context_segment else "")
		)
	else:
		fallback_label = game_title or game_name or safe_segment(str(row.get("stage") or "match"))
		match_folder_name = safe_segment(f"{match_id} - {fallback_label}")

	match_output_dir = OUTPUT_ROOT / series_slug / week_label / region_segment / match_folder_name
	output_zip_path = match_output_dir / zip_name
	return match_output_dir, output_zip_path


def file_has_content(path: Path) -> bool:
	return path.exists() and path.is_file() and path.stat().st_size > 0


def cleanup_file(path: Path) -> None:
	if path.exists() and path.is_file():
		log("cleanup", f"Removing file: {path}")
		path.unlink()


def verify_public_storage(root: Path, verbose: bool = False) -> dict[str, int]:
	log("verify", f"Starting verification root={root} verbose={verbose}")
	if not root.exists() or not root.is_dir():
		log("verify", f"Root does not exist or not a directory: {root}")
		return {"removed_dem_files": 0, "zip_files": 0, "normalized_zip_members": 0}

	removed_dem_files = 0
	zip_files = 0
	normalized_zip_members = 0
	files_scanned = 0
	zip_jobs: list[tuple[Path, int]] = []

	for path in root.rglob("*"):
		if not path.is_file():
			continue

		files_scanned += 1
		name = path.name.lower()
		if name.endswith(".zip"):
			zip_files += 1
			match = _ZIP_MATCH_ID_RE.match(path.name)
			if match:
				zip_jobs.append((path, int(match.group(1))))
			continue

		if name.endswith(".dem") or name.endswith(".dem.bz2"):
			cleanup_file(path)
			removed_dem_files += 1
			log("verify", f"Removed public DEM artifact: {path}")

	log("verify", f"Scanned {files_scanned} files; checking {len(zip_jobs)} ZIPs with {VERIFY_WORKERS} workers")

	# Keep zip filename, only normalize internal DEM member to match_id.dem.
	def check(job: tuple[Path, int]) -> tuple[Path, int, bool, bool]:
		zip_path, match_id = job
		ok, normalized = ensure_zip_has_matchid_dem(zip_path, match_id)
		return zip_path, match_id, ok, normalized

	with ThreadPoolExecutor(max_workers=VERIFY_WORKERS) as executor:
		for done, (zip_path, match_id, ok, normalized) in enumerate(executor.map(check, zip_jobs), start=1):
			if normalized:
				normalized_zip_members += 1
				log("verify", f"Normalized ZIP internal member for match {match_id}: {zip_path}")
			if not ok:
				log("verify", f"WARNING: ZIP could not be normalized for match {match_id}: {zip_path}")
			if done % VERIFY_PROGRESS_EVERY == 0:
				log("verify", f"Verify progress: {done}/{len(zip_jobs)} zips checked")

	log("verify", (
			f"Verify complete: scanned={files_scanned} "
			f"zips={zip_files} normalized_members={normalized_zip_members} removed_dem={removed_dem_files}"
		))

	return {
		"removed_dem_files": removed_dem_files,
		"zip_files": zip_files,
		"normalized_zip_members": normalized_zip_members,
	}


def process_replay_row(row: dict[str, Any]) -> dict[str, Any]:
	match_id = int(row["match_id"])
	log("process", f"Start match processing: match_id={match_id}")
	demo_url = str(row["demo_url"])
	download_name = pick_download_filename(match_id, demo_url)
	# Always normalize extracted demo name to match ID only.
	dem_name = f"{match_id}.dem"

	download_path = DOWNLOADS_DIR / download_name
	dem_path = DOWNLOADS_DIR / dem_name
	zip_name = derive_zip_filename(download_name, match_id)
	zip_path = ZIPS_DIR / zip_name
	match_output_dir, output_zip_path = build_output_paths(row, zip_path.name)
	already_ok, normalized_member = ensure_zip_has_matchid_dem(output_zip_path, match_id)

	result = {
		"match_id": match_id,
		"downloaded": 0,
		"skipped_download": 0,
		"already_local": 0,
		"zipped": 0,
		"download_errors": 0,
		"zip_errors": 0,
		"status": "ok",
		"error": None,
	}

	if already_ok:
		log("process", f"Match {match_id} already local; member_normalized={normalized_member}")
		result["already_local"] = 1
		result["status"] = "already_local"
		if normalized_member:
			result["status"] = "already_local_member_normalized"
		if not KEEP_INTERMEDIATE_FILES:
			cleanup_file(download_path)
			cleanup_file(dem_path)
			cleanup_file(zip_path)
		return result

	zip_ready = False
	if file_has_content(dem_path):
		log("process", f"Match {match_id} using existing local DEM: {dem_path}")
		result["skipped_download"] = 1
	else:
		used_cached_download = file_has_content(download_path)
		if used_cached_download:
			log("process", f"Match {match_id} using existing local download: {download_path}")
			result["skipped_download"] = 1
		else:
			try:
				safe_download_file(demo_url, download_path)
				result["downloaded"] = 1
			except Exception as e:
				if isinstance(e, urllib.error.HTTPError) and e.code in EXPIRED_DEMO_HTTP_CODES:
					result["status"] = "demo_expired"
					result["error"] = f"HTTP {e.code}: replay file no longer available"
					return result
				result["download_errors"] = 1
				result["status"] = "download_error"
				result["error"] = str(e)
				return result

		if is_bz2_file(download_path) and not KEEP_INTERMEDIATE_FILES:
			try:
				with download_path.open("rb") as handle:
					is_bzip = handle.read(3) == b"BZh"
				if is_bzip:
					stream_bz2_to_zip(download_path, zip_path, f"{match_id}.dem")
					zip_ready = True
			except Exception as e:
				log("process", f"Match {match_id} direct bz2->zip failed; falling back to staged extract: {e}")
				cleanup_file(zip_path)

		if not zip_ready:
			try:
				materialize_dem_file(download_path, dem_path)
			except Exception as first_error:
				# Existing downloads can be truncated/corrupt. Remove them and make one
				# fresh download immediately instead of poisoning every later run.
				log("process", f"Match {match_id} materialize failed; discarding cached download and retrying fresh: {first_error}")
				cleanup_file(download_path)
				cleanup_file(dem_path)
				cleanup_file(dem_path.with_suffix(dem_path.suffix + ".part"))
				try:
					safe_download_file(demo_url, download_path)
					result["downloaded"] = 1
					materialize_dem_file(download_path, dem_path)
				except Exception as e:
					cleanup_file(download_path)
					cleanup_file(dem_path)
					result["download_errors"] = 1
					result["status"] = "extract_error"
					result["error"] = f"{e} (initial materialize error: {first_error})"
					return result

	if not zip_ready:
		try:
			compress_to_zip(dem_path, zip_path, arcname=f"{match_id}.dem")
			result["zipped"] = 1
		except Exception as e:
			result["zip_errors"] = 1
			result["status"] = "zip_error"
			result["error"] = str(e)
			return result
	else:
		result["zipped"] = 1

	try:
		expected_member = f"{match_id}.dem"
		if not zip_contains_member(zip_path, expected_member):
			result["zip_errors"] = 1
			result["status"] = "zip_verify_error"
			result["error"] = f"ZIP missing expected member: {expected_member}"
			return result
	except Exception as e:
		result["zip_errors"] = 1
		result["status"] = "zip_verify_error"
		result["error"] = str(e)
		return result

	try:
		# Create categorized folders only when we are about to write final outputs.
		match_output_dir.mkdir(parents=True, exist_ok=True)
		log("process", f"Match {match_id} writing canonical public zip: {output_zip_path}")
		if KEEP_INTERMEDIATE_FILES:
			materialize_dem_file(zip_path, output_zip_path)
		else:
			move_file(zip_path, output_zip_path)
	except Exception as e:
		result["zip_errors"] = 1
		result["status"] = "organize_error"
		result["error"] = str(e)
		return result

	if not KEEP_INTERMEDIATE_FILES:
		# Keep only organized output files by default.
		log("process", f"Match {match_id} cleaning intermediate files")
		cleanup_file(download_path)
		cleanup_file(dem_path)
		cleanup_file(zip_path)

	log("process", f"Match {match_id} completed successfully")
	return result


def sort_unsorted_file(source_path: Path, match_lookup: dict[int, dict[str, Any]]) -> dict[str, Any]:
	log("sort", f"Start sorting file: {source_path}")
	result = {
		"path": str(source_path),
		"match_id": None,
		"sorted": 0,
		"skipped": 0,
		"errors": 0,
		"status": "ok",
		"error": None,
	}

	match = _MATCH_ID_PREFIX_RE.match(source_path.name)
	if not match:
		result["skipped"] = 1
		result["status"] = "no_match_id"
		return result

	match_id = int(match.group(1))
	result["match_id"] = match_id
	row = match_lookup.get(match_id)
	if not row:
		row = build_fallback_match_metadata(match_id)
		result["status"] = "sorted_fallback_metadata"
		if row.get("series_slug") == "manual-overrides":
			log("sort", f"Missing metadata for match {match_id}; sorting with manual override fallback")
		else:
			log("sort", f"Missing metadata for match {match_id}; sorting with generic fallback metadata")

	zip_name = derive_zip_filename(source_path.name, match_id)
	match_output_dir, output_zip_path = build_output_paths(row, zip_name)
	expected_member = f"{match_id}.dem"

	try:
		match_output_dir.mkdir(parents=True, exist_ok=True)
		if file_has_content(output_zip_path):
			log("sort", f"Existing zip found for match {match_id}: {output_zip_path}")
			ensure_zip_has_matchid_dem(output_zip_path, match_id)
			cleanup_file(source_path)
			result["skipped"] = 1
			result["status"] = "already_sorted"
			return result

		if source_path.name.lower().endswith(".bz2"):
			temp_dem = match_output_dir / f"{match_id}.dem.part"
			materialize_dem_file(source_path, temp_dem)
			try:
				compress_to_zip(temp_dem, output_zip_path, arcname=expected_member)
			finally:
				if not KEEP_INTERMEDIATE_FILES:
					cleanup_file(temp_dem)
		else:
			compress_to_zip(source_path, output_zip_path, arcname=expected_member)

		if not zip_contains_member(output_zip_path, expected_member):
			result["errors"] = 1
			result["status"] = "zip_verify_error"
			result["error"] = f"ZIP missing expected member: {expected_member}"
			return result

		cleanup_file(source_path)
		result["sorted"] = 1
		if result["status"] == "ok":
			result["status"] = "sorted"
		log("sort", f"Sorted file into {output_zip_path}")
		return result
	except Exception as e:
		result["errors"] = 1
		result["status"] = "sort_error"
		result["error"] = str(e)
		log("sort", f"Failed to sort {source_path}: {e}")
		return result


def sort_unsorted_upload_files() -> None:
	log("run", f"Starting unsorted file sort from {UNSORTED_INPUT_DIR}")
	if not UNSORTED_INPUT_DIR.exists() or not UNSORTED_INPUT_DIR.is_dir():
		log("run", f"Unsorted input directory not found: {UNSORTED_INPUT_DIR}")
		return

	match_lookup = load_match_metadata_index()
	if not match_lookup:
		log("run", "No match metadata available; cannot sort unsorted files")
		return

	source_files = sorted(
		[path for path in UNSORTED_INPUT_DIR.rglob("*") if path.is_file()],
		key=lambda p: p.name,
	)
	if not source_files:
		log("run", f"No files found in {UNSORTED_INPUT_DIR}")
		return

	log("run", f"Found {len(source_files)} files to sort")
	log("run", f"Using {SORT_WORKERS} worker threads")

	sorted_count = 0
	skipped_count = 0
	error_count = 0

	with ThreadPoolExecutor(max_workers=SORT_WORKERS) as executor:
		future_to_path = {
			executor.submit(sort_unsorted_file, path, match_lookup): path
			for path in source_files
		}
		completed = 0
		for future in as_completed(future_to_path):
			path = future_to_path[future]
			try:
				result = future.result()
			except Exception as e:
				error_count += 1
				completed += 1
				log("run", f"[{completed}/{len(source_files)}] {path.name}: worker_error ({e})")
				continue

			sorted_count += int(result["sorted"])
			skipped_count += int(result["skipped"])
			error_count += int(result["errors"])
			completed += 1
			status = str(result["status"])
			log_progress_status(
				"run",
				completed,
				len(source_files),
				path.name,
				status,
				result["error"],
			)

	log("run", "Unsorted file sort complete")
	log("run", f"Sorted: {sorted_count}")
	log("run", f"Skipped: {skipped_count}")
	log("run", f"Errors: {error_count}")
	log("run", f"Source folder: {UNSORTED_INPUT_DIR}")
	log("run", f"Output root: {OUTPUT_ROOT}")


def download_and_compress_replays() -> None:
	log("run", f"Starting download/compress workflow using SQLite: {DB_FILE}")
	payload = load_replay_links_payload()
	items = payload.get("items", []) if isinstance(payload, dict) else []

	links = [row for row in items if isinstance(row, dict) and row.get("demo_url")]
	if not links:
		log("run", "No demo URLs available in SQLite")
		log("run", "Run fetch option first or verify match IDs")
		return

	DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
	ZIPS_DIR.mkdir(parents=True, exist_ok=True)
	download_state = load_download_states()

	downloaded = 0
	skipped_download = 0
	zipped = 0
	zip_errors = 0
	download_errors = 0
	already_local = 0
	results: list[dict[str, Any]] = []
	links_to_process: list[dict[str, Any]] = []
	state_skipped = 0
	expired_skipped = 0
	expired_now = 0
	retry_deferred = 0

	for row in links:
		match_id = int(row["match_id"])
		state_entry = download_state.get(match_id)
		if state_entry and should_skip_download_from_state(row, state_entry):
			status = str(state_entry.get("status") or "state_skipped")
			if status in {"download_error", "extract_error", "zip_error", "zip_verify_error", "organize_error", "worker_error"}:
				retry_deferred += 1
				result_status = "retry_deferred"
				log("run", f"Match {match_id} retry deferred from download state: status={status} error={state_entry.get('error')}")
			elif status == "demo_expired":
				expired_skipped += 1
				result_status = "expired_skipped"
			else:
				state_skipped += 1
				result_status = "state_skipped"

			results.append({
				"match_id": match_id,
				"downloaded": 0,
				"skipped_download": 1,
				"already_local": 1 if result_status == "state_skipped" else 0,
				"zipped": 0,
				"download_errors": 0,
				"zip_errors": 0,
				"status": result_status,
				"error": None,
			})
			continue

		links_to_process.append(row)

	log("run", f"Processing {len(links)} replay URLs")
	log("run", f"State-skipped completed matches: {state_skipped}")
	log("run", f"Retry deferred matches: {retry_deferred}")
	log("run", f"Expired replays skipped (recheck every {EXPIRED_RECHECK_HOURS}h): {expired_skipped}")
	log("run", f"Need processing now: {len(links_to_process)}")
	log("run", f"Using {DOWNLOAD_WORKERS} worker threads")

	try:
		_run_download_pool(links_to_process, download_state, results)
	finally:
		# Persist progress even if the pool is interrupted so finished work is not redone.
		try:
			save_download_states(download_state)
		except Exception as e:
			log("run", f"WARNING: failed to save download state: {e}")

	for r in results:
		status = str(r.get("status"))
		downloaded += int(r.get("downloaded", 0))
		skipped_download += int(r.get("skipped_download", 0))
		already_local += int(r.get("already_local", 0))
		zipped += int(r.get("zipped", 0))
		download_errors += int(r.get("download_errors", 0))
		zip_errors += int(r.get("zip_errors", 0))
		if status == "demo_expired":
			expired_now += 1
	# Skipped (state-based) results were already counted separately above.
	skipped_download -= state_skipped + retry_deferred + expired_skipped
	already_local -= state_skipped

	failed_rows = [r for r in results if r.get("status") in {"download_error", "extract_error", "zip_error", "zip_verify_error", "organize_error", "worker_error"}]
	for r in failed_rows[:50]:
		log("run", f"FAILED match {r['match_id']}: {r['status']} ({r.get('error')})")
	if len(failed_rows) > 50:
		log("run", f"... and {len(failed_rows) - 50} more failures (see stats report)")

	log("run", "Download and compress complete")
	log("run", f"Downloaded: {downloaded}")
	log("run", f"Skipped download: {skipped_download + state_skipped + retry_deferred}")
	log("run", f"State-skipped completed: {state_skipped}")
	log("run", f"Retry deferred: {retry_deferred}")
	log("run", f"Expired replays (no longer on server): {expired_now + expired_skipped} ({expired_now} newly detected)")
	log("run", f"Already local (fully organized): {already_local + state_skipped}")
	log("run", f"ZIP created: {zipped}")
	log("run", f"Download errors: {download_errors}")
	log("run", f"ZIP errors: {zip_errors}")
	log("run", f"Keep intermediate cache: {KEEP_INTERMEDIATE_FILES}")
	log("run", f"Organized output root: {OUTPUT_ROOT}")
	log("run", f"DEM folder: {DOWNLOADS_DIR}")
	log("run", f"ZIP folder: {ZIPS_DIR}")

	try:
		verification = verify_public_storage(OUTPUT_ROOT, verbose=False)
	except Exception as e:
		log("verify", f"WARNING: verification failed, continuing: {e}")
		verification = {"removed_dem_files": 0, "zip_files": 0, "normalized_zip_members": 0}
	log("run", "Public storage verification summary")
	log("run", f"ZIP files present: {verification['zip_files']}")
	log("run", f"Normalized ZIP internal members: {verification['normalized_zip_members']}")
	log("run", f"Removed public DEM files: {verification['removed_dem_files']}")

	try:
		write_stats_report(STATS_FILE, payload, results, verification)
	except Exception as e:
		log("run", f"WARNING: failed to write stats report: {e}")


def _run_download_pool(
	links_to_process: list[dict[str, Any]],
	download_state: dict[int, dict[str, Any]],
	results: list[dict[str, Any]],
) -> None:
	with ThreadPoolExecutor(max_workers=DOWNLOAD_WORKERS) as executor:
		future_to_row = {
			executor.submit(process_replay_row, row): row
			for row in links_to_process
		}

		completed = 0
		for future in as_completed(future_to_row):
			row = future_to_row[future]
			match_id = int(row["match_id"])
			try:
				result = future.result()
			except Exception as e:
				result = {
					"match_id": match_id,
					"downloaded": 0,
					"skipped_download": 0,
					"already_local": 0,
					"zipped": 0,
					"download_errors": 1,
					"zip_errors": 0,
					"status": "worker_error",
					"error": str(e),
				}

			now_ts = now_iso()
			if result["status"] in {"ok", "already_local", "already_local_member_normalized"}:
				download_state[match_id] = {
					"match_id": match_id,
					"demo_url": row.get("demo_url"),
					"status": result["status"],
					"output_zip_path": str(row_output_zip_path(row)),
					"last_attempt_at": now_ts,
				}
			else:
				download_state[match_id] = {
					"match_id": match_id,
					"demo_url": row.get("demo_url"),
					"status": result["status"],
					"error": result.get("error"),
					"last_attempt_at": now_ts,
				}

			completed += 1
			status = str(result["status"])
			# Expired replays are expected; keep them to periodic progress lines only.
			log_progress_status(
				"run",
				completed,
				len(links_to_process),
				f"Match {match_id}",
				status,
				None if status == "demo_expired" else result["error"],
			)

			results.append(result)


def run_public_verification() -> None:
	log("verify", "Starting public storage verification from menu option")
	verification = verify_public_storage(OUTPUT_ROOT, verbose=True)
	log("verify", "Public storage verification summary")
	log("verify", f"ZIP files present: {verification['zip_files']}")
	log("verify", f"Normalized ZIP internal members: {verification['normalized_zip_members']}")
	log("verify", f"Removed public DEM files: {verification['removed_dem_files']}")


def print_menu() -> None:
	print("\n=== Deadlock Replay Tool ===")
	print("1) Fetch and store matches tree locally")
	print("2) Fetch all match replay links")
	print("3) Download and compress match replays")
	print("4) Fetch matches + links, then download and compress")
	print("5) Sort unsorted upload files")
	print("6) Verify public storage (ZIP-only)")
	print("7) Exit")


def run_option(choice: str) -> None:
	choice = str(choice).strip()
	log("menu", f"Running option: {choice}")
	log("config", f"MATCHES_TREE_URL={MATCHES_TREE_URL}")
	log("config", f"MATCHES_TREE_FALLBACK_URL={MATCHES_TREE_FALLBACK_URL}")
	log("config", f"OUTPUT_ROOT={OUTPUT_ROOT}")
	log("config", f"FORCE_REFRESH_LOOKUPS={FORCE_REFRESH_LOOKUPS}")
	log("config", f"FORCE_REPROCESS_DOWNLOADS={FORCE_REPROCESS_DOWNLOADS}")

	if choice == "1":
		fetch_and_store_matches_tree()
	elif choice == "2":
		fetch_all_match_replay_links()
	elif choice == "3":
		download_and_compress_replays()
	elif choice == "4":
		# fetch_all_match_replay_links refreshes/stores the match tree itself.
		# Do not fetch it twice before downloading.
		t0 = time.monotonic()
		try:
			fetch_all_match_replay_links()
		except Exception as e:
			# Downloads can still proceed from replay URLs already stored in SQLite.
			log("menu", f"WARNING: link fetch failed ({type(e).__name__}: {e}); continuing with stored links")
		t1 = time.monotonic()
		download_and_compress_replays()
		t2 = time.monotonic()
		log("timing", f"Link fetch {t1 - t0:.0f}s, download/compress {t2 - t1:.0f}s, total {t2 - t0:.0f}s")
	elif choice == "5":
		sort_unsorted_upload_files()
	elif choice == "6":
		run_public_verification()
	elif choice == "7":
		print("Bye")
	else:
		raise ValueError("Invalid option. Enter 1, 2, 3, 4, 5, 6, or 7.")


def run_menu() -> None:
	while True:
		print_menu()
		choice = input("Choose an option: ").strip()

		try:
			run_option(choice)
		except ValueError as e:
			print(e)
			continue

		if choice == "7":
			return


def parse_args(argv: list[str]) -> object:
	import argparse

	parser = argparse.ArgumentParser(description="Deadlock Replay Tool")
	parser.add_argument(
		"legacy_option",
		nargs="?",
		choices=["1", "2", "3", "4", "5", "6", "7"],
		help="Optional menu option to run non-interactively, e.g. 4",
	)
	parser.add_argument(
		"-o",
		"--option",
		choices=["1", "2", "3", "4", "5", "6", "7"],
		help="Run one menu option non-interactively, e.g. --option 4",
	)
	parser.add_argument(
		"--auto",
		action="store_true",
		help="Alias for --option 4",
	)
	parser.add_argument(
		"--matches-url",
		help="Primary match-tree URL. Default is the local website endpoint.",
	)
	parser.add_argument(
		"--fallback-matches-url",
		help="Fallback match-tree URL if the primary URL fails.",
	)
	parser.add_argument(
		"--output-root",
		help="Replay storage output root.",
	)
	parser.add_argument(
		"--unsorted-input-dir",
		help="Folder used by option 5 for unsorted uploads.",
	)
	parser.add_argument(
		"--force-refresh-lookups",
		action="store_true",
		help="Ignore the SQLite lookup cache and re-check demo URLs from the API.",
	)
	parser.add_argument(
		"--force-reprocess-downloads",
		action="store_true",
		help="Ignore the SQLite download state and re-process downloads/zips.",
	)
	parser.add_argument(
		"--repair",
		action="store_true",
		help="Convenience flag: force refresh lookups and force reprocess downloads.",
	)
	parser.add_argument(
		"--keep-intermediate-files",
		action="store_true",
		help="Keep downloaded .dem/.bz2 and temporary zip cache files.",
	)
	parser.add_argument(
		"--no-reset-log",
		action="store_true",
		help="Append to the existing log instead of clearing it first.",
	)

	return parser.parse_args(argv)


def apply_runtime_args(args: object) -> None:
	global MATCHES_TREE_URL
	global MATCHES_TREE_FALLBACK_URL
	global OUTPUT_ROOT
	global UNSORTED_INPUT_DIR
	global FORCE_REFRESH_LOOKUPS
	global FORCE_REPROCESS_DOWNLOADS
	global KEEP_INTERMEDIATE_FILES

	if getattr(args, "matches_url", None):
		MATCHES_TREE_URL = str(args.matches_url)

	if getattr(args, "fallback_matches_url", None):
		MATCHES_TREE_FALLBACK_URL = str(args.fallback_matches_url)

	if getattr(args, "output_root", None):
		OUTPUT_ROOT = Path(str(args.output_root))

	if getattr(args, "unsorted_input_dir", None):
		UNSORTED_INPUT_DIR = Path(str(args.unsorted_input_dir))

	if getattr(args, "repair", False):
		FORCE_REFRESH_LOOKUPS = True
		FORCE_REPROCESS_DOWNLOADS = True

	if getattr(args, "force_refresh_lookups", False):
		FORCE_REFRESH_LOOKUPS = True

	if getattr(args, "force_reprocess_downloads", False):
		FORCE_REPROCESS_DOWNLOADS = True

	if getattr(args, "keep_intermediate_files", False):
		KEEP_INTERMEDIATE_FILES = True


def resolve_option(args: object) -> str | None:
	if getattr(args, "auto", False):
		return "4"

	if getattr(args, "option", None):
		return str(args.option)

	if getattr(args, "legacy_option", None):
		return str(args.legacy_option)

	# If systemd or another automation runs this without a TTY, do not crash on input().
	# Default to option 4 because this file is primarily used as the automated replay workflow.
	if not sys.stdin.isatty():
		log("menu", "No interactive stdin detected; defaulting to option 4")
		return "4"

	return None


def main(argv: list[str] | None = None) -> None:
	args = parse_args(sys.argv[1:] if argv is None else argv)
	apply_runtime_args(args)

	if not getattr(args, "no_reset_log", False):
		reset_log_file()

	initialize_database()

	choice = resolve_option(args)
	if choice:
		run_option(choice)
		return

	run_menu()


if __name__ == "__main__":
	try:
		main()
	except KeyboardInterrupt:
		print("\nInterrupted")
		sys.exit(130)
