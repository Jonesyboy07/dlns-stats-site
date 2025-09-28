from __future__ import annotations

import csv
import io
import json
from typing import Any, Dict, List, Optional
from pathlib import Path

import requests
from flask import Blueprint, Response, render_template, request, stream_with_context

# Unique, isolated Blueprint for the DLNS exporter UI and API
expo_bp = Blueprint(
    "dlns_exporter",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/dlns-static",
    url_prefix="/dlns",
)


# --- API endpoints and config (copied from app module, hardcoded as requested) ---
MATCH_METADATA_URL = "https://api.deadlock-api.com/v1/matches/{match_id}/metadata"
HERO_DETAILS_URL = (
    "https://assets.deadlock-api.com/v2/heroes/{hero_id}?language=english&client_version=5902"
)
STEAM_GET_SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/"
STEAM_API_KEY = "12B92B70D84E28131ADF84C9D6B03B8E"

HEADERS = [
    "Player Name",
    "Hero",
    "Total Souls",
    "Kills",
    "Deaths",
    "Assists",
    "Player Damage",
    "Obj Damage",
    "Healing",
    "",
    "Result",
    "Match Length",
]

BATCH_HEADERS = [
    "Match_ID",
    "Player Name",
    "Hero",
    "Total Souls",
    "Kills",
    "Deaths",
    "Assists",
    "Player Damage",
    "Obj Damage",
    "Healing",
    "",
    "Result",
    "Match Length",
]


# -------- Cache config --------
CACHE_DIR = Path.cwd() / "data" / "cache" / "matches"
def _ensure_cache_dir() -> None:
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
    except Exception:
        pass

def _cache_path(match_id: int) -> Path:
    return CACHE_DIR / f"{int(match_id)}.json"

def load_cached_match(match_id: int) -> Optional[Dict[str, Any]]:
    """Return cached match_info dict if present and valid, else None."""
    try:
        p = _cache_path(match_id)
        if not p.exists():
            return None
        with p.open("r", encoding="utf-8") as f:
            data = json.load(f)
        # We store match_info dict directly
        if isinstance(data, dict) and ("players" in data or "winning_team" in data):
            return data
    except Exception:
        return None
    return None

def save_cached_match(match_id: int, match_info: Dict[str, Any]) -> None:
    """Persist match_info dict to disk cache."""
    try:
        _ensure_cache_dir()
        p = _cache_path(match_id)
        with p.open("w", encoding="utf-8") as f:
            json.dump(match_info, f, ensure_ascii=False)
    except Exception:
        # Cache write failures should not break processing
        pass

def fetch_match_info_cached(match_id: int) -> Dict[str, Any]:
    """Load match_info from cache if available; otherwise fetch and cache."""
    cached = load_cached_match(match_id)
    if cached is not None:
        return cached
    info = get_match_metadata(int(match_id))
    # get_match_metadata returns the 'match_info' dict already
    save_cached_match(match_id, info)
    return info


# -------- Core helpers --------
def get_match_metadata(match_id: int) -> Dict[str, Any]:
    url = MATCH_METADATA_URL.format(match_id=match_id)
    resp = requests.get(url, timeout=30)
    resp.raise_for_status()
    data = resp.json()
    if not isinstance(data, dict) or "match_info" not in data:
        raise ValueError("Unexpected response shape from match metadata API")
    return data["match_info"]


def get_hero_name(hero_id: Optional[int], cache: Dict[int, str]) -> str:
    if hero_id is None:
        return "Unknown"
    if hero_id in cache:
        return cache[hero_id]
    try:
        resp = requests.get(HERO_DETAILS_URL.format(hero_id=hero_id), timeout=30)
        resp.raise_for_status()
        hero_data = resp.json()
        name = hero_data.get("name") or hero_data.get("class_name") or f"Hero {hero_id}"
        cache[hero_id] = name
        return name
    except Exception:
        cache[hero_id] = f"Hero {hero_id}"
        return cache[hero_id]


def to_steamid64(account_id: int) -> str:
    return str(int(account_id) + 76561197960265728)


def _chunk_list(items: List[str], size: int = 100) -> List[List[str]]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def fetch_player_summaries(steam_api_key: str, steam_ids64: List[str]) -> Dict[str, str]:
    if not steam_ids64:
        return {}
    params = {"key": steam_api_key, "steamids": ",".join(steam_ids64)}
    resp = requests.get(STEAM_GET_SUMMARIES_URL, params=params, timeout=30)
    resp.raise_for_status()
    data = resp.json() or {}
    players = ((data.get("response") or {}).get("players") or [])
    result: Dict[str, str] = {}
    for p in players:
        steamid = p.get("steamid")
        persona = p.get("personaname") or p.get("realname")
        if steamid and persona:
            result[str(steamid)] = str(persona)
    return result


