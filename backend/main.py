from __future__ import annotations

import os
import argparse
import asyncio
import json
import time
import requests
import random
import sqlite3

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import asqlite

from dotenv import load_dotenv


# ----------------- Config -----------------

# Load environment variables from a .env file if present
load_dotenv()

DEFAULT_DATA_DIR = Path.cwd() / "data"
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "dlns.sqlite3"
DEFAULT_CACHE_PATH = DEFAULT_DATA_DIR / "user_cache.json"
DEFAULT_STATUS_PATH = DEFAULT_DATA_DIR / "matches_status.json"
DEFAULT_HERO_CACHE_PATH = DEFAULT_DATA_DIR / "hero_names.json"
DEFAULT_MATCH_CONCURRENCY = 4
DEFAULT_MAX_RETRY_WAIT_S = 20.0

# Deadlock + Steam APIs
MATCH_METADATA_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/metadata"
HERO_DETAILS_URL = (
    "https://assets.deadlock-api.com/v2/heroes/{hero_id}?language=english&client_version=6181"
)
STEAM_GET_SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"

# Steam API key must be provided via environment (or .env). No hardcoded default.
STEAM_API_KEY = os.getenv("STEAM_API_KEY", "")


# ----------------- Utilities -----------------

class SkipMatchSilent(Exception):
	"""Internal signal to silently skip processing a match (e.g., API 500).

	This should be caught by the outer loop and result in no logs, no status updates.
	"""
	pass

def ensure_dirs(*paths: Path) -> None:
	for p in paths:
		p.mkdir(parents=True, exist_ok=True)


def load_json(path: Path, default: Any) -> Any:
	if not path.exists():
		return default
	try:
		# Accept UTF-8 files with or without BOM.
		with path.open("r", encoding="utf-8-sig") as f:
			return json.load(f)
	except Exception:
		return default


def save_json(path: Path, data: Any) -> None:
	path.parent.mkdir(parents=True, exist_ok=True)
	tmp = path.with_suffix(path.suffix + ".tmp")
	with tmp.open("w", encoding="utf-8") as f:
		json.dump(data, f, indent=2, ensure_ascii=False)
	tmp.replace(path)


def now_iso() -> str:
	return datetime.now(timezone.utc).isoformat()


def parse_time_to_iso(value: Any) -> Optional[str]:
	"""Parse various time formats to ISO-8601 UTC string.

	Accepts:
	- int/float epoch seconds
	- ISO strings (with optional trailing 'Z')
	Returns ISO string or None if parsing fails.
	"""
	if value is None:
		return None
	try:
		# epoch seconds
		if isinstance(value, (int, float)):
			return datetime.fromtimestamp(float(value), tz=timezone.utc).isoformat()
		s = str(value).strip()
		if not s:
			return None
		# numeric string
		if s.isdigit():
			return datetime.fromtimestamp(float(s), tz=timezone.utc).isoformat()
		# ISO format; support trailing Z
		if s.endswith('Z'):
			s = s[:-1] + '+00:00'
		try:
			return datetime.fromisoformat(s).astimezone(timezone.utc).isoformat()
		except Exception:
			return None
	except Exception:
		return None


def parse_bool(val: Optional[str]) -> bool:
	if val is None:
		return False
	v = str(val).strip().lower()
	return v in {"1", "true", "yes", "y"}


def to_steamid64(account_id: int) -> str:
	return str(int(account_id) + 76561197960265728)


def chunked(items: List[Any], size: int = 100) -> Iterable[List[Any]]:
	for i in range(0, len(items), size):
		yield items[i : i + size]


def team_from_slot(player_slot: Optional[int]) -> Optional[int]:
	if player_slot is None:
		return None
	try:
		ps = int(player_slot)
		if 1 <= ps <= 6:
			return 0
		if 7 <= ps <= 12:
			return 1
	except Exception:
		pass
	return None


def last_stats(stats: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
	if not stats:
		return {}
	return stats[-1] if isinstance(stats, list) else {}


def safe_get_stat(player: Dict[str, Any], key: str) -> Any:
	# Prefer top-level stat, then fallback to last snapshot in stats array.
	if key in player:
		return player.get(key)
	return last_stats(player.get("stats")).get(key)


def extract_int(value: Any) -> Optional[int]:
	try:
		if value is None:
			return None
		return int(value)
	except Exception:
		return None


def extract_float(value: Any) -> Optional[float]:
	try:
		if value is None:
			return None
		return float(value)
	except Exception:
		return None


# ----------------- External fetchers -----------------

def fetch_match_metadata(match_id: int) -> Dict[str, Any]:
	url = MATCH_METADATA_URL.format(match_id=match_id)
	# Retry rate-limit/network issues, but do not retry server 5xx for this endpoint.
	r = http_get_with_retries(
		url,
		timeout=30,
		max_retries=6,
		retry_server_errors=False,
		max_retry_wait_s=DEFAULT_MAX_RETRY_WAIT_S,
	)
	if r.status_code == 500:
		# Pretend this match doesn't exist: no logging, no status updates
		raise SkipMatchSilent()
	r.raise_for_status()
	data = r.json()
	if not isinstance(data, dict) or "match_info" not in data:
		raise ValueError("Unexpected response shape from match metadata API")
	return data["match_info"]


def fetch_player_summaries(steam_api_key: str, steam_ids64: List[str]) -> Dict[str, Dict[str, str]]:
	if not steam_ids64:
		return {}
	params = {"key": steam_api_key, "steamids": ",".join(steam_ids64)}
	r = http_get_with_retries(STEAM_GET_SUMMARIES_URL, params=params, timeout=30)
	r.raise_for_status()
	data = r.json() or {}
	players = ((data.get("response") or {}).get("players") or [])
	result: Dict[str, Dict[str, str]] = {}
	for p in players:
		sid = p.get("steamid")
		persona = p.get("personaname") or p.get("realname")
		if sid and persona:
			result[str(sid)] = {
				"persona_name": str(persona),
				"avatar_url": str(p.get("avatarfull") or ""),
			}
	return result


def http_get_with_retries(
	url: str,
	params: Optional[Dict[str, Any]] = None,
	timeout: int = 30,
	max_retries: Optional[int] = None,
	backoff: float = 1.0,
	max_backoff: float = 60.0,
	retry_server_errors: bool = True,
	max_retry_wait_s: Optional[float] = None,
) -> requests.Response:
	"""Perform GET with retries on 429/5xx and request exceptions.

	- Honors Retry-After header when present on 429.
	- Exponential backoff with jitter.
	- If max_retries is None, retries indefinitely on retryable statuses/errors.
	"""
	attempt = 0
	while True:
		try:
			resp = requests.get(url, params=params, timeout=timeout)
			# If rate limited, sleep per Retry-After or backoff.
			if resp.status_code == 429:
				retry_after = resp.headers.get("Retry-After")
				try:
					wait_s = float(retry_after) if retry_after is not None else None
				except ValueError:
					wait_s = None
				if wait_s is None:
					wait_s = min(backoff * (2 ** attempt), max_backoff)
					# add small jitter +/- 20%
					wait_s = wait_s * random.uniform(0.8, 1.2)
				if max_retry_wait_s is not None:
					wait_s = min(wait_s, float(max_retry_wait_s))
				# If finite retries and we've exhausted, return response
				if max_retries is not None and attempt >= max_retries - 1:
					return resp
				print(f"[rate-limit] 429 received. Retrying in {wait_s:.1f}s...")
				time.sleep(wait_s)
				attempt += 1
				continue

			# Retry on transient 5xx when enabled.
			if retry_server_errors and 500 <= resp.status_code < 600:
				if max_retries is not None and attempt >= max_retries - 1:
					return resp
				wait_s = min(backoff * (2 ** attempt), max_backoff)
				wait_s = wait_s * random.uniform(0.8, 1.2)
				print(f"[retry] {resp.status_code} from {url}. Retrying in {wait_s:.1f}s...")
				time.sleep(wait_s)
				attempt += 1
				continue

			return resp
		except requests.RequestException as e:
			if max_retries is not None and attempt >= max_retries - 1:
				raise
			wait_s = min(backoff * (2 ** attempt), max_backoff)
			wait_s = wait_s * random.uniform(0.8, 1.2)
			print(f"[retry] Request error: {e}. Retrying in {wait_s:.1f}s...")
			time.sleep(wait_s)
			attempt += 1
			continue


def resolve_names_with_cache(
	account_ids: List[int],
	cache: Dict[str, str],
	steam_api_key: str,
	avatar_cache: Optional[Dict[str, str]] = None,
) -> Dict[int, str]:
	# cache maps account_id (as string) -> persona
	to_lookup: List[int] = []
	for aid in account_ids:
		if aid is None:
			continue
		s = str(int(aid))
		if s not in cache or not cache[s]:
			to_lookup.append(int(aid))

	resolved: Dict[int, str] = {}
	if to_lookup:
		steam_ids64 = [to_steamid64(a) for a in to_lookup]
		data_by_sid: Dict[str, Dict[str, str]] = {}
		for chunk in chunked(steam_ids64, 100):
			data_by_sid.update(fetch_player_summaries(steam_api_key, chunk))
		for a in to_lookup:
			sid64 = to_steamid64(a)
			entry = data_by_sid.get(sid64) or {}
			persona = entry.get("persona_name") or "Unknown"
			cache[str(a)] = persona
			resolved[a] = persona
			if avatar_cache is not None:
				avatar_url = entry.get("avatar_url") or ""
				if avatar_url:
					avatar_cache[str(a)] = avatar_url

	# fill any already-cached values
	for aid in account_ids:
		if aid is None:
			continue
		s = str(int(aid))
		if s in cache and cache[s]:
			resolved[int(aid)] = cache[s]
	return resolved


def refetch_all_cached_users(
	cache: Dict[str, str],
	steam_api_key: str,
	avatar_cache: Optional[Dict[str, str]] = None,
) -> Dict[str, str]:
	ids = [int(k) for k in cache.keys() if k.isdigit()]
	steam_ids64 = [to_steamid64(a) for a in ids]
	new_data: Dict[str, Dict[str, str]] = {}
	for chunk in chunked(steam_ids64, 100):
		new_data.update(fetch_player_summaries(steam_api_key, chunk))
	# update cache in place
	for aid in ids:
		sid64 = to_steamid64(aid)
		entry = new_data.get(sid64) or {}
		persona = entry.get("persona_name")
		if persona:
			cache[str(aid)] = persona
		if avatar_cache is not None:
			avatar_url = entry.get("avatar_url") or ""
			if avatar_url:
				avatar_cache[str(aid)] = avatar_url
	return cache


# ----------------- DB Layer (SQLite) -----------------

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  account_id INTEGER PRIMARY KEY,
  persona_name TEXT,
  avatar_url TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  match_id INTEGER PRIMARY KEY,
  duration_s INTEGER,
  winning_team INTEGER,
  match_outcome INTEGER,
  game_mode INTEGER,
  match_mode INTEGER,
	event_title TEXT,
	event_week INTEGER,
	event_team_a TEXT,
	event_team_b TEXT,
	event_game TEXT,
	event_team_a_ingame_side INTEGER,
	match_vod TEXT,
	event_region TEXT,
	start_time TEXT,
  created_at TEXT
);

