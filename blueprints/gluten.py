from __future__ import annotations

import json
import uuid
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from flask import (
    Blueprint,
    render_template,
    send_file,
    jsonify,
    current_app,
    abort,
    request,
    flash,
    redirect,
    url_for,
)

from utils.auth import require_login, get_current_user
from dotenv import load_dotenv
import os

# ---------------------------------------------------------------------------
# Blueprint & Constants
# ---------------------------------------------------------------------------

gluten_bp = Blueprint("gluten", __name__, url_prefix="/gluten")

MOD_FILES_SUBDIR = "mods"
MODS_DATA_FILENAME = "mods.json"

INSTALLER_PY_FILENAME = "mod_installer.py"
INSTALLER_EXE_FILENAME = "mod_installer.exe"

load_dotenv()
VERSION = os.getenv("INSTALLER_VERSION", "1.0.0")

# ---------------------------------------------------------------------------
# Helpers: permissions
# ---------------------------------------------------------------------------


def _get_user_id_and_name() -> tuple[Optional[str], Optional[str]]:
    """Return (user_id_str, username) from current user."""
    user = get_current_user()
    if not user:
        return None, None

    if isinstance(user, dict):
        user_id = user.get("id")
        username = user.get("username") or user.get("name")
    else:
        user_id = getattr(user, "id", None)
        username = getattr(user, "username", None) or getattr(
            user, "name", None
        )

    user_id_str = str(user_id) if user_id is not None else None
    return user_id_str, username or "Unknown"


def is_mod_uploader() -> bool:
    """Check if current user can upload or delete mods."""
    user_id_str, _ = _get_user_id_and_name()
    current_app.logger.info(
        f"Checking mod upload permission for user_id={user_id_str}"
    )

    if not user_id_str:
        return False

    owner_id = current_app.config.get("DISCORD_OWNER_ID")
    raw_list = current_app.config.get("DISCORD_MOD_UPLOADER_IDS", "")

    allowed_ids: set[str] = set()

    if owner_id:
        allowed_ids.add(str(owner_id))

    if isinstance(raw_list, (list, tuple, set)):
        allowed_ids.update(str(x).strip() for x in raw_list)
    else:
        for entry in str(raw_list).split(","):
            entry = entry.strip()
            if entry:
                allowed_ids.add(entry)

    result = user_id_str in allowed_ids
    current_app.logger.info(f"Permission result: {result}")
    return result


def require_mod_upload_permission(f):
    """Decorator to restrict access to mod upload / delete."""

    def decorated_function(*args, **kwargs):
        if not is_mod_uploader():
            user_id_str, _ = _get_user_id_and_name()
            current_app.logger.warning(
                f"Mod upload permission denied (user_id={user_id_str})"
            )
            abort(403, "You don't have permission to manage mods")
        return f(*args, **kwargs)

    decorated_function.__name__ = f.__name__
    return decorated_function

# ---------------------------------------------------------------------------
# Helpers: storage
# ---------------------------------------------------------------------------


def get_mod_files_dir() -> Path:
    """Directory where .vpk mod files are stored."""
    static_dir = Path(current_app.static_folder)
    mods_dir = static_dir / MOD_FILES_SUBDIR
    mods_dir.mkdir(parents=True, exist_ok=True)
    return mods_dir


def get_mods_data_path() -> Path:
    """Path to mods.json file inside instance folder."""
    data_dir = Path(current_app.instance_path)
    data_dir.mkdir(parents=True, exist_ok=True)
    return data_dir / MODS_DATA_FILENAME


def load_mods() -> List[Dict[str, Any]]:
    """Load mods metadata."""
    path = get_mods_data_path()
    if not path.exists():
        return []

    try:
        with open(path, "r", encoding="utf-8") as f:
            raw = json.load(f)

        if isinstance(raw, list):
            mods = raw
        elif isinstance(raw, dict):
            mods = raw.get("mods", [])
        else:
            mods = []

        cleaned = []
        for m in mods:
            if (
                isinstance(m, dict)
                and "id" in m
                and "title" in m
                and "stored_filename" in m
            ):
                cleaned.append(m)

        return cleaned

    except Exception as e:
        current_app.logger.error("Error loading mods.json", exc_info=True)
        return []


def save_mods(mods: List[Dict[str, Any]]) -> None:
    """Write metadata safely."""
    path = get_mods_data_path()
    tmp_path = path.with_suffix(".tmp")

    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump({"mods": mods}, f, indent=2)
        tmp_path.replace(path)
    except Exception:
        current_app.logger.error("Error writing mods.json", exc_info=True)


def find_mod_by_id(mod_id: str) -> Optional[Dict[str, Any]]:
    """Lookup mod by ID."""
    for m in load_mods():
        if str(m.get("id")) == str(mod_id):
            return m
    return None

# ---------------------------------------------------------------------------
# Pages
# ---------------------------------------------------------------------------


@gluten_bp.route("/")
def index():
    """Public mods page."""
    user = get_current_user()
    can_upload = is_mod_uploader()

    mods = load_mods()
    mods_sorted = sorted(
        mods, key=lambda m: m.get("uploaded_at", ""), reverse=True
    )

    return render_template(
        "gluten/index.html",
        user=user,
        mods=mods_sorted,
        can_upload=can_upload,
        mod_files_subdir=MOD_FILES_SUBDIR,
    )


@gluten_bp.route("/upload")
@require_login
@require_mod_upload_permission
def upload_page():
    mods = load_mods()
    mods_sorted = sorted(
        mods, key=lambda m: m.get("uploaded_at", ""), reverse=True
    )
    return render_template(
        "gluten/upload.html",
        mods=mods_sorted,
        mod_files_subdir=MOD_FILES_SUBDIR,
    )