def resolve_player_names_steam(account_ids: List[int], steam_api_key: str) -> Dict[int, str]:
    unique_ids: List[int] = []
    seen: set[int] = set()
    for aid in account_ids:
        if aid is None:
            continue
        try:
            val = int(aid)
        except Exception:
            continue
        if val not in seen:
            seen.add(val)
            unique_ids.append(val)

    steam_ids64 = [to_steamid64(a) for a in unique_ids]
    name_by_steamid: Dict[str, str] = {}
    for chunk in _chunk_list(steam_ids64, 100):
        name_by_steamid.update(fetch_player_summaries(steam_api_key, chunk))

    result: Dict[int, str] = {}
    for aid in unique_ids:
        sid64 = to_steamid64(aid)
        result[aid] = name_by_steamid.get(sid64, "Unknown")
    return result


def team_from_slot(player_slot: Optional[int]) -> Optional[int]:
    if player_slot is None:
        return None
    try:
        if 1 <= int(player_slot) <= 6:
            return 0
        if 7 <= int(player_slot) <= 12:
            return 1
    except Exception:
        pass
    return None


def last_stats(stats: Optional[List[Dict[str, Any]]]) -> Dict[str, Any]:
    if not stats:
        return {}
    return stats[-1] if isinstance(stats, list) else {}


def format_duration(seconds: Optional[int]) -> str:
    if seconds is None:
        return "Unknown"
    try:
        s = int(seconds)
    except Exception:
        return "Unknown"
    if s < 0:
        return "Unknown"
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h > 0:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def build_rows(match_info: Dict[str, Any], name_map: Dict[int, str], match_id: Optional[str] = None) -> List[Dict[str, Any]]:
    players = match_info.get("players", []) or []
    winning_team = match_info.get("winning_team")
    duration_s = match_info.get("duration_s")
    rows: List[Dict[str, Any]] = []
    hero_cache: Dict[int, str] = {}

    for p in players:
        pslot = p.get("player_slot")
        team = team_from_slot(pslot)
        stats_final = last_stats(p.get("stats"))

        account_id = p.get("account_id")
        hero_id = p.get("hero_id")
        hero_name = get_hero_name(hero_id, hero_cache)
        player_name = name_map.get(account_id, "Unknown")

        net_worth = stats_final.get("net_worth")
        kills = stats_final.get("kills")
        deaths = stats_final.get("deaths")
        assists = stats_final.get("assists")
        player_damage = stats_final.get("player_damage")
        obj_damage = stats_final.get("boss_damage")  # proxy for objective damage
        healing = stats_final.get("player_healing")
        
        
        if team is None or winning_team is None:
            result = "Unknown"
        else:
            result = "Win" if int(team) == int(winning_team) else "Loss"

        row_data = {
            "Player Name": player_name,
            "Hero": hero_name,
            "Total Souls": net_worth,
            "Kills": kills,
            "Deaths": deaths,
            "Assists": assists,
            "Player Damage": player_damage,
            "Obj Damage": obj_damage,
            "Healing": healing,
            "Result": result,
            "Match Length": format_duration(duration_s),
        }
        
        # Add Match_ID if provided (for batch processing)
        if match_id is not None:
            row_data["Match_ID"] = match_id
            
        rows.append(row_data)

    winners = [r for r in rows if r.get("Result") == "Win"]
    losers = [r for r in rows if r.get("Result") == "Lose"]
    unknowns = [r for r in rows if r.get("Result") not in ("Win", "Lose")]
    return winners + losers + unknowns


def rows_to_delimited(rows: List[Dict[str, Any]], sep: str = ",", include_header: bool = True, use_batch_headers: bool = False) -> str:
    output = io.StringIO()
    writer = csv.writer(output, delimiter=sep)
    headers = BATCH_HEADERS if use_batch_headers else HEADERS
    
    if include_header:
        writer.writerow(headers)
    for r in rows or []:
        writer.writerow([r.get(h, "") for h in headers])
    return output.getvalue()


def rows_to_tsv_no_match_id(rows: List[Dict[str, Any]], include_header: bool = False) -> str:
    """Generate TSV without Match_ID column for batch results"""
    output = io.StringIO()
    writer = csv.writer(output, delimiter="\t")
    
    if include_header:
        writer.writerow(HEADERS)
    for r in rows or []:
        writer.writerow([r.get(h, "") for h in HEADERS])
    return output.getvalue()


# --- Routes ---
@expo_bp.get("/")
def index():  # type: ignore
    return render_template("dlns_exporter/index.html")


@expo_bp.get("/results")
def results():  # type: ignore
    # Results page reads data from sessionStorage via JS
    return render_template("dlns_exporter/results.html")


