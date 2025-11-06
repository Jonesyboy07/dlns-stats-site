from __future__ import annotations
import os
import json
import shutil
from datetime import datetime
from pathlib import Path
from flask import (
    Blueprint, render_template, request, redirect,
    url_for, flash, current_app, abort, send_from_directory
)
from utils.auth import require_login, get_current_user

filehub_bp = Blueprint("filehub", __name__, url_prefix="/filehub")

# === Configuration ===
ROOT_DIR = Path(current_app.root_path).parent if current_app else Path(os.getcwd())
FILEHUB_DIR = ROOT_DIR / "filehub"
MAX_STORAGE_BYTES = 500 * 1024 * 1024  # 500 MB per user total
MAX_UPLOAD_BYTES = 500 * 1024 * 1024   # 500 MB per single upload

FILEHUB_DIR.mkdir(exist_ok=True)


# === Helper Functions ===
def get_user_id() -> str | None:
    user = get_current_user()
    if not user:
        return None
    return str(user.get("id") if isinstance(user, dict) else getattr(user, "id", None))


def get_user_folder(user_id: str) -> Path:
    """Get (and create if needed) a user's filehub directory."""
    folder = FILEHUB_DIR / user_id
    folder.mkdir(parents=True, exist_ok=True)
    return folder


def get_access_file(owner_id: str) -> Path:
    """Return the path to a user's private access.json file."""
    return get_user_folder(owner_id) / "access.json"


def load_access_list(owner_id: str) -> list[str]:
    """Load the owner's access.json (list of allowed IDs)."""
    access_file = get_access_file(owner_id)
    if not access_file.exists():
        return []
    try:
        return json.loads(access_file.read_text(encoding="utf-8"))
    except Exception:
        return []


def save_access_list(owner_id: str, access_list: list[str]):
    """Save the owner's access.json."""
    access_file = get_access_file(owner_id)
    access_file.write_text(json.dumps(access_list, indent=2), encoding="utf-8")


def user_has_access(user_id: str, owner_id: str) -> bool:
    """Check if a user has access to another user's files."""
    if user_id == owner_id:
        return True
    allowed_ids = load_access_list(owner_id)
    return user_id in allowed_ids


def get_folder_size(folder: Path) -> int:
    """Return total size of all files in a folder (excluding access.json)."""
    total = 0
    for path in folder.rglob("*"):
        if path.is_file() and path.name != "access.json":
            total += path.stat().st_size
    return total


# === Routes ===

@filehub_bp.route("/")
@require_login
def index():
    """Show user's hub overview."""
    user_id = get_user_id()
    user = get_current_user()

    if not user_id:
        return redirect(url_for("auth.login"))

    folder = get_user_folder(user_id)
    used = get_folder_size(folder)
    percent = round((used / MAX_STORAGE_BYTES) * 100, 2)

    return render_template(
        "filehub/index.html",
        user_id=user_id,
        user=user,                # ✅ Pass user to Jinja
        used=used,
        max_storage=MAX_STORAGE_BYTES,
        percent=percent,
        datetime=datetime          # ✅ So {{ datetime.utcnow() }} works
    )


@filehub_bp.route("/<owner_id>")
@require_login
def view_owner(owner_id):
    """View another user's shared files (if allowed)."""
    user = get_current_user()
    user_id = get_user_id()
    if not user_id:
        return redirect(url_for("auth.login"))

    if not user_has_access(user_id, owner_id):
        flash("You don't have access to this file hub.", "error")
        return redirect(url_for("home"))

    owner_dir = get_user_folder(owner_id)
    used = get_folder_size(owner_dir)
    percent = round((used / MAX_STORAGE_BYTES) * 100, 2)

    files = []
    for f in owner_dir.iterdir():
        if f.is_file() and f.name != "access.json":  # hide internal JSON
            files.append({
                "name": f.name,
                "size": f.stat().st_size,
                "modified": datetime.fromtimestamp(f.stat().st_mtime).strftime("%Y-%m-%d %H:%M"),
            })
    access_list = load_access_list(owner_id)
    return render_template(
        "filehub/view.html",
        owner_id=owner_id,
        files=files,
        user=user,
        used=used,                 # ✅ Added
        max_storage=MAX_STORAGE_BYTES,  # ✅ Added
        percent=percent,           # ✅ Added
        access_list=access_list,
        datetime=datetime
    )