CREATE TABLE IF NOT EXISTS players (
  match_id INTEGER NOT NULL,
  account_id INTEGER,
  player_slot INTEGER,
  team INTEGER,
  hero_id INTEGER,
  level INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  net_worth INTEGER,
  last_hits INTEGER,
  denies INTEGER,
  creep_kills INTEGER,
  shots_hit INTEGER,
  shots_missed INTEGER,
  player_damage INTEGER,
  obj_damage INTEGER,
  player_healing INTEGER,
  pings_count INTEGER,
  result TEXT,
  items TEXT,
  item_build TEXT,
  ability_order TEXT,
  raw_items_json TEXT,
  PRIMARY KEY (match_id, account_id),
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE,
  FOREIGN KEY (account_id) REFERENCES users(account_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_players_match ON players(match_id);
CREATE INDEX IF NOT EXISTS idx_players_account ON players(account_id);

CREATE TABLE IF NOT EXISTS user_stats (
	account_id INTEGER PRIMARY KEY,
	matches_played INTEGER,
	wins INTEGER,
	losses INTEGER,
	kills INTEGER,
	deaths INTEGER,
	assists INTEGER,
	last_hits INTEGER,
	denies INTEGER,
	creep_kills INTEGER,
	shots_hit INTEGER,
	shots_missed INTEGER,
	player_damage INTEGER,
	obj_damage INTEGER,
	player_healing INTEGER,
	pings_count INTEGER,
	avg_kda REAL,
	winrate REAL,
	updated_at TEXT,
	FOREIGN KEY (account_id) REFERENCES users(account_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS player_snapshots (
  match_id INTEGER NOT NULL,
  account_id INTEGER,
  snapshot_index INTEGER NOT NULL,
  net_worth INTEGER,
  kills INTEGER,
  deaths INTEGER,
  assists INTEGER,
  player_damage INTEGER,
  player_healing INTEGER,
  time_stamp_s INTEGER,
  PRIMARY KEY (match_id, account_id, snapshot_index),
  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_match ON player_snapshots(match_id);
"""


def db_connect(db_path: Path) -> sqlite3.Connection:
	# Writer/normal connection with reasonable lock wait
	conn = sqlite3.connect(db_path, timeout=15)
	conn.execute("PRAGMA foreign_keys=ON;")
	conn.execute("PRAGMA busy_timeout=5000;")
	return conn


def db_connect_readonly(db_path: Path) -> sqlite3.Connection:
	"""Open a read-only connection suitable for website usage while writer runs.

	Uses SQLite URI with mode=ro and shared cache. Will not acquire write locks.
	"""
	uri = f"file:{db_path.as_posix()}?mode=ro&cache=shared"
	conn = sqlite3.connect(uri, uri=True, timeout=15)
	conn.execute("PRAGMA foreign_keys=ON;")
	conn.execute("PRAGMA busy_timeout=5000;")
	return conn


def db_init(conn: sqlite3.Connection) -> bool:
	"""Initialize DB schema and run migrations.

	Returns True when a migration added columns that require broad backfill.
	"""
	conn.executescript(SCHEMA_SQL)
	large_table_change = False

	# Migrations: ensure new columns exist on old DBs
	try:
		cur = conn.execute("PRAGMA table_info(matches)")
		cols = {r[1] for r in cur.fetchall()}
		if "start_time" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN start_time TEXT")
			large_table_change = True
		if "event_title" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_title TEXT")
			large_table_change = True
		if "event_week" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_week INTEGER")
			large_table_change = True
		if "event_team_a" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_team_a TEXT")
			large_table_change = True
		if "event_team_b" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_team_b TEXT")
			large_table_change = True
		if "event_game" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_game TEXT")
			large_table_change = True
		if "event_team_a_ingame_side" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_team_a_ingame_side INTEGER")
			large_table_change = True
		if "match_vod" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN match_vod TEXT")
			large_table_change = True
		if "event_region" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN event_region TEXT")
			large_table_change = True
		conn.commit()
	except Exception:
		pass
	try:
		cur = conn.execute("PRAGMA table_info(users)")
		cols = {r[1] for r in cur.fetchall()}
		if "avatar_url" not in cols:
			conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")
		conn.commit()
	except Exception:
		pass
	try:
		cur = conn.execute("PRAGMA table_info(players)")
		cols = {r[1] for r in cur.fetchall()}
		if "items" not in cols:
			conn.execute("ALTER TABLE players ADD COLUMN items TEXT")
		if "item_build" not in cols:
			conn.execute("ALTER TABLE players ADD COLUMN item_build TEXT")
		if "ability_order" not in cols:
			conn.execute("ALTER TABLE players ADD COLUMN ability_order TEXT")
		if "raw_items_json" not in cols:
			conn.execute("ALTER TABLE players ADD COLUMN raw_items_json TEXT")
		conn.commit()
	except Exception:
		pass
	try:
		conn.execute("""
			CREATE TABLE IF NOT EXISTS player_snapshots (
			  match_id INTEGER NOT NULL,
			  account_id INTEGER,
			  snapshot_index INTEGER NOT NULL,
			  net_worth INTEGER,
			  kills INTEGER,
			  deaths INTEGER,
			  assists INTEGER,
			  player_damage INTEGER,
			  player_healing INTEGER,
			  time_stamp_s INTEGER,
			  PRIMARY KEY (match_id, account_id, snapshot_index),
			  FOREIGN KEY (match_id) REFERENCES matches(match_id) ON DELETE CASCADE
			)
		""")
		conn.execute("CREATE INDEX IF NOT EXISTS idx_snapshots_match ON player_snapshots(match_id)")
		conn.commit()
	except Exception:
		pass
	try:
		cur = conn.execute("PRAGMA table_info(player_snapshots)")
		snap_cols = {r[1] for r in cur.fetchall()}
		if "time_stamp_s" not in snap_cols:
			conn.execute("ALTER TABLE player_snapshots ADD COLUMN time_stamp_s INTEGER")
			conn.commit()
	except Exception:
		pass
	conn.commit()
	return large_table_change


def upsert_player_snapshots(conn: sqlite3.Connection, match_id: int, account_id: Optional[int], stats: Any) -> None:
	"""Store per-snapshot stats for a player. Skips if no stats array or account_id missing."""
	if account_id is None or not isinstance(stats, list) or not stats:
		return
	# Delete existing snapshots for this player/match before re-inserting (re-ingest safe)
	conn.execute(
		"DELETE FROM player_snapshots WHERE match_id=? AND account_id=?",
		(match_id, account_id),
	)
	for idx, snap in enumerate(stats):
		if not isinstance(snap, dict):
			continue
		conn.execute(
			"INSERT OR IGNORE INTO player_snapshots"
			"(match_id, account_id, snapshot_index, net_worth, kills, deaths, assists, player_damage, player_healing, time_stamp_s) "
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			(
				match_id,
				account_id,
				idx,
				extract_int(snap.get("net_worth")),
				extract_int(snap.get("kills")),
				extract_int(snap.get("deaths")),
				extract_int(snap.get("assists")),
				extract_int(snap.get("player_damage")),
				extract_int(snap.get("player_healing")),
				extract_int(snap.get("time_stamp_s")),
			),
		)


async def upsert_player_snapshots_async(conn: Any, match_id: int, account_id: Optional[int], stats: Any) -> None:
	"""Async version of upsert_player_snapshots."""
	if account_id is None or not isinstance(stats, list) or not stats:
		return
	await conn.execute(
		"DELETE FROM player_snapshots WHERE match_id=? AND account_id=?",
		(match_id, account_id),
	)
	for idx, snap in enumerate(stats):
		if not isinstance(snap, dict):
			continue
		await conn.execute(
			"INSERT OR IGNORE INTO player_snapshots"
			"(match_id, account_id, snapshot_index, net_worth, kills, deaths, assists, player_damage, player_healing, time_stamp_s) "
			"VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
			(
				match_id,
				account_id,
				idx,
				extract_int(snap.get("net_worth")),
				extract_int(snap.get("kills")),
				extract_int(snap.get("deaths")),
				extract_int(snap.get("assists")),
				extract_int(snap.get("player_damage")),
				extract_int(snap.get("player_healing")),
				extract_int(snap.get("time_stamp_s")),
			),
		)


def upsert_user(conn: sqlite3.Connection, account_id: int, persona_name: Optional[str], avatar_url: Optional[str] = None) -> None:
	conn.execute(
		"INSERT INTO users(account_id, persona_name, avatar_url, updated_at) VALUES(?, ?, ?, ?) "
		"ON CONFLICT(account_id) DO UPDATE SET persona_name=excluded.persona_name, "
		"avatar_url=COALESCE(excluded.avatar_url, avatar_url), updated_at=excluded.updated_at",
		(account_id, persona_name or "Unknown", avatar_url or None, now_iso()),
	)


def upsert_match(
	conn: sqlite3.Connection,
	mi: Dict[str, Any],
	event_title: Optional[str] = None,
	event_week: Optional[int] = None,
	event_team_a: Optional[str] = None,
	event_team_b: Optional[str] = None,
	event_game: Optional[str] = None,
	event_team_a_ingame_side: Optional[int] = None,
	match_vod: Optional[str] = None,
	event_region: Optional[str] = None,
) -> None:
	# Normalize team names to title case so casing variants are treated as the same team
	event_team_a = event_team_a.strip().title() if event_team_a else None
	event_team_b = event_team_b.strip().title() if event_team_b else None
	# Try to locate a start time from API payload with several fallback keys
	st = (
		mi.get("start_time")
		or mi.get("started_at")
		or mi.get("start")
		or mi.get("startTime")
		or mi.get("match_start_time")
	)
	start_iso = parse_time_to_iso(st) or now_iso()
	conn.execute(
		"INSERT INTO matches(match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, match_vod, event_region, start_time, created_at) "
		"VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
		"ON CONFLICT(match_id) DO UPDATE SET duration_s=excluded.duration_s, winning_team=excluded.winning_team, match_outcome=excluded.match_outcome, game_mode=excluded.game_mode, match_mode=excluded.match_mode, event_title=excluded.event_title, event_week=excluded.event_week, event_team_a=excluded.event_team_a, event_team_b=excluded.event_team_b, event_game=excluded.event_game, event_team_a_ingame_side=excluded.event_team_a_ingame_side, match_vod=excluded.match_vod, event_region=excluded.event_region, start_time=excluded.start_time",
		(
			mi.get("match_id"),
			extract_int(mi.get("duration_s")),
			extract_int(mi.get("winning_team")),
			extract_int(mi.get("match_outcome")),
			extract_int(mi.get("game_mode")),
			extract_int(mi.get("match_mode")),
			event_title,
			event_week,
			event_team_a,
			event_team_b,
			event_game,
			event_team_a_ingame_side,
			match_vod or None,
			event_region or None,
			start_iso,
			now_iso(),  # scraped time
		),
	)


def upsert_player(conn: sqlite3.Connection, match_id: int, player: Dict[str, Any], winning_team: Optional[int], name_by_id: Dict[int, str]) -> None:
	account_id = extract_int(player.get("account_id"))
	player_slot = extract_int(player.get("player_slot"))
	team = team_from_slot(player_slot)
	hero_id = extract_int(player.get("hero_id"))
	level = extract_int(player.get("level")) or extract_int(safe_get_stat(player, "level"))

	kills = extract_int(safe_get_stat(player, "kills"))
	deaths = extract_int(safe_get_stat(player, "deaths"))
	assists = extract_int(safe_get_stat(player, "assists"))
	net_worth = extract_int(safe_get_stat(player, "net_worth"))
	last_hits = extract_int(safe_get_stat(player, "last_hits"))
	denies = extract_int(safe_get_stat(player, "denies"))

	# creep_kills: explicitly read from the last stats snapshot
	_last = last_stats(player.get("stats"))
	creep_kills = extract_int(_last.get("creep_kills"))
	# optional fallback to last_hits if snapshot is missing that field
	if creep_kills is None:
		creep_kills = last_hits

	# Optional damage/heal fields
	player_damage = extract_int(safe_get_stat(player, "player_damage"))
	obj_damage = extract_int(safe_get_stat(player, "boss_damage"))  # proxy for objective damage
	player_healing = extract_int(safe_get_stat(player, "player_healing"))
	self_healing = extract_int(safe_get_stat(player, "self_healing"))
	teammate_healing = extract_int(safe_get_stat(player, "teammate_healing"))

	# Shots hit/missed: attempt to derive from snapshots if present
	shots_hit, shots_missed = derive_shots(player)

	# Pings count: length of the pings array if present
	pings = player.get("pings") or []
	pings_count = len(pings) if isinstance(pings, list) else None

	# Result for this player
	result: Optional[str] = None
	if team is not None and winning_team is not None:
		result = "Win" if int(team) == int(winning_team) else "Loss"

	# Items: store only unsold items as JSON list of item_ids, deduplicated to avoid
	# upgrade components appearing multiple times (base components stay with sold_time_s=0
	# even after being consumed into an upgrade).
	# item_build stores [{item_id, game_time_s}, ...] sorted by purchase time.
	# ability_order stores [{ability_id, game_time_s, tier}, ...] sorted by game_time_s.
	raw_items = player.get("items") or []
	# Group all raw entries by item_id to detect abilities (appear more than once or have upgrade_id != 0)
	item_groups: Dict[Any, list] = {}
	for i in raw_items:
		if isinstance(i, dict) and i.get("item_id") is not None:
			iid = i["item_id"]
			if iid not in item_groups:
				item_groups[iid] = []
			item_groups[iid].append(i)
	seen_item_ids: set = set()
	unsold_item_ids = []
	build_items = []
	ability_events = []
	for iid, entries in item_groups.items():
		is_ability = len(entries) > 1 or any(e.get("upgrade_id", 0) != 0 for e in entries)
		if is_ability:
			for tier, entry in enumerate(sorted(entries, key=lambda x: x.get("game_time_s") or 0)):
				ability_events.append({"ability_id": iid, "game_time_s": entry.get("game_time_s"), "tier": tier})
		else:
			for entry in entries:
				if entry.get("sold_time_s", 0) == 0 and iid not in seen_item_ids:
					seen_item_ids.add(iid)
					unsold_item_ids.append(iid)
					build_items.append({"item_id": iid, "game_time_s": entry.get("game_time_s")})
	build_items.sort(key=lambda x: (x["game_time_s"] is None, x["game_time_s"] or 0))
	ability_events.sort(key=lambda x: (x["game_time_s"] is None, x["game_time_s"] or 0))
	items_json = json.dumps(unsold_item_ids) if unsold_item_ids else None
	item_build_json = json.dumps(build_items) if build_items else None
	ability_order_json = json.dumps(ability_events) if ability_events else None
	# Store the complete raw items list so the build endpoint can re-classify
	# using the item catalog (required because upgrade_id semantics changed in API).
	raw_items_json = json.dumps(raw_items) if raw_items else None
	if account_id is not None:
		upsert_user(conn, account_id, name_by_id.get(account_id, "Unknown"))

	conn.execute(
		(
			"INSERT INTO players(match_id, account_id, player_slot, team, hero_id, level, kills, deaths, assists, net_worth, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, self_healing, teammate_healing, pings_count, result, items, item_build, ability_order, raw_items_json) "
			"VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
			"ON CONFLICT(match_id, account_id) DO UPDATE SET "
			"player_slot=excluded.player_slot, team=excluded.team, hero_id=excluded.hero_id, level=excluded.level, "
			"kills=excluded.kills, deaths=excluded.deaths, assists=excluded.assists, net_worth=excluded.net_worth, "
			"last_hits=excluded.last_hits, denies=excluded.denies, creep_kills=excluded.creep_kills, "
			"shots_hit=excluded.shots_hit, shots_missed=excluded.shots_missed, player_damage=excluded.player_damage, "
			"obj_damage=excluded.obj_damage, player_healing=excluded.player_healing, self_healing=excluded.self_healing, teammate_healing=excluded.teammate_healing, pings_count=excluded.pings_count, result=excluded.result, items=excluded.items, item_build=excluded.item_build, ability_order=excluded.ability_order, raw_items_json=excluded.raw_items_json"
		),
		(
			match_id,
			account_id,
			player_slot,
			team,
			hero_id,
			level,
			kills,
			deaths,
			assists,
			net_worth,
			last_hits,
			denies,
			creep_kills,
			shots_hit,
			shots_missed,
			player_damage,
			obj_damage,
			player_healing,
			self_healing,
			teammate_healing,
			pings_count,
			result,
			items_json,
			item_build_json,
			ability_order_json,
			raw_items_json,
		),
	)
	upsert_player_snapshots(conn, match_id, account_id, player.get("stats"))



def derive_shots(player):
	"""Attempt to find and aggregate shots hit/missed across available data.

	We look for common keys in the player's last stats snapshot and across all snapshots if available.
	Returns (shots_hit, shots_missed) which may be None if unavailable.
	"""
	keys_hit = {"shots_hit", "hit_shots", "hits"}
	keys_miss = {"shots_missed", "missed_shots", "misses"}

	# helper to scan a stat dict
	def scan(d: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
		sh = None
		sm = None
		for k in d.keys():
			lk = str(k).lower()
			if lk in keys_hit:
				sh = extract_int(d.get(k))
			if lk in keys_miss:
				sm = extract_int(d.get(k))
		return sh, sm

	# 1) try last snapshot
	ls = last_stats(player.get("stats"))
	sh, sm = scan(ls)

	# 2) fallback to top-level if not found
	if sh is None or sm is None:
		tsh, tsm = scan(player)
		sh = sh if sh is not None else tsh
		sm = sm if sm is not None else tsm

	# 3) If still None, attempt to aggregate over all snapshots
	if (sh is None or sm is None) and isinstance(player.get("stats"), list):
		agg_hit = 0
		agg_miss = 0
		found_hit = False
		found_miss = False
		for s in player.get("stats") or []:
			h, m = scan(s)
			if h is not None:
				agg_hit += h
				found_hit = True
			if m is not None:
				agg_miss += m
				found_miss = True
		sh = agg_hit if found_hit else sh
		sm = agg_miss if found_miss else sm

	return sh, sm


def recompute_user_stats(conn: sqlite3.Connection, account_id: int) -> None:
	"""Recompute aggregate stats for a single user from players table."""
	cur = conn.execute(
		"""
		SELECT
			COUNT(*) AS matches_played,
			SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) AS wins,
			SUM(CASE WHEN p.result = 'Loss' THEN 1 ELSE 0 END) AS losses,
			SUM(COALESCE(p.kills,0)) AS kills,
			SUM(COALESCE(p.deaths,0)) AS deaths,
			SUM(COALESCE(p.assists,0)) AS assists,
			SUM(COALESCE(p.last_hits,0)) AS last_hits,
			SUM(COALESCE(p.denies,0)) AS denies,
			SUM(COALESCE(p.creep_kills,0)) AS creep_kills,
			SUM(COALESCE(p.shots_hit,0)) AS shots_hit,
			SUM(COALESCE(p.shots_missed,0)) AS shots_missed,
			SUM(COALESCE(p.player_damage,0)) AS player_damage,
			SUM(COALESCE(p.obj_damage,0)) AS obj_damage,
			SUM(COALESCE(p.player_healing,0)) AS player_healing,
			SUM(COALESCE(p.pings_count,0)) AS pings_count
		FROM players p
		WHERE p.account_id = ?
		""",
		(account_id,),
	)
	row = cur.fetchone()
	if not row:
		# No matches yet; clear stats
		conn.execute(
			"INSERT INTO user_stats(account_id, matches_played, wins, losses, kills, deaths, assists, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, pings_count, avg_kda, winrate, updated_at) "
			"VALUES(?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0, 0.0, ?) "
			"ON CONFLICT(account_id) DO UPDATE SET matches_played=0, wins=0, losses=0, kills=0, deaths=0, assists=0, last_hits=0, denies=0, creep_kills=0, shots_hit=0, shots_missed=0, player_damage=0, obj_damage=0, player_healing=0, pings_count=0, avg_kda=0.0, winrate=0.0, updated_at=excluded.updated_at",
			(account_id, now_iso()),
		)
		return

	(
		matches_played,
		wins,
		losses,
		kills,
		deaths,
		assists,
		last_hits,
		denies,
		creep_kills,
		shots_hit,
		shots_missed,
		player_damage,
		obj_damage,
		player_healing,
		pings_count,
	) = row

	# Compute derived metrics
	avg_kda = 0.0
	if matches_played and matches_played > 0:
		# Use overall totals to compute KDA; avoid div-by-zero
		denom = deaths if deaths and deaths > 0 else 1
		avg_kda = float(kills + assists) / float(denom)
	winrate = float(wins) / float(matches_played) if matches_played and matches_played > 0 else 0.0

	conn.execute(
		"""
		INSERT INTO user_stats(
			account_id, matches_played, wins, losses, kills, deaths, assists, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, pings_count, avg_kda, winrate, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) 
		ON CONFLICT(account_id) DO UPDATE SET 
			matches_played=excluded.matches_played,
			wins=excluded.wins,
			losses=excluded.losses,
			kills=excluded.kills,
			deaths=excluded.deaths,
			assists=excluded.assists,
			last_hits=excluded.last_hits,
			denies=excluded.denies,
			creep_kills=excluded.creep_kills,
			shots_hit=excluded.shots_hit,
			shots_missed=excluded.shots_missed,
			player_damage=excluded.player_damage,
			obj_damage=excluded.obj_damage,
			player_healing=excluded.player_healing,
			pings_count=excluded.pings_count,
			avg_kda=excluded.avg_kda,
			winrate=excluded.winrate,
			updated_at=excluded.updated_at
		""",
		(
			account_id,
			matches_played or 0,
			wins or 0,
			losses or 0,
			kills or 0,
			deaths or 0,
			assists or 0,
			last_hits or 0,
			denies or 0,
			creep_kills or 0,
			shots_hit or 0,
			shots_missed or 0,
			player_damage or 0,
			obj_damage or 0,
			player_healing or 0,
			pings_count or 0,
			avg_kda,
			winrate,
			now_iso(),
		),
	)


def recompute_user_stats_bulk(conn: sqlite3.Connection, account_ids: List[int]) -> None:
	for aid in account_ids:
		if aid is None:
			continue
		recompute_user_stats(conn, int(aid))


# ----------------- Async DB Layer (asqlite) -----------------

async def adb_connect(db_path: Path) -> asqlite.Connection:
	conn = await asqlite.connect(str(db_path), timeout=15)
	await conn.execute("PRAGMA foreign_keys=ON;")
	await conn.execute("PRAGMA busy_timeout=5000;")
	return conn


async def db_init_async(conn: asqlite.Connection) -> bool:
	"""Async schema init + migrations.

	Returns True when a migration added columns that require broad backfill.
	"""
	await conn.executescript(SCHEMA_SQL)
	large_table_change = False
	try:
		cur = await conn.execute("PRAGMA table_info(matches)")
		rows = await cur.fetchall()
		await cur.close()
		cols = {r[1] for r in rows}
		if "start_time" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN start_time TEXT")
			large_table_change = True
		if "event_title" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_title TEXT")
			large_table_change = True
		if "event_week" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_week INTEGER")
			large_table_change = True
		if "event_team_a" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_team_a TEXT")
			large_table_change = True
		if "event_team_b" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_team_b TEXT")
			large_table_change = True
		if "event_game" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_game TEXT")
			large_table_change = True
		if "event_team_a_ingame_side" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_team_a_ingame_side INTEGER")
			large_table_change = True
		if "match_vod" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN match_vod TEXT")
			large_table_change = True
		if "event_region" not in cols:
			await conn.execute("ALTER TABLE matches ADD COLUMN event_region TEXT")
			large_table_change = True
		await conn.commit()
	except Exception:
		pass
	try:
		cur = await conn.execute("PRAGMA table_info(users)")
		rows = await cur.fetchall()
		await cur.close()
		cols = {r[1] for r in rows}
		if "avatar_url" not in cols:
			await conn.execute("ALTER TABLE users ADD COLUMN avatar_url TEXT")
		await conn.commit()
	except Exception:
		pass
	try:
		cur = await conn.execute("PRAGMA table_info(players)")
		rows = await cur.fetchall()
		await cur.close()
		cols = [r[1] for r in rows]
		if "self_healing" not in cols:
			await conn.execute("ALTER TABLE players ADD COLUMN self_healing INTEGER")
		if "teammate_healing" not in cols:
			await conn.execute("ALTER TABLE players ADD COLUMN teammate_healing INTEGER")
		await conn.commit()
	except Exception:
		pass

	try:
		cur = await conn.execute("PRAGMA table_info(players)")
		rows = await cur.fetchall()
		await cur.close()
		cols = {r[1] for r in rows}
		if "items" not in cols:
			await conn.execute("ALTER TABLE players ADD COLUMN items TEXT")
			large_table_change = True
		await conn.commit()
	except Exception:
		pass

	await conn.commit()
	return large_table_change


async def upsert_user_async(conn: asqlite.Connection, account_id: int, persona_name: Optional[str], avatar_url: Optional[str] = None) -> None:
	await conn.execute(
		"INSERT INTO users(account_id, persona_name, avatar_url, updated_at) VALUES(?, ?, ?, ?) "
		"ON CONFLICT(account_id) DO UPDATE SET persona_name=excluded.persona_name, "
		"avatar_url=COALESCE(excluded.avatar_url, avatar_url), updated_at=excluded.updated_at",
		(account_id, persona_name or "Unknown", avatar_url or None, now_iso()),
	)


async def upsert_match_async(
	conn: asqlite.Connection,
	mi: Dict[str, Any],
	event_title: Optional[str] = None,
	event_week: Optional[int] = None,
	event_team_a: Optional[str] = None,
	event_team_b: Optional[str] = None,
	event_game: Optional[str] = None,
	event_team_a_ingame_side: Optional[int] = None,
	match_vod: Optional[str] = None,
	event_region: Optional[str] = None,
) -> None:
	st = (
		mi.get("start_time")
		or mi.get("started_at")
		or mi.get("start")
		or mi.get("startTime")
		or mi.get("match_start_time")
	)
	start_iso = parse_time_to_iso(st) or now_iso()
	await conn.execute(
		"INSERT INTO matches(match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, event_title, event_week, event_team_a, event_team_b, event_game, event_team_a_ingame_side, match_vod, event_region, start_time, created_at) "
		"VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
		"ON CONFLICT(match_id) DO UPDATE SET duration_s=excluded.duration_s, winning_team=excluded.winning_team, match_outcome=excluded.match_outcome, game_mode=excluded.game_mode, match_mode=excluded.match_mode, event_title=excluded.event_title, event_week=excluded.event_week, event_team_a=excluded.event_team_a, event_team_b=excluded.event_team_b, event_game=excluded.event_game, event_team_a_ingame_side=excluded.event_team_a_ingame_side, match_vod=excluded.match_vod, event_region=excluded.event_region, start_time=excluded.start_time",
		(
			mi.get("match_id"),
			extract_int(mi.get("duration_s")),
			extract_int(mi.get("winning_team")),
			extract_int(mi.get("match_outcome")),
			extract_int(mi.get("game_mode")),
			extract_int(mi.get("match_mode")),
			event_title,
			event_week,
			event_team_a,
			event_team_b,
			event_game,
			event_team_a_ingame_side,
			match_vod or None,
			event_region or None,
			start_iso,
			now_iso(),
		),
	)


async def upsert_player_async(
	conn: asqlite.Connection,
	match_id: int,
	player: Dict[str, Any],
	winning_team: Optional[int],
	name_by_id: Dict[int, str],
) -> None:
	account_id = extract_int(player.get("account_id"))
	player_slot = extract_int(player.get("player_slot"))
	team = team_from_slot(player_slot)
	hero_id = extract_int(player.get("hero_id"))
	level = extract_int(player.get("level")) or extract_int(safe_get_stat(player, "level"))

	kills = extract_int(safe_get_stat(player, "kills"))
	deaths = extract_int(safe_get_stat(player, "deaths"))
	assists = extract_int(safe_get_stat(player, "assists"))
	net_worth = extract_int(safe_get_stat(player, "net_worth"))
	last_hits = extract_int(safe_get_stat(player, "last_hits"))
	denies = extract_int(safe_get_stat(player, "denies"))

	_last = last_stats(player.get("stats"))
	creep_kills = extract_int(_last.get("creep_kills"))
	if creep_kills is None:
		creep_kills = last_hits

	player_damage = extract_int(safe_get_stat(player, "player_damage"))
	obj_damage = extract_int(safe_get_stat(player, "boss_damage"))
	player_healing = extract_int(safe_get_stat(player, "player_healing"))
	self_healing = extract_int(safe_get_stat(player, "self_healing"))
	teammate_healing = extract_int(safe_get_stat(player, "teammate_healing"))
	shots_hit, shots_missed = derive_shots(player)
	pings = player.get("pings") or []
	pings_count = len(pings) if isinstance(pings, list) else None

	result: Optional[str] = None
	if team is not None and winning_team is not None:
		result = "Win" if int(team) == int(winning_team) else "Loss"

	raw_items = player.get("items") or []
	item_groups: Dict[Any, list] = {}
	for i in raw_items:
		if isinstance(i, dict) and i.get("item_id") is not None:
			iid = i["item_id"]
			if iid not in item_groups:
				item_groups[iid] = []
			item_groups[iid].append(i)
	seen_item_ids: set = set()
	unsold_item_ids = []
	build_items = []
	ability_events = []
	for iid, entries in item_groups.items():
		is_ability = len(entries) > 1 or any(e.get("upgrade_id", 0) != 0 for e in entries)
		if is_ability:
			for tier, entry in enumerate(sorted(entries, key=lambda x: x.get("game_time_s") or 0)):
				ability_events.append({"ability_id": iid, "game_time_s": entry.get("game_time_s"), "tier": tier})
		else:
			for entry in entries:
				if entry.get("sold_time_s", 0) == 0 and iid not in seen_item_ids:
					seen_item_ids.add(iid)
					unsold_item_ids.append(iid)
					build_items.append({"item_id": iid, "game_time_s": entry.get("game_time_s")})
	build_items.sort(key=lambda x: (x["game_time_s"] is None, x["game_time_s"] or 0))
	ability_events.sort(key=lambda x: (x["game_time_s"] is None, x["game_time_s"] or 0))
	items_json = json.dumps(unsold_item_ids) if unsold_item_ids else None
	item_build_json = json.dumps(build_items) if build_items else None
	ability_order_json = json.dumps(ability_events) if ability_events else None

	if account_id is not None:
		await upsert_user_async(conn, account_id, name_by_id.get(account_id, "Unknown"))

	await conn.execute(
		(
			"INSERT INTO players(match_id, account_id, player_slot, team, hero_id, level, kills, deaths, assists, net_worth, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, self_healing, teammate_healing, pings_count, result, items, item_build, ability_order) "
			"VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
			"ON CONFLICT(match_id, account_id) DO UPDATE SET "
			"player_slot=excluded.player_slot, team=excluded.team, hero_id=excluded.hero_id, level=excluded.level, "
			"kills=excluded.kills, deaths=excluded.deaths, assists=excluded.assists, net_worth=excluded.net_worth, "
			"last_hits=excluded.last_hits, denies=excluded.denies, creep_kills=excluded.creep_kills, "
			"shots_hit=excluded.shots_hit, shots_missed=excluded.shots_missed, player_damage=excluded.player_damage, "
			"obj_damage=excluded.obj_damage, player_healing=excluded.player_healing, self_healing=excluded.self_healing, teammate_healing=excluded.teammate_healing, pings_count=excluded.pings_count, result=excluded.result, items=excluded.items, item_build=excluded.item_build, ability_order=excluded.ability_order"
		),
		(
			match_id,
			account_id,
			player_slot,
			team,
			hero_id,
			level,
			kills,
			deaths,
			assists,
			net_worth,
			last_hits,
			denies,
			creep_kills,
			shots_hit,
			shots_missed,
			player_damage,
			obj_damage,
			player_healing,
			self_healing,
			teammate_healing,
			pings_count,
			result,
			items_json,
			item_build_json,
			ability_order_json,
		),
	)
	await upsert_player_snapshots_async(conn, match_id, account_id, player.get("stats"))


async def recompute_user_stats_async(conn: asqlite.Connection, account_id: int) -> None:
	cur = await conn.execute(
		"""
		SELECT
			COUNT(*) AS matches_played,
			SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) AS wins,
			SUM(CASE WHEN p.result = 'Loss' THEN 1 ELSE 0 END) AS losses,
			SUM(COALESCE(p.kills,0)) AS kills,
			SUM(COALESCE(p.deaths,0)) AS deaths,
			SUM(COALESCE(p.assists,0)) AS assists,
			SUM(COALESCE(p.last_hits,0)) AS last_hits,
			SUM(COALESCE(p.denies,0)) AS denies,
			SUM(COALESCE(p.creep_kills,0)) AS creep_kills,
			SUM(COALESCE(p.shots_hit,0)) AS shots_hit,
			SUM(COALESCE(p.shots_missed,0)) AS shots_missed,
			SUM(COALESCE(p.player_damage,0)) AS player_damage,
			SUM(COALESCE(p.obj_damage,0)) AS obj_damage,
			SUM(COALESCE(p.player_healing,0)) AS player_healing,
			SUM(COALESCE(p.pings_count,0)) AS pings_count
		FROM players p
		WHERE p.account_id = ?
		""",
		(account_id,),
	)
	row = await cur.fetchone()
	await cur.close()
	if not row:
		await conn.execute(
			"INSERT INTO user_stats(account_id, matches_played, wins, losses, kills, deaths, assists, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, pings_count, avg_kda, winrate, updated_at) "
			"VALUES(?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0.0, 0.0, ?) "
			"ON CONFLICT(account_id) DO UPDATE SET matches_played=0, wins=0, losses=0, kills=0, deaths=0, assists=0, last_hits=0, denies=0, creep_kills=0, shots_hit=0, shots_missed=0, player_damage=0, obj_damage=0, player_healing=0, pings_count=0, avg_kda=0.0, winrate=0.0, updated_at=excluded.updated_at",
			(account_id, now_iso()),
		)
		return

	(
		matches_played,
		wins,
		losses,
		kills,
		deaths,
		assists,
		last_hits,
		denies,
		creep_kills,
		shots_hit,
		shots_missed,
		player_damage,
		obj_damage,
		player_healing,
		pings_count,
	) = row

	avg_kda = 0.0
	if matches_played and matches_played > 0:
		denom = deaths if deaths and deaths > 0 else 1
		avg_kda = float(kills + assists) / float(denom)
	winrate = float(wins) / float(matches_played) if matches_played and matches_played > 0 else 0.0

	await conn.execute(
		"""
		INSERT INTO user_stats(
			account_id, matches_played, wins, losses, kills, deaths, assists, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, pings_count, avg_kda, winrate, updated_at
		) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(account_id) DO UPDATE SET
			matches_played=excluded.matches_played,
			wins=excluded.wins,
			losses=excluded.losses,
			kills=excluded.kills,
			deaths=excluded.deaths,
			assists=excluded.assists,
			last_hits=excluded.last_hits,
			denies=excluded.denies,
			creep_kills=excluded.creep_kills,
			shots_hit=excluded.shots_hit,
			shots_missed=excluded.shots_missed,
			player_damage=excluded.player_damage,
			obj_damage=excluded.obj_damage,
			player_healing=excluded.player_healing,
			pings_count=excluded.pings_count,
			avg_kda=excluded.avg_kda,
			winrate=excluded.winrate,
			updated_at=excluded.updated_at
		""",
		(
			account_id,
			matches_played or 0,
			wins or 0,
			losses or 0,
			kills or 0,
			deaths or 0,
			assists or 0,
			last_hits or 0,
			denies or 0,
			creep_kills or 0,
			shots_hit or 0,
			shots_missed or 0,
			player_damage or 0,
			obj_damage or 0,
			player_healing or 0,
			pings_count or 0,
			avg_kda,
			winrate,
			now_iso(),
		),
	)


async def recompute_user_stats_bulk_async(conn: asqlite.Connection, account_ids: List[int]) -> None:
	for aid in account_ids:
		if aid is None:
			continue
		await recompute_user_stats_async(conn, int(aid))


# ----------------- Core processing -----------------

def update_matches_status(status_path: Path, match_ids: List[int]) -> Dict[str, Any]:
	status = load_json(status_path, default={"matches": {}})
	matches = status.setdefault("matches", {})
	for mid in match_ids:
		key = str(int(mid))
		if key not in matches:
			matches[key] = {"checked": False, "last_checked": None, "error": None}
	save_json(status_path, status)
	return status


def mark_match_checked(status: Dict[str, Any], match_id: int, ok: bool, error: Optional[str] = None) -> None:
	rec = status.setdefault("matches", {}).setdefault(str(int(match_id)), {})
	rec["checked"] = ok
	rec["last_checked"] = now_iso()
	rec["error"] = (error or None)


def read_match_plan_file(path: Path) -> Tuple[List[int], Dict[int, Dict[str, Any]]]:
	"""Read match IDs and context from JSON.

	Supported shapes:
	1) Single series at root:
	{
	  "title": "Night Shift",
	  "weeks": [
	    {"week": 31, "match_ids": [70457488, 70471960]},
	    {
	      "week": 32,
	      "games": [
	        {
	          "team_a": "Abrahams",
	          "team_b": "Lowkey",
	          "matches": [
	            {"game": 1, "match_id": 70457488},
	            {"game": 2, "match_id": 70471960}
	          ]
	        }
	      ]
	    }
	  ]
	}

	2) Multiple series:
	{
	  "series": [
	    {"title": "Fight Night", "weeks": [...]},
	    {"title": "Night Shift", "weeks": [...]} 
	  ]
	}

	The loader also accepts "events" as an alias for "weeks".
	"""
	if not path.exists():
		raise FileNotFoundError(f"Match IDs file not found: {path}")

	payload = load_json(path, default=None)
	if not isinstance(payload, dict):
		raise ValueError(f"Match IDs JSON must be an object: {path}")

	ids: List[int] = []
	context_by_id: Dict[int, Dict[str, Any]] = {}

	def _clean_str(value: Any) -> Optional[str]:
		if value is None:
			return None
		s = str(value).strip()
		return s or None

	root_title_s = _clean_str(payload.get("title"))

	series_groups: List[Tuple[Optional[str], List[Any]]] = []
	series_payload = payload.get("series")
	if isinstance(series_payload, list):
		for series_obj in series_payload:
			if not isinstance(series_obj, dict):
				continue
			groups = series_obj.get("weeks")
			if not isinstance(groups, list):
				groups = series_obj.get("events")
			if not isinstance(groups, list):
				continue
			series_groups.append((_clean_str(series_obj.get("title")), groups))

	if not series_groups:
		groups = payload.get("weeks")
		if not isinstance(groups, list):
			groups = payload.get("events")
		if not isinstance(groups, list):
			raise ValueError("Match IDs JSON must contain either 'series' or a root 'weeks' array")
		series_groups.append((root_title_s, groups))

	def _iter_game_records(series: Dict[str, Any]) -> Iterable[Tuple[Optional[str], Any]]:
		"""Yield (game_label, match_id_value) tuples from a game/series object."""
		nested_games = series.get("matches")
		if not isinstance(nested_games, list):
			nested_games = series.get("games")
		if isinstance(nested_games, list):
			for g in nested_games:
				if isinstance(g, dict):
					yield (
						_clean_str(g.get("game") or g.get("game_label") or g.get("label") or g.get("name") or g.get("round")),
						g.get("match_id") if "match_id" in g else g.get("id"),
					)
				else:
					yield (None, g)
			return

		flat_ids = series.get("match_ids")
		if isinstance(flat_ids, list):
			for idx, value in enumerate(flat_ids, start=1):
				yield (f"Game {idx}", value)
			return

		single = series.get("match_id") if isinstance(series, dict) else None
		if single is not None:
			yield (_clean_str(series.get("game") or series.get("game_label")), single)

	for series_title, groups in series_groups:
		for group in groups:
			if not isinstance(group, dict):
				continue
			week = extract_int(group.get("week"))
			group_title_s = _clean_str(group.get("title"))
			event_title = series_title or group_title_s or root_title_s

			# Backward-compatible support for the old flat week.match_ids format.
			group_ids = group.get("match_ids")
			if isinstance(group_ids, list):
				for value in group_ids:
					try:
						mid = int(value)
						ids.append(mid)
						if mid not in context_by_id:
							context_by_id[mid] = {
								"event_title": event_title,
								"event_week": week,
								"event_team_a": None,
								"event_team_b": None,
								"event_game": None,
							}
					except (TypeError, ValueError):
						continue

			games = group.get("games")
			if not isinstance(games, list):
				continue

			for series in games:
				if not isinstance(series, dict):
					continue
				team_a = _clean_str(series.get("team_a") or series.get("team1") or series.get("left_team"))
				team_b = _clean_str(series.get("team_b") or series.get("team2") or series.get("right_team"))
				for game_label, value in _iter_game_records(series):
					try:
						mid = int(value)
						ids.append(mid)
						# Keep first-seen context in case an ID appears multiple times.
						if mid not in context_by_id:
							# team_a_side: 0 = team_a played Amber, 1 = team_a played Sapphire
							# Can be set per-game on the match entry or per-series on the series object
							team_a_side: Optional[int] = None
							nested = series.get("matches") or series.get("games")
							if isinstance(nested, list):
								for g in nested:
									if isinstance(g, dict) and (g.get("match_id") or g.get("id")) == mid:
										if "team_a_side" in g:
											team_a_side = extract_int(g["team_a_side"])
										break
							if team_a_side is None and "team_a_side" in series:
								team_a_side = extract_int(series["team_a_side"])
							context_by_id[mid] = {
								"event_title": event_title,
								"event_week": week,
								"event_team_a": team_a,
								"event_team_b": team_b,
								"event_game": game_label,
								"event_team_a_ingame_side": team_a_side,
								"match_vod": _clean_str(series.get("match_vod")),
								"event_region": _clean_str(series.get("region")),
							}
					except (TypeError, ValueError):
						# Skip invalid placeholders such as "No Match".
						continue
	return ids, context_by_id


def read_match_ids_file(path: Path) -> List[int]:
	"""Backward-compatible wrapper that returns only IDs."""
	ids, _ = read_match_plan_file(path)
	return ids


def process_match_into_db(
	conn: sqlite3.Connection,
	match_id: int,
	cache: Dict[str, str],
	steam_api_key: str,
	event_title: Optional[str] = None,
	event_week: Optional[int] = None,
	event_team_a: Optional[str] = None,
	event_team_b: Optional[str] = None,
	event_game: Optional[str] = None,
	event_team_a_ingame_side: Optional[int] = None,
	match_vod: Optional[str] = None,
	event_region: Optional[str] = None,
) -> None:
	match_info = fetch_match_metadata(match_id)

	# Upsert match row
	upsert_match(
		conn,
		match_info,
		event_title=event_title,
		event_week=event_week,
		event_team_a=event_team_a,
		event_team_b=event_team_b,
		event_game=event_game,
		event_team_a_ingame_side=event_team_a_ingame_side,
		match_vod=match_vod,
		event_region=event_region,
	)

	# Resolve names for all players (cached + API as needed)
	players = (match_info.get("players") or [])
	account_ids = [p.get("account_id") for p in players if p.get("account_id") is not None]
	account_ids_int = [int(a) for a in account_ids]
	avatar_cache: Dict[str, str] = {}
	name_map = resolve_names_with_cache(account_ids_int, cache, steam_api_key, avatar_cache)

	winning_team = match_info.get("winning_team")

	for p in players:
		upsert_player(conn, match_id, p, winning_team, name_map)

	# Also persist updated users from cache to DB
	for aid in account_ids_int:
		upsert_user(conn, aid, name_map.get(aid) or cache.get(str(aid)), avatar_cache.get(str(aid)))

	# Recompute aggregates for all users in this match
	recompute_user_stats_bulk(conn, account_ids_int)

	conn.commit()


async def process_match_into_db_async(
	conn: asqlite.Connection,
	match_id: int,
	cache: Dict[str, str],
	steam_api_key: str,
	db_lock: asyncio.Lock,
	cache_lock: asyncio.Lock,
	event_title: Optional[str] = None,
	event_week: Optional[int] = None,
	event_team_a: Optional[str] = None,
	event_team_b: Optional[str] = None,
	event_game: Optional[str] = None,
	event_team_a_ingame_side: Optional[int] = None,
	match_vod: Optional[str] = None,
	event_region: Optional[str] = None,
) -> None:
	match_info = await asyncio.to_thread(fetch_match_metadata, match_id)

	players = (match_info.get("players") or [])
	account_ids = [p.get("account_id") for p in players if p.get("account_id") is not None]
	account_ids_int = [int(a) for a in account_ids]

	async with cache_lock:
		avatar_cache: Dict[str, str] = {}
		name_map = await asyncio.to_thread(resolve_names_with_cache, account_ids_int, cache, steam_api_key, avatar_cache)

	winning_team = match_info.get("winning_team")

	async with db_lock:
		await upsert_match_async(
			conn,
			match_info,
			event_title=event_title,
			event_week=event_week,
			event_team_a=event_team_a,
			event_team_b=event_team_b,
			event_game=event_game,
			event_team_a_ingame_side=event_team_a_ingame_side,
			match_vod=match_vod,
			event_region=event_region,
		)

		for p in players:
			await upsert_player_async(conn, match_id, p, winning_team, name_map)

		for aid in account_ids_int:
			await upsert_user_async(conn, aid, name_map.get(aid) or cache.get(str(aid)), avatar_cache.get(str(aid)))

		await recompute_user_stats_bulk_async(conn, account_ids_int)
		await conn.commit()


async def run_match_ingest_async(
	conn: asqlite.Connection,
	to_process: List[int],
	match_context_by_id: Dict[int, Dict[str, Any]],
	cache: Dict[str, str],
	cache_path: Path,
	status: Dict[str, Any],
	status_path: Path,
	steam_api_key: str,
	concurrency: int,
) -> None:
	sem = asyncio.Semaphore(max(1, int(concurrency)))
	db_lock = asyncio.Lock()
	cache_lock = asyncio.Lock()
	counter_lock = asyncio.Lock()
	counter = {"done": 0, "total": len(to_process)}

	async def worker(mid: int) -> None:
		async with sem:
			async with counter_lock:
				counter["done"] += 1
				idx = counter["done"]
				total = counter["total"]
			print(f"[{idx}/{total}] Processing match {mid}...")
			try:
				ctx = match_context_by_id.get(mid, {})
				await process_match_into_db_async(
					conn,
					mid,
					cache,
					steam_api_key,
					db_lock,
					cache_lock,
					event_title=ctx.get("event_title"),
					event_week=ctx.get("event_week"),
					event_team_a=ctx.get("event_team_a"),
					event_team_b=ctx.get("event_team_b"),
					event_game=ctx.get("event_game"),
					event_team_a_ingame_side=ctx.get("event_team_a_ingame_side"),
					match_vod=ctx.get("match_vod"),
					event_region=ctx.get("event_region"),
				)
				async with cache_lock:
					save_json(cache_path, cache)
				mark_match_checked(status, mid, ok=True)
				save_json(status_path, status)
				print(f"[{idx}/{total}] Match {mid} done.")
			except SkipMatchSilent:
				return
			except requests.HTTPError as e:
				status_code = e.response.status_code if getattr(e, "response", None) is not None else None
				if status_code == 404:
					print(f"Match {mid} not found (404); marking as checked and skipping.")
					mark_match_checked(status, mid, ok=True, error="404 not found")
					save_json(status_path, status)
					return
				msg = f"HTTP error for match {mid}: {e}"
				print(msg)
				mark_match_checked(status, mid, ok=False, error=str(e))
				save_json(status_path, status)
			except Exception as e:
				msg = f"Error for match {mid}: {e}"
				print(msg)
				mark_match_checked(status, mid, ok=False, error=str(e))
				save_json(status_path, status)

	await asyncio.gather(*(worker(mid) for mid in to_process))


def refresh_user_cache_only(conn: sqlite3.Connection, cache_path: Path, steam_api_key: str) -> None:
	cache = load_json(cache_path, default={})
	if not isinstance(cache, dict):
		cache = {}
	avatar_cache: Dict[str, str] = {}
	refetch_all_cached_users(cache, steam_api_key, avatar_cache)
	save_json(cache_path, cache)

	# Mirror to DB users table
	for k, v in cache.items():
		if not str(k).isdigit():
			continue
		upsert_user(conn, int(k), str(v) if v is not None else "Unknown", avatar_cache.get(str(k)))
	# Recompute aggregates for all cached users
	ids = [int(k) for k in cache.keys() if str(k).isdigit()]
	recompute_user_stats_bulk(conn, ids)
	conn.commit()


# ----------------- Hero details fetchers -----------------

def load_hero_cache(cache_path: Path) -> Dict[str, Any]:
    data = load_json(cache_path, default={"heroes": {}})
    if not isinstance(data, dict):
        return {"heroes": {}}
    if "heroes" not in data or not isinstance(data["heroes"], dict):
        data["heroes"] = {}
    return data

def fetch_hero_details(hero_id: int) -> Optional[Dict[str, Any]]:
    url = HERO_DETAILS_URL.format(hero_id=hero_id)
    resp = http_get_with_retries(url, timeout=30, max_retries=3)
    if resp.status_code == 404:
        return None
    resp.raise_for_status()
    try:
        data = resp.json()
    except json.JSONDecodeError:
        return None
    if not isinstance(data, dict):
        return None
    return data

def update_hero_cache_range(
    cache_path: Path,
    start: int,
    end: int,
    force: bool = False,
    delay: float = 0.2,
) -> None:
    cache = load_hero_cache(cache_path)
    heroes = cache.setdefault("heroes", {})
    fetched = 0
    skipped = 0

    for hero_id in range(int(start), int(end) + 1):
        key = str(int(hero_id))
        if not force and key in heroes and heroes[key]:
            print(f"Hero {hero_id}: cached, skip")
            skipped += 1
            continue

        data = fetch_hero_details(hero_id)
        if data is None:
            print(f"Hero {hero_id}: no data")
        else:
            heroes[key] = data
            cache["updated_at"] = now_iso()
            save_json(cache_path, cache)
            print(f"Hero {hero_id}: cached")
            fetched += 1

        if delay and delay > 0:
            time.sleep(float(delay))

    print(f"Heroes done. Fetched: {fetched}, Skipped: {skipped}, Total in cache: {len(heroes)}")
    save_json(cache_path, cache)


# ----------------- Hero name fetchers (ID -> Name) -----------------

def load_hero_name_cache(cache_path: Path) -> Dict[str, Any]:
    """Load hero name cache. Migrates any old full-payload entries to just names."""
    data = load_json(cache_path, default={"heroes": {}})
    if not isinstance(data, dict):
        data = {"heroes": {}}
    heroes = data.get("heroes")
    if not isinstance(heroes, dict):
        data["heroes"] = {}
        heroes = data["heroes"]

    # Migrate: if any value is a dict with a 'name', replace with that name
    changed = False
    for k, v in list(heroes.items()):
        if isinstance(v, dict):
            name = v.get("name")
            if isinstance(name, str) and name:
                heroes[k] = name
                changed = True
            else:
                # Drop invalid entries
                del heroes[k]
                changed = True
    if changed:
        data["updated_at"] = now_iso()
        save_json(cache_path, data)
    return data

def fetch_hero_name(hero_id: int, timeout: int = 20) -> Optional[str]:
    url = HERO_DETAILS_URL.format(hero_id=hero_id)
    try:
        resp = requests.get(url, timeout=timeout)
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        payload = resp.json()
        name = payload.get("name")
        if isinstance(name, str) and name:
            return name
    except (requests.RequestException, json.JSONDecodeError):
        return None
    return None

def update_hero_name_cache_range(
    cache_path: Path,
    start: int,
    end: int,
    force: bool = False,
    delay: float = 0.2,
) -> None:
    cache = load_hero_name_cache(cache_path)
    heroes: Dict[str, str] = cache.setdefault("heroes", {})
    fetched = 0
    skipped = 0

    for hero_id in range(int(start), int(end) + 1):
        key = str(hero_id)
        if not force and key in heroes and isinstance(heroes[key], str) and heroes[key]:
            print(f"Hero {hero_id}: cached, skip")
            skipped += 1
            continue

        name = fetch_hero_name(hero_id)
        if name is None:
            print(f"Hero {hero_id}: no data")
        else:
            heroes[key] = name
            cache["updated_at"] = now_iso()
            save_json(cache_path, cache)  # incremental save
            print(f"Hero {hero_id}: {name}")
            fetched += 1

        if delay and delay > 0:
            time.sleep(float(delay))

    print(f"Heroes done. Fetched: {fetched}, Skipped: {skipped}, Total in cache: {len(heroes)}")
    save_json(cache_path, cache)


# ----------------- CLI -----------------

def main(argv: Optional[List[str]] = None) -> int:
	parser = argparse.ArgumentParser(description="DLNS batch processor for matches + user cache")
	parser.add_argument("-matchfile", dest="matchfile", type=str, default=None, help="Path to JSON file of match IDs grouped by week")
	parser.add_argument("-matchjson", dest="matchfile", type=str, default=None, help="Alias for -matchfile (JSON input)")
	parser.add_argument("-recheckall", dest="recheckall", type=str, default="false", help="If true, process all IDs from the input file, ignoring checked status")
	parser.add_argument("-concurrency", dest="concurrency", type=int, default=DEFAULT_MATCH_CONCURRENCY, help="Concurrent match workers for async ingestion")
	parser.add_argument("-userfetch", dest="userfetch", type=str, default="false", help="If true, only refetch usernames for all cached users")
	parser.add_argument("-db", dest="db_path", type=str, default=str(DEFAULT_DB_PATH), help="Path to SQLite DB file")
	parser.add_argument("-cache", dest="cache_path", type=str, default=str(DEFAULT_CACHE_PATH), help="Path to user cache JSON {account_id: persona}")
	parser.add_argument("-status", dest="status_path", type=str, default=str(DEFAULT_STATUS_PATH), help="Path to matches status JSON")

	# Hero details fetch controls
	parser.add_argument("-herofetch", dest="herofetch", type=str, default="false", help="If true, fetch hero details and update hero cache")
	parser.add_argument("-herostart", dest="herostart", type=int, default=1, help="Hero ID start (inclusive)")
	parser.add_argument("-heroend", dest="heroend", type=int, default=36, help="Hero ID end (inclusive)")
	parser.add_argument("-herocache", dest="herocache", type=str, default=str(DEFAULT_HERO_CACHE_PATH), help="Path to hero details cache JSON")
	parser.add_argument("-heroforce", dest="heroforce", type=str, default="false", help="If true, refetch even if cached")
	parser.add_argument("-herodelay", dest="herodelay", type=float, default=0.2, help="Delay between hero requests in seconds")

	args = parser.parse_args(argv)

	db_path = Path(args.db_path)
	cache_path = Path(args.cache_path)
	status_path = Path(args.status_path)
	hero_cache_path = Path(args.herocache)

	# Ensure output directories exist
	ensure_dirs(
		DEFAULT_DATA_DIR,
		db_path.parent,
		cache_path.parent,
		status_path.parent,
		hero_cache_path.parent,
	)

	# Hero-only mode (independent of DB)
	if parse_bool(args.herofetch):
		start = int(args.herostart)
		end = int(args.heroend)
		if start < 1 or end < start:
			print("Invalid hero range.")
			return 2
		update_hero_name_cache_range(
			Path(args.herocache),
			start=start,
			end=end,
			force=parse_bool(args.heroforce),
			delay=float(args.herodelay),
		)
		return 0

	if parse_bool(args.userfetch):
		conn = db_connect(db_path)
		db_init(conn)
		try:
			print("[userfetch] Refreshing usernames for all users in cache...")
			refresh_user_cache_only(conn, cache_path, STEAM_API_KEY)
			print("[userfetch] Done.")
			return 0
		finally:
			conn.close()

	# Normal mode: process matches from a file
	if not args.matchfile:
		print("No -matchfile provided.")
		return 2

	matchfile = Path(args.matchfile)
	match_ids, match_context_by_id = read_match_plan_file(matchfile)
	if not match_ids:
		print("No match IDs found in match JSON.")
		return 0

	status = update_matches_status(status_path, match_ids)
	cache = load_json(cache_path, default={})
	if not isinstance(cache, dict):
		cache = {}

	# Always bring DB schema up to date before deciding what to process.
	conn = db_connect(db_path)
	try:
		had_large_table_change = db_init(conn)
	finally:
		conn.close()

	force_recheck_all = parse_bool(args.recheckall) or had_large_table_change
	if had_large_table_change:
		print("Detected a large table schema update. Forcing full match refetch for this run.")

	to_process: List[int] = []
	seen: set[int] = set()
	for mid in match_ids:
		if mid in seen:
			continue
		seen.add(mid)
		if force_recheck_all or not status.get("matches", {}).get(str(mid), {}).get("checked"):
			to_process.append(mid)

	print(f"Found {len(to_process)} matches to process.")

	async def _run_async() -> None:
		aconn = await adb_connect(db_path)
		try:
			await db_init_async(aconn)
			await run_match_ingest_async(
				aconn,
				to_process,
				match_context_by_id,
				cache,
				cache_path,
				status,
				status_path,
				STEAM_API_KEY,
				concurrency=max(1, int(args.concurrency)),
			)
		finally:
			await aconn.close()

	asyncio.run(_run_async())
	print("All done.")
	return 0


if __name__ == "__main__":
	raise SystemExit(main())