@expo_bp.post("/process")
def process_match():  # type: ignore
    payload = request.get_json(silent=True) or {}

    def generate():
        try:
            match_input = str(payload.get("match_id", "")).strip()
            if not match_input:
                yield json.dumps({"type": "error", "message": "Error: Match ID(s) required."}) + "\n"
                return

            # Check if batch processing (comma detected)
            if "," in match_input:
                yield json.dumps({"type": "batch_start", "message": "Batch processing detected..."}) + "\n"
                match_ids = [mid.strip() for mid in match_input.split(",") if mid.strip()]
                invalid_ids = [mid for mid in match_ids if not mid.isdigit()]
                if invalid_ids:
                    yield json.dumps({"type": "error", "message": f"Error: Invalid match IDs: {', '.join(invalid_ids)}"}) + "\n"
                    return

                yield json.dumps({"type": "log", "message": f"Processing {len(match_ids)} matches..."}) + "\n"
                all_rows = []

                for i, match_id in enumerate(match_ids):
                    try:
                        yield json.dumps({"type": "progress", "message": f"Processing match {i+1}/{len(match_ids)}: {match_id}..."}) + "\n"

                        # Fetch with cache
                        info = fetch_match_info_cached(int(match_id))
                        # Log unified fetch message
                        yield json.dumps({"type": "progress", "message": "Fetched Cache Match"}) + "\n"

                        players = info.get("players", []) or []
                        yield json.dumps({"type": "progress", "message": f"Match {match_id}: Found {len(players)} players. Resolving names..."}) + "\n"

                        # Always resolve names from JSON players (fresh)
                        account_ids_all = [p.get("account_id") for p in players if p.get("account_id") is not None]
                        name_map = resolve_player_names_steam(account_ids_all, STEAM_API_KEY)

                        yield json.dumps({"type": "progress", "message": f"Match {match_id}: Parsing final stats..."}) + "\n"
                        rows = build_rows(info, name_map, match_id)
                        all_rows.extend(rows)

                        yield json.dumps({"type": "progress", "message": f"Match {match_id}: Complete ({len(rows)} players)"}) + "\n"

                    except requests.HTTPError as e:
                        yield json.dumps({"type": "progress", "message": f"Match {match_id}: HTTP error - {e}"}) + "\n"
                    except Exception as e:
                        yield json.dumps({"type": "progress", "message": f"Match {match_id}: Error - {e}"}) + "\n"

                yield json.dumps({"type": "log", "message": "Preparing combined CSV export..."}) + "\n"
                csv_text = rows_to_delimited(all_rows, ",", include_header=True, use_batch_headers=True)
                tsv_text = rows_to_delimited(all_rows, "\t", include_header=False, use_batch_headers=True)
                tsv_no_match_id = rows_to_tsv_no_match_id(all_rows, include_header=False)

                result = {
                    "type": "batch_result",
                    "headers": BATCH_HEADERS,
                    "rows": all_rows,
                    "csv": csv_text,
                    "tsv": tsv_text,
                    "tsv_no_match_id": tsv_no_match_id,
                    "total_matches": len(match_ids),
                    "total_players": len(all_rows),
                }
                yield json.dumps(result) + "\n"

            else:
                # Single match processing
                if not match_input.isdigit():
                    yield json.dumps({"type": "error", "message": "Error: Match ID must be an integer."}) + "\n"
                    return

                # Fetch with cache
                info = fetch_match_info_cached(int(match_input))
                yield json.dumps({"type": "log", "message": "Fetched Cache Match"}) + "\n"

                players = info.get("players", []) or []
                yield json.dumps({"type": "log", "message": f"Found {len(players)} players. Resolving names via Steam..."}) + "\n"

                # Resolve names from JSON players (fresh each time)
                account_ids_all = [p.get("account_id") for p in players if p.get("account_id") is not None]
                name_map = resolve_player_names_steam(account_ids_all, STEAM_API_KEY)

                yield json.dumps({"type": "log", "message": "Parsing final stats..."}) + "\n"
                rows = build_rows(info, name_map)

                yield json.dumps({"type": "log", "message": "Preparing exports..."}) + "\n"
                csv_text = rows_to_delimited(rows, ",", include_header=True)
                tsv_text = rows_to_delimited(rows, "\t", include_header=False)

                result = {"type": "result", "headers": HEADERS, "rows": rows, "csv": csv_text, "tsv": tsv_text}
                yield json.dumps(result) + "\n"

        except requests.HTTPError as e:
            yield json.dumps({"type": "error", "message": f"HTTP error: {e}"}) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": f"Error: {e}"}) + "\n"

    return Response(stream_with_context(generate()), mimetype="application/x-ndjson")
