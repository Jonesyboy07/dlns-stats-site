import os
import json
from flask import (
    Blueprint, render_template, request, redirect,
    url_for, session, flash, current_app
)
from datetime import datetime

submission_bp = Blueprint('submission', __name__, template_folder='templates')

DATA_PATH = os.path.join("data", "guesstherank.json")


def load_data():
    if not os.path.exists(DATA_PATH):
        return {}
    try:
        with open(DATA_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    except:
        return {}


def save_data(data):
    os.makedirs("data", exist_ok=True)
    with open(DATA_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)


def require_login(next_url):
    flash("Please login with Discord first.", "error")
    return redirect(url_for("auth.login", next=next_url))


@submission_bp.route("/gtr/submission", methods=["GET", "POST"])
def submission_form():
    user = session.get("discord_user")

    # Not logged in? redirect & remember where user wanted to go
    if not user:
        return require_login(request.path)

    discord_id = str(user["id"])
    data = load_data()

    existing = data.get(discord_id, {})

    if request.method == "POST":
        played_hero = request.form.get("played_hero", "").strip()
        times_played = request.form.get("times_played", "").strip()
        rank = request.form.get("rank", "").strip()
        match_id = request.form.get("match_id", "").strip()
        match_date = request.form.get("match_date", "").strip()
        timestamps = request.form.get("timestamps", "").strip()

        # Basic validation
        if not played_hero or not times_played or not rank or not match_id or not match_date:
            flash("Please fill all required fields.", "error")
            return redirect(request.url)

        data[discord_id] = {
            "discord_id": discord_id,
            "username": user.get("full_username", user.get("username")),
            "played_hero": played_hero,
            "times_played_last_two_weeks": times_played,
            "rank": rank,
            "match_id": match_id,
            "match_date": match_date,
            "timestamps": timestamps if timestamps else None,
            "last_updated": datetime.utcnow().isoformat()
        }

        save_data(data)

        flash("Submission saved successfully!", "success")
        return redirect(url_for("submission.submission_form"))

    return render_template("gtr_submission.html", existing=existing, user=user)

ADMIN_IDS = {
    "950380630905069578",
    "987654321098765432"
}


@submission_bp.route("/gtr/admin")
def admin_panel():
    user = session.get("discord_user")

    if not user:
        flash("Login required", "error")
        return redirect(url_for("auth_bp.login", next=request.path))

    discord_id = str(user.get("id"))

    if discord_id not in ADMIN_IDS:
        flash("You do not have permission to view this page.", "error")
        return redirect(url_for("index"))

    data = load_data()

    # Convert to list for template
    submissions = list(data.values())

    return render_template("gtr_admin.html", submissions=submissions)