# ---------------------------------------------------------------------------
# Upload / delete
# ---------------------------------------------------------------------------


@gluten_bp.route("/upload", methods=["POST"])
@require_login
@require_mod_upload_permission
def handle_upload():
    if "pak_file" not in request.files:
        flash("No file selected", "error")
        return redirect(url_for("gluten.upload_page"))

    f = request.files["pak_file"]
    title = (request.form.get("title") or "").strip()

    if not f.filename:
        flash("No file selected", "error")
        return redirect(url_for("gluten.upload_page"))

    if not title:
        flash("Title is required", "error")
        return redirect(url_for("gluten.upload_page"))

    if not f.filename.lower().endswith(".vpk"):
        flash("Only .vpk files allowed", "error")
        return redirect(url_for("gluten.upload_page"))

    try:
        mods_dir = get_mod_files_dir()
        mod_id = str(uuid.uuid4())
        stored_filename = f"{mod_id}.vpk"
        dest = mods_dir / stored_filename

        while dest.exists():
            mod_id = str(uuid.uuid4())
            stored_filename = f"{mod_id}.vpk"
            dest = mods_dir / stored_filename

        f.save(dest)

        user_id_str, username = _get_user_id_and_name()

        mod = {
            "id": mod_id,
            "title": title,
            "original_filename": f.filename,
            "stored_filename": stored_filename,
            "uploaded_at": datetime.utcnow().isoformat() + "Z",
            "uploaded_by_id": user_id_str,
            "uploaded_by_name": username,
            "size": dest.stat().st_size,
        }

        mods = load_mods()
        mods.append(mod)
        save_mods(mods)

        flash("Uploaded successfully!", "success")

    except Exception as e:
        current_app.logger.error("Upload error", exc_info=True)
        flash("Upload failed", "error")

    return redirect(url_for("gluten.upload_page"))


@gluten_bp.route("/delete/<mod_id>", methods=["POST"])
@require_login
@require_mod_upload_permission
def delete_mod(mod_id: str):
    mods = load_mods()

    remaining = []
    removed = None

    for m in mods:
        if str(m.get("id")) == mod_id:
            removed = m
        else:
            remaining.append(m)

    if not removed:
        flash("Mod not found", "error")
        return redirect(url_for("gluten.upload_page"))

    try:
        stored = removed.get("stored_filename")
        if stored:
            file_path = get_mod_files_dir() / stored
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception:
                    current_app.logger.warning(
                        f"Could not delete {file_path}", exc_info=True
                    )

        save_mods(remaining)
        flash("Mod deleted", "success")

    except Exception:
        current_app.logger.error("Delete error", exc_info=True)
        flash("Delete failed", "error")

    return redirect(url_for("gluten.upload_page"))

# ---------------------------------------------------------------------------
# Downloads
# ---------------------------------------------------------------------------


@gluten_bp.route("/download/mod/<mod_id>")
def download_mod(mod_id: str):
    mod = find_mod_by_id(mod_id)
    if not mod:
        abort(404)

    path = get_mod_files_dir() / mod["stored_filename"]
    if not path.exists():
        abort(404)

    return send_file(
        path,
        as_attachment=True,
        download_name=mod.get("original_filename")
        or f"{mod_id}.vpk",
        mimetype="application/octet-stream",
    )


@gluten_bp.route("/download/installer")
def download_installer_py():
    path = (
        Path(current_app.static_folder) / INSTALLER_PY_FILENAME
    )
    if not path.exists():
        abort(404)

    return send_file(
        path,
        as_attachment=True,
        download_name=INSTALLER_PY_FILENAME,
        mimetype="text/x-python",
    )


@gluten_bp.route("/download/exe")
def download_installer_exe():
    path = (
        Path(current_app.static_folder) / INSTALLER_EXE_FILENAME
    )
    if not path.exists():
        abort(404)

    return send_file(
        path,
        as_attachment=True,
        download_name=INSTALLER_EXE_FILENAME,
        mimetype="application/octet-stream",
    )

# ---------------------------------------------------------------------------
# Installer Source Viewer
# ---------------------------------------------------------------------------


@gluten_bp.route("/source")
def view_source():
    path = Path(current_app.static_folder) / INSTALLER_PY_FILENAME

    if not path.exists():
        abort(404, "Installer script not found")

    try:
        with open(path, "r", encoding="utf-8") as f:
            code = f.read()

        return render_template("gluten/source.html", source_code=code)

    except Exception:
        current_app.logger.error("Source viewer error", exc_info=True)
        abort(500)

# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


@gluten_bp.route("/api/mods")
def api_mods():
    mods = sorted(
        load_mods(), key=lambda m: m.get("uploaded_at", ""), reverse=True
    )

    for m in mods:
        m["download_url"] = url_for(
            "gluten.download_mod",
            mod_id=m["id"],
            _external=True,
        )

    return jsonify({"mods": mods})


@gluten_bp.route("/api/check")
def api_check():
    py_path = (
        Path(current_app.static_folder) / INSTALLER_PY_FILENAME
    )
    exe_path = (
        Path(current_app.static_folder) / INSTALLER_EXE_FILENAME
    )

    mods = load_mods()
    latest_time = (
        sorted(
            mods,
            key=lambda m: m.get("uploaded_at", ""),
            reverse=True,
        )[0].get("uploaded_at")
        if mods
        else None
    )

    return jsonify(
        {
            "installer_py_available": py_path.exists(),
            "installer_exe_available": exe_path.exists(),
            "mods_count": len(mods),
            "latest_mod_uploaded_at": latest_time,
        }
    )


@gluten_bp.route("/api/version")
def version_api():
    return jsonify({"version": VERSION})