@filehub_bp.route("/<owner_id>/upload", methods=["GET", "POST"])
@require_login
def upload(owner_id):
    """Upload file if user is the owner (limit 500MB total & per file)."""
    user = get_current_user()
    user_id = get_user_id()
    if not user_id:
        return redirect(url_for("auth.login"))

    if user_id != owner_id:
        flash("You can only upload to your own hub.", "error")
        return redirect(url_for("filehub.view_owner", owner_id=owner_id))

    if request.method == "POST":
        if "file" not in request.files:
            flash("No file selected", "error")
            return redirect(request.url)
        file = request.files["file"]
        if file.filename == "":
            flash("No file selected", "error")
            return redirect(request.url)

        user_folder = get_user_folder(user_id)

        # --- Get sizes ---
        current_size = get_folder_size(user_folder)
        file.seek(0, os.SEEK_END)
        file_size = file.tell()
        file.seek(0)

        # --- Check limits ---
        if file_size > MAX_UPLOAD_BYTES:
            flash("File exceeds the 500 MB upload limit.", "error")
            return redirect(url_for("filehub.view_owner", owner_id=user_id))

        if current_size + file_size > MAX_STORAGE_BYTES:
            flash("Storage limit reached (max 500 MB per user). Delete old files to upload new ones.", "error")
            return redirect(url_for("filehub.view_owner", owner_id=user_id))

        # --- Save file ---
        file_path = user_folder / file.filename
        if file_path.exists():
            backup = user_folder / f"{file.stem}_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}{file.suffix}"
            shutil.copy2(file_path, backup)

        file.save(file_path)
        flash("File uploaded successfully!", "success")
        current_app.logger.info(f"File uploaded by {user_id}: {file.filename}")

        return redirect(url_for("filehub.view_owner", owner_id=user_id))

    return render_template("filehub/upload.html", owner_id=owner_id, user=user, datetime=datetime)


@filehub_bp.route("/<owner_id>/grant", methods=["POST"])
@require_login
def grant_access(owner_id):
    """Allow owner to grant access to another Discord ID."""
    user_id = get_user_id()
    if not user_id:
        return redirect(url_for("auth.login"))

    if user_id != owner_id:
        abort(403)

    target_id = request.form.get("discord_id")
    if not target_id:
        flash("Missing Discord ID.", "error")
        return redirect(url_for("filehub.view_owner", owner_id=owner_id))

    access_list = load_access_list(owner_id)
    if target_id not in access_list:
        access_list.append(target_id)
        save_access_list(owner_id, access_list)
        flash(f"Granted access to {target_id}", "success")
    else:
        flash("User already has access.", "info")

    return redirect(url_for("filehub.view_owner", owner_id=owner_id))


@filehub_bp.route("/<owner_id>/revoke", methods=["POST"])
@require_login
def revoke_access(owner_id):
    """Allow owner to revoke access."""
    user_id = get_user_id()
    if not user_id:
        return redirect(url_for("auth.login"))

    if user_id != owner_id:
        abort(403)

    target_id = request.form.get("discord_id")
    if not target_id:
        flash("Missing Discord ID.", "error")
        return redirect(url_for("filehub.view_owner", owner_id=owner_id))

    access_list = load_access_list(owner_id)
    if target_id in access_list:
        access_list.remove(target_id)
        save_access_list(owner_id, access_list)
        flash(f"Revoked access for {target_id}", "success")

    return redirect(url_for("filehub.view_owner", owner_id=owner_id))


@filehub_bp.route("/<owner_id>/download/<filename>")
@require_login
def download(owner_id, filename):
    """Download a file if user has permission."""
    user_id = get_user_id()
    if not user_id:
        return redirect(url_for("auth.login"))

    if not user_has_access(user_id, owner_id):
        flash("You don't have permission to download this file.", "error")
        return redirect(url_for("home"))

    owner_dir = get_user_folder(owner_id)
    file_path = owner_dir / filename
    if not file_path.exists() or file_path.name == "access.json":
        abort(404, "File not found")

    return send_from_directory(owner_dir, filename, as_attachment=True)
