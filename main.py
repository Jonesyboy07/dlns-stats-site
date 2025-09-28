from __future__ import annotations

import os
import argparse
import json
import time
import requests
import random
import sqlite3

from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

from dotenv import load_dotenv


# ----------------- Config -----------------

# Load environment variables from a .env file if present
load_dotenv()

DEFAULT_DATA_DIR = Path.cwd() / "data"
DEFAULT_DB_PATH = DEFAULT_DATA_DIR / "dlns.sqlite3"
DEFAULT_CACHE_PATH = DEFAULT_DATA_DIR / "user_cache.json"
DEFAULT_STATUS_PATH = DEFAULT_DATA_DIR / "matches_status.json"
DEFAULT_HERO_CACHE_PATH = DEFAULT_DATA_DIR / "hero_names.json"

# Deadlock + Steam APIs
MATCH_METADATA_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/metadata"
HERO_DETAILS_URL = (
    "https://assets.deadlock-api.com/v2/heroes/{hero_id}?language=english&client_version=5902"
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
		with path.open("r", encoding="utf-8") as f:
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
	# Do not retry or log on server errors; if we get a 500, skip this match silently
	r = http_get_with_retries(url, timeout=30, max_retries=1)
	if r.status_code == 500:
		# Pretend this match doesn't exist: no logging, no status updates
		raise SkipMatchSilent()
	r.raise_for_status()
	data = r.json()
	if not isinstance(data, dict) or "match_info" not in data:
		raise ValueError("Unexpected response shape from match metadata API")
	return data["match_info"]


def fetch_player_summaries(steam_api_key: str, steam_ids64: List[str]) -> Dict[str, str]:
	if not steam_ids64:
		return {}
	params = {"key": steam_api_key, "steamids": ",".join(steam_ids64)}
	r = http_get_with_retries(STEAM_GET_SUMMARIES_URL, params=params, timeout=30)
	r.raise_for_status()
	data = r.json() or {}
	players = ((data.get("response") or {}).get("players") or [])
	result: Dict[str, str] = {}
	for p in players:
		sid = p.get("steamid")
		persona = p.get("personaname") or p.get("realname")
		if sid and persona:
			result[str(sid)] = str(persona)
	return result


def http_get_with_retries(
	url: str,
	params: Optional[Dict[str, Any]] = None,
	timeout: int = 30,
	max_retries: Optional[int] = None,
	backoff: float = 1.0,
	max_backoff: float = 60.0,
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
			# If rate limited, sleep per Retry-After or backoff
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
				# If finite retries and we've exhausted, return response
				if max_retries is not None and attempt >= max_retries - 1:
					return resp
				print(f"[rate-limit] 429 received. Retrying in {wait_s:.1f}s...")
				time.sleep(wait_s)
				attempt += 1
				continue

			# Retry on transient 5xx
			if 500 <= resp.status_code < 600:
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


def resolve_names_with_cache(account_ids: List[int], cache: Dict[str, str], steam_api_key: str) -> Dict[int, str]:
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
		name_by_sid: Dict[str, str] = {}
		for chunk in chunked(steam_ids64, 100):
			name_by_sid.update(fetch_player_summaries(steam_api_key, chunk))
		for a in to_lookup:
			sid64 = to_steamid64(a)
			persona = name_by_sid.get(sid64, "Unknown")
			cache[str(a)] = persona
			resolved[a] = persona

	# fill any already-cached values
	for aid in account_ids:
		if aid is None:
			continue
		s = str(int(aid))
		if s in cache and cache[s]:
			resolved[int(aid)] = cache[s]
	return resolved


def refetch_all_cached_users(cache: Dict[str, str], steam_api_key: str) -> Dict[str, str]:
	ids = [int(k) for k in cache.keys() if k.isdigit()]
	steam_ids64 = [to_steamid64(a) for a in ids]
	new_names: Dict[str, str] = {}
	for chunk in chunked(steam_ids64, 100):
		new_names.update(fetch_player_summaries(steam_api_key, chunk))
	# update cache in place
	for aid in ids:
		sid64 = to_steamid64(aid)
		persona = new_names.get(sid64)
		if persona:
			cache[str(aid)] = persona
	return cache


# ----------------- DB Layer (SQLite) -----------------

SCHEMA_SQL = """
PRAGMA journal_mode=WAL;
PRAGMA foreign_keys=ON;

CREATE TABLE IF NOT EXISTS users (
  account_id INTEGER PRIMARY KEY,
  persona_name TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS matches (
  match_id INTEGER PRIMARY KEY,
  duration_s INTEGER,
  winning_team INTEGER,
  match_outcome INTEGER,
  game_mode INTEGER,
  match_mode INTEGER,
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


def db_init(conn: sqlite3.Connection) -> None:
	conn.executescript(SCHEMA_SQL)
	# Migrations: ensure new columns exist on old DBs
	try:
		cur = conn.execute("PRAGMA table_info(matches)")
		cols = [r[1] for r in cur.fetchall()]
		if "start_time" not in cols:
			conn.execute("ALTER TABLE matches ADD COLUMN start_time TEXT")
			conn.commit()
	except Exception:
		pass
	conn.commit()


def upsert_user(conn: sqlite3.Connection, account_id: int, persona_name: Optional[str]) -> None:
	conn.execute(
		"INSERT INTO users(account_id, persona_name, updated_at) VALUES(?, ?, ?) "
		"ON CONFLICT(account_id) DO UPDATE SET persona_name=excluded.persona_name, updated_at=excluded.updated_at",
		(account_id, persona_name or "Unknown", now_iso()),
	)


def upsert_match(conn: sqlite3.Connection, mi: Dict[str, Any]) -> None:
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
		"INSERT INTO matches(match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, start_time, created_at) "
		"VALUES(?, ?, ?, ?, ?, ?, ?, ?) "
		"ON CONFLICT(match_id) DO UPDATE SET duration_s=excluded.duration_s, winning_team=excluded.winning_team, match_outcome=excluded.match_outcome, game_mode=excluded.game_mode, match_mode=excluded.match_mode, start_time=excluded.start_time",
		(
			mi.get("match_id"),
			extract_int(mi.get("duration_s")),
			extract_int(mi.get("winning_team")),
			extract_int(mi.get("match_outcome")),
			extract_int(mi.get("game_mode")),
			extract_int(mi.get("match_mode")),
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

	# Shots hit/missed: attempt to derive from snapshots if present
	shots_hit, shots_missed = derive_shots(player)

	# Pings count: length of the pings array if present
	pings = player.get("pings") or []
	pings_count = len(pings) if isinstance(pings, list) else None

	# Result for this player
	result: Optional[str] = None
	if team is not None and winning_team is not None:
		result = "Win" if int(team) == int(winning_team) else "Loss"

	# Ensure user row exists and is updated
	if account_id is not None:
		upsert_user(conn, account_id, name_by_id.get(account_id, "Unknown"))

	conn.execute(
		(
			"INSERT INTO players(match_id, account_id, player_slot, team, hero_id, level, kills, deaths, assists, net_worth, last_hits, denies, creep_kills, shots_hit, shots_missed, player_damage, obj_damage, player_healing, pings_count, result) "
			"VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) "
			"ON CONFLICT(match_id, account_id) DO UPDATE SET "
			"player_slot=excluded.player_slot, team=excluded.team, hero_id=excluded.hero_id, level=excluded.level, "
			"kills=excluded.kills, deaths=excluded.deaths, assists=excluded.assists, net_worth=excluded.net_worth, "
			"last_hits=excluded.last_hits, denies=excluded.denies, creep_kills=excluded.creep_kills, "
			"shots_hit=excluded.shots_hit, shots_missed=excluded.shots_missed, player_damage=excluded.player_damage, "
			"obj_damage=excluded.obj_damage, player_healing=excluded.player_healing, pings_count=excluded.pings_count, result=excluded.result"
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
			pings_count,
			result,
		),
	)


def derive_shots(player: Dict[str, Any]) -> Tuple[Optional[int], Optional[int]]:
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


def read_match_ids_file(path: Path) -> List[int]:
	ids: List[int] = []
	if not path.exists():
		raise FileNotFoundError(f"Match IDs file not found: {path}")
	with path.open("r", encoding="utf-8") as f:
		for line in f:
			s = line.strip()
			if not s:
				continue
			if s.startswith("#"):
				continue
			try:
				ids.append(int(s))
			except ValueError:
				# skip non-integer lines
				continue
	return ids


def process_match_into_db(
	conn: sqlite3.Connection,
	match_id: int,
	cache: Dict[str, str],
	steam_api_key: str,
) -> None:
	match_info = fetch_match_metadata(match_id)

	# Upsert match row
	upsert_match(conn, match_info)

	# Resolve names for all players (cached + API as needed)
	players = (match_info.get("players") or [])
	account_ids = [p.get("account_id") for p in players if p.get("account_id") is not None]
	account_ids_int = [int(a) for a in account_ids]
	name_map = resolve_names_with_cache(account_ids_int, cache, steam_api_key)

	winning_team = match_info.get("winning_team")

	for p in players:
		upsert_player(conn, match_id, p, winning_team, name_map)

	# Also persist updated users from cache to DB
	for aid in account_ids_int:
		upsert_user(conn, aid, name_map.get(aid) or cache.get(str(aid)))

	# Recompute aggregates for all users in this match
	recompute_user_stats_bulk(conn, account_ids_int)

	conn.commit()


def refresh_user_cache_only(conn: sqlite3.Connection, cache_path: Path, steam_api_key: str) -> None:
	cache = load_json(cache_path, default={})
	if not isinstance(cache, dict):
		cache = {}
	refetch_all_cached_users(cache, steam_api_key)
	save_json(cache_path, cache)

	# Mirror to DB users table
	for k, v in cache.items():
		if not str(k).isdigit():
			continue
		upsert_user(conn, int(k), str(v) if v is not None else "Unknown")
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
    parser.add_argument("-matchfile", dest="matchfile", type=str, default=None, help="Path to txt file of match IDs (one per line)")
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

    # Open DB connection for subsequent modes
    conn = db_connect(db_path)
    db_init(conn)

    try:
        if parse_bool(args.userfetch):
            print("[userfetch] Refreshing usernames for all users in cache...")
            refresh_user_cache_only(conn, cache_path, STEAM_API_KEY)
            print("[userfetch] Done.")
            return 0

        # Normal mode: process matches from a file
        if not args.matchfile:
            print("No -matchfile provided.")
            return 2

        matchfile = Path(args.matchfile)
        match_ids = read_match_ids_file(matchfile)
        if not match_ids:
            print("No match IDs found in match file.")
            return 0

        status = update_matches_status(status_path, match_ids)
        cache = load_json(cache_path, default={})
        if not isinstance(cache, dict):
            cache = {}

        # Process only unchecked matches; avoid duplicates from the input file
        to_process: List[int] = []
        seen: set[int] = set()
        for mid in match_ids:
            if mid in seen:
                continue
            seen.add(mid)
            if not status.get(str(mid), {}).get("done"):
                to_process.append(mid)

        print(f"Found {len(to_process)} matches to process.")

        for i, mid in enumerate(to_process, 1):
            try:
                print(f"[{i}/{len(to_process)}] Processing match {mid}...")
                process_match_into_db(conn, mid, cache, STEAM_API_KEY)
                # persist cache after each match to avoid loss
                save_json(cache_path, cache)
                mark_match_checked(status, mid, ok=True)
                save_json(status_path, status)
                print(f"[{i}/{len(to_process)}] Match {mid} done.")
            except SkipMatchSilent:
                # Do nothing: no logging, no status update. Pretend the match didn't exist.
                continue
            except requests.HTTPError as e:
                msg = f"HTTP error for match {mid}: {e}"
                print(msg)
                mark_match_checked(status, mid, ok=False, error=str(e))
                save_json(status_path, status)
            except Exception as e:
                msg = f"Error for match {mid}: {e}"
                print(msg)
                mark_match_checked(status, mid, ok=False, error=str(e))
                save_json(status_path, status)

        print("All done.")
        return 0

    finally:
        conn.close()


if __name__ == "__main__":
	raise SystemExit(main())

