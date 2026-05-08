from __future__ import annotations

import json
import time
from pathlib import Path
from flask import Blueprint, jsonify, request, render_template, redirect, url_for
from functools import wraps
from ..utils.auth import is_logged_in, get_current_user, require_login


ranker_bp = Blueprint("ranker", __name__, url_prefix="/rank")

# Storage files
DATA_DIR = Path("data").resolve()
SUBMISSIONS_FILE = DATA_DIR / "rank_submission.json"  # { discord_id: { rank: str, submitted_at: int } }
TEAMS_FILE = DATA_DIR / "team_assignment.json"        # { discord_id: 0|1 }
"""
Hardcoded admin list for Ranker dev panel. Add Discord user IDs here.
"""
RANKER_OWNER_IDS: set[str] = {
    "950380630905069578", "285203317162770442", "545930766367064086", "121929150184292354"
}

def is_ranker_admin() -> bool:
    user = get_current_user() or {}
    uid = str(user.get("id") or "")
    return uid in RANKER_OWNER_IDS

def require_ranker_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not is_logged_in():
            return redirect(url_for("auth.login", next=request.path))
        if not is_ranker_admin():
            return redirect(url_for("ranker.rank_page"))
        return f(*args, **kwargs)
    return wrapper



def _load_json(path: Path) -> dict:
    try:
        if path.exists():
            return json.loads(path.read_text("utf-8"))
    except Exception:
        pass
    return {}


def _save_json(path: Path, data: dict) -> None:
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        pass


@ranker_bp.get("")
def rank_page():
    """Rank submission page. Require login and preserve redirect."""
    if not is_logged_in():
        # Preserve redirect back to this page after login
        return redirect(url_for("auth.login", next=url_for("ranker.rank_page")))
    return render_template("react.html", page="rank")


@ranker_bp.get("/dev")
@require_ranker_admin
def rank_admin_page():
    """Admin panel for assigning teams."""
    return render_template("react.html", page="rank_admin")


# ------------------ API ------------------
API_PREFIX = "/rank/api"


@ranker_bp.get("/api/me")
@require_login
def api_me():
    user = get_current_user() or {}
    uid = str(user.get("id", ""))
    subs = _load_json(SUBMISSIONS_FILE)
    teams = _load_json(TEAMS_FILE)
    return jsonify({
        "id": uid,
        "username": user.get("username"),
        "avatar": user.get("avatar"),
        "rank": (subs.get(uid) or {}).get("rank"),
        "submitted_at": (subs.get(uid) or {}).get("submitted_at"),
        "team": teams.get(uid),  # 0 = Amber, 1 = Sapphire
    })


@ranker_bp.post("/api/submit")
@require_login
def api_submit_rank():
    payload = request.get_json(force=True, silent=True) or {}
    rank = (payload.get("rank") or "").strip()
    if not rank:
        return jsonify({"error": "Rank is required"}), 400

    user = get_current_user() or {}
    uid = str(user.get("id", ""))
    username = user.get("full_username") or user.get("username")
    avatar = user.get("avatar")
    subs = _load_json(SUBMISSIONS_FILE)
    subs[uid] = {
        "rank": rank,
        "submitted_at": int(time.time()),
        "username": username,
        "avatar": avatar,
    }
    _save_json(SUBMISSIONS_FILE, subs)
    return jsonify({"ok": True})


@ranker_bp.get("/api/players")
@require_ranker_admin
def api_players():
    subs = _load_json(SUBMISSIONS_FILE)
    teams = _load_json(TEAMS_FILE)
    players = []
    for uid, info in subs.items():
        players.append({
            "id": uid,
            "rank": info.get("rank"),
            "submitted_at": info.get("submitted_at"),
            "team": teams.get(uid),
            "username": info.get("username") or uid,
            "avatar": info.get("avatar"),
        })
    # Sort by submission time descending
    players.sort(key=lambda p: p.get("submitted_at") or 0, reverse=True)
    return jsonify({"players": players})


@ranker_bp.post("/api/assign")
@require_ranker_admin
def api_assign_team():
    payload = request.get_json(force=True, silent=True) or {}
    uid = str(payload.get("id") or "")
    team = payload.get("team")
    if not uid:
        return jsonify({"error": "Missing player id"}), 400
    teams = _load_json(TEAMS_FILE)
    if team in (0, 1):
        teams[uid] = team
    else:
        # Unassign if team not provided
        teams.pop(uid, None)
    _save_json(TEAMS_FILE, teams)
    return jsonify({"ok": True})


@ranker_bp.post("/api/clear")
@require_ranker_admin
def api_clear():
    """Clear all players and team assignments, forcing resubmission."""
    _save_json(SUBMISSIONS_FILE, {})
    _save_json(TEAMS_FILE, {})
    return jsonify({"ok": True})


@ranker_bp.post("/api/remove")
@require_ranker_admin
def api_remove_player():
    """Remove a single player submission (and any team assignment)."""
    payload = request.get_json(force=True, silent=True) or {}
    uid = str(payload.get("id") or "")
    if not uid:
        return jsonify({"error": "Missing player id"}), 400
    subs = _load_json(SUBMISSIONS_FILE)
    teams = _load_json(TEAMS_FILE)
    subs.pop(uid, None)
    teams.pop(uid, None)
    _save_json(SUBMISSIONS_FILE, subs)
    _save_json(TEAMS_FILE, teams)
    return jsonify({"ok": True})
