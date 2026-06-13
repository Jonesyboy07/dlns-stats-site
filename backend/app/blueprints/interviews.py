from __future__ import annotations

import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import markdown
from flask import Blueprint, abort, current_app, jsonify, render_template, request
from werkzeug.utils import secure_filename

from ..utils.auth import get_current_user, is_admin, require_login


interviews_bp = Blueprint("interviews", __name__, url_prefix="/interviews")

DATA_DIR = Path("data") / "interviews"
MARKDOWN_DIR = DATA_DIR / "markdown"
INDEX_FILE = DATA_DIR / "entries.json"

# Requested explicit uploader plus existing owner/admin roles.
EXTRA_UPLOAD_IDS = {"792247424046727179"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ensure_storage() -> None:
    MARKDOWN_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        INDEX_FILE.write_text("[]", encoding="utf-8")


def _load_entries() -> list[dict[str, Any]]:
    _ensure_storage()
    try:
        raw = json.loads(INDEX_FILE.read_text(encoding="utf-8"))
    except Exception:
        current_app.logger.exception("Failed to parse interviews index")
        return []

    if not isinstance(raw, list):
        return []

    entries: list[dict[str, Any]] = []
    for item in raw:
        if not isinstance(item, dict):
            continue
        if not item.get("id") or not item.get("filename"):
            continue
        entries.append(item)

    return entries


def _save_entries(entries: list[dict[str, Any]]) -> None:
    _ensure_storage()
    temp = INDEX_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(entries, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(INDEX_FILE)


def _get_entry(entry_id: str) -> dict[str, Any] | None:
    for entry in _load_entries():
        if str(entry.get("id")) == str(entry_id):
            return entry
    return None


def _entry_markdown_path(entry: dict[str, Any]) -> Path:
    return MARKDOWN_DIR / str(entry.get("filename"))


def _read_entry_markdown(entry: dict[str, Any]) -> str:
    md_path = _entry_markdown_path(entry)
    if not md_path.exists():
        return ""
    try:
        return md_path.read_text(encoding="utf-8")
    except Exception:
        current_app.logger.exception("Failed reading interview markdown", extra={"entry_id": entry.get("id")})
        return ""


def _render_markdown(md_text: str) -> str:
    return markdown.markdown(md_text or "", extensions=["extra", "fenced_code", "tables", "sane_lists"])


def _word_count(md_text: str) -> int:
    return len([w for w in (md_text or "").strip().split() if w])


def _api_error(message: str, status: int = 400):
    return jsonify({"ok": False, "error": message}), status


def _serialize_entry(entry: dict[str, Any], include_body: bool = False) -> dict[str, Any]:
    md_text = _read_entry_markdown(entry)
    payload: dict[str, Any] = {
        "id": entry.get("id"),
        "title": entry.get("title"),
        "guest": entry.get("guest"),
        "created_at": entry.get("created_at"),
        "uploaded_by_id": entry.get("uploaded_by_id"),
        "uploaded_by_name": entry.get("uploaded_by_name"),
        "word_count": _word_count(md_text),
        "char_count": len(md_text),
        "preview": " ".join(md_text.replace("\n", " ").split())[:220],
    }
    if include_body:
        payload["markdown"] = md_text
        payload["html"] = _render_markdown(md_text)
    return payload


def _is_reserved_id(value: str) -> bool:
    return value in {"upload", "api"}


def _build_filename(title: str) -> str:
    safe_title = secure_filename(title).strip("._-")
    if not safe_title:
        safe_title = "interview"
    return f"{datetime.now(timezone.utc).strftime('%Y%m%d-%H%M%S')}-{safe_title}.md"


def _title_from_filename(filename: str) -> str:
    stem = Path(filename or "").stem
    if not stem:
        return "Interview"
    cleaned = stem.replace("_", " ").replace("-", " ").strip()
    if not cleaned:
        return "Interview"
    return " ".join(part.capitalize() for part in cleaned.split())


def _user_can_upload() -> bool:
    user = get_current_user()
    if not user:
        return False

    user_id = str(user.get("id") or "")
    if not user_id:
        return False

    if is_admin(user_id):
        return True

    return user_id in EXTRA_UPLOAD_IDS


@interviews_bp.get("/")
def index() -> str:
    return render_template("react.html", page="interviews")


@interviews_bp.get("/upload")
@require_login
def upload_page() -> str:
    if not _user_can_upload():
        abort(403)
    return render_template("react.html", page="interviews_admin")


@interviews_bp.get("/api/access")
def api_access():
    user = get_current_user()
    return jsonify(
        {
            "ok": True,
            "logged_in": bool(user),
            "can_upload": _user_can_upload(),
            "user": user,
        }
    )


@interviews_bp.get("/api/list")
def api_list():
    entries = sorted(
        _load_entries(),
        key=lambda e: str(e.get("created_at") or ""),
        reverse=True,
    )
    return jsonify({"ok": True, "entries": [_serialize_entry(entry, include_body=False) for entry in entries]})


@interviews_bp.get("/api/entry/<entry_id>")
def api_entry(entry_id: str):
    entry = _get_entry(entry_id)
    if not entry:
        return _api_error("Interview not found", 404)
    return jsonify({"ok": True, "entry": _serialize_entry(entry, include_body=True)})


@interviews_bp.post("/api/upload")
@require_login
def api_upload() -> Any:
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    title = (request.form.get("title") or "").strip()
    guest = (request.form.get("guest") or "").strip()
    md_content = (request.form.get("md_content") or "").strip()
    md_file = request.files.get("md_file")

    if md_file and md_file.filename:
        if not md_file.filename.lower().endswith(".md"):
            return _api_error("Only .md files are allowed")

        try:
            file_text = md_file.read().decode("utf-8")
        except Exception:
            return _api_error("Could not read markdown file. Use UTF-8.")
        md_content = file_text.strip()

        # QOL: allow direct .md-only upload by deriving sane defaults.
        if not title:
            title = _title_from_filename(md_file.filename)
        if not guest:
            guest = "Unknown Guest"

    if not title:
        return _api_error("Title is required")

    if not guest:
        return _api_error("Guest is required")

    if not md_content:
        return _api_error("Interview markdown content is required")

    user = get_current_user() or {}
    created_at = _now_iso()
    entry_id = str(uuid.uuid4())
    filename = _build_filename(title)

    _ensure_storage()
    md_path = MARKDOWN_DIR / filename

    while md_path.exists():
        filename = _build_filename(f"{title}-{entry_id[:8]}")
        md_path = MARKDOWN_DIR / filename

    try:
        md_path.write_text(md_content, encoding="utf-8")

        entries = _load_entries()
        entries.append(
            {
                "id": entry_id,
                "title": title,
                "guest": guest,
                "filename": filename,
                "created_at": created_at,
                "uploaded_by_id": str(user.get("id") or ""),
                "uploaded_by_name": str(user.get("username") or user.get("name") or "Unknown"),
            }
        )
        _save_entries(entries)
        return jsonify({"ok": True, "entry": _serialize_entry(entries[-1], include_body=True)})
    except Exception:
        current_app.logger.exception("Failed to save interview entry")
        return _api_error("Upload failed", 500)


@interviews_bp.patch("/api/entry/<entry_id>")
@require_login
def api_update_entry(entry_id: str):
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    payload = request.get_json(silent=True) or {}
    title = str(payload.get("title") or "").strip()
    guest = str(payload.get("guest") or "").strip()
    md_content = payload.get("md_content")

    entries = _load_entries()
    target: dict[str, Any] | None = None
    for entry in entries:
        if str(entry.get("id")) == str(entry_id):
            target = entry
            break

    if not target:
        return _api_error("Interview not found", 404)

    if title:
        target["title"] = title
    if guest:
        target["guest"] = guest

    if isinstance(md_content, str):
        md_path = _entry_markdown_path(target)
        try:
            md_path.write_text(md_content, encoding="utf-8")
        except Exception:
            current_app.logger.exception("Failed updating markdown file", extra={"entry_id": entry_id})
            return _api_error("Failed to update markdown", 500)

    _save_entries(entries)
    return jsonify({"ok": True, "entry": _serialize_entry(target, include_body=True)})


@interviews_bp.delete("/api/entry/<entry_id>")
@require_login
def api_delete_entry(entry_id: str):
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    entries = _load_entries()
    target: dict[str, Any] | None = None
    remaining: list[dict[str, Any]] = []
    for entry in entries:
        if str(entry.get("id")) == str(entry_id):
            target = entry
        else:
            remaining.append(entry)

    if not target:
        return _api_error("Interview not found", 404)

    md_path = _entry_markdown_path(target)
    try:
        if md_path.exists():
            md_path.unlink()
    except Exception:
        current_app.logger.warning("Failed deleting markdown file", extra={"entry_id": entry_id}, exc_info=True)

    _save_entries(remaining)
    return jsonify({"ok": True})


@interviews_bp.get("/<entry_id>")
def detail(entry_id: str) -> str:
    if _is_reserved_id(entry_id):
        abort(404)
    return render_template("react.html", page="interviews")
