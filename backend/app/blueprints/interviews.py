from __future__ import annotations

import json
import re
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import markdown
from flask import Blueprint, abort, current_app, jsonify, redirect, render_template, request, url_for
from werkzeug.utils import secure_filename

from ..utils.auth import get_current_user, is_admin, require_login


interviews_bp = Blueprint("interviews", __name__, url_prefix="/interviews")

DATA_DIR = Path("data") / "interviews"
MARKDOWN_DIR = DATA_DIR / "markdown"
INDEX_FILE = DATA_DIR / "entries.json"
CUSTOM_LINKS_FILE = DATA_DIR / "custom_links.json"

# Requested explicit uploader plus existing owner/admin roles.
EXTRA_UPLOAD_IDS = {"792247424046727179"}


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _ensure_storage() -> None:
    MARKDOWN_DIR.mkdir(parents=True, exist_ok=True)
    if not INDEX_FILE.exists():
        INDEX_FILE.write_text("[]", encoding="utf-8")
    if not CUSTOM_LINKS_FILE.exists():
        CUSTOM_LINKS_FILE.write_text("{}", encoding="utf-8")


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

    if _ensure_short_ids(entries):
        _save_entries(entries)

    return entries


def _ensure_short_ids(entries: list[dict[str, Any]]) -> bool:
    changed = False
    used: set[int] = set()

    for entry in entries:
        value = str(entry.get("short_id") or "").strip()
        if value.isdigit() and int(value) > 0:
            used.add(int(value))

    next_id = 1
    ordered = sorted(entries, key=lambda e: str(e.get("created_at") or e.get("id") or ""))
    for entry in ordered:
        value = str(entry.get("short_id") or "").strip()
        if value.isdigit() and int(value) > 0:
            continue
        while next_id in used:
            next_id += 1
        entry["short_id"] = str(next_id)
        used.add(next_id)
        changed = True

    return changed


def _next_short_id(entries: list[dict[str, Any]]) -> str:
    max_id = 0
    for entry in entries:
        value = str(entry.get("short_id") or "").strip()
        if value.isdigit() and int(value) > max_id:
            max_id = int(value)
    return str(max_id + 1)


def _normalize_alias(value: str) -> str:
    return str(value or "").strip().lower()


def _is_valid_alias(value: str) -> bool:
    alias = _normalize_alias(value)
    if alias in {"", "upload", "api"}:
        return False
    if alias.isdigit():
        return False
    return bool(re.fullmatch(r"[a-z][a-z0-9_-]{1,39}", alias))


def _load_custom_links() -> dict[str, str]:
    _ensure_storage()
    try:
        raw = json.loads(CUSTOM_LINKS_FILE.read_text(encoding="utf-8"))
    except Exception:
        current_app.logger.exception("Failed to parse custom links")
        return {}

    if not isinstance(raw, dict):
        return {}

    clean: dict[str, str] = {}
    for alias, entry_id in raw.items():
        norm_alias = _normalize_alias(alias)
        if not _is_valid_alias(norm_alias):
            continue
        if not isinstance(entry_id, str) or not entry_id:
            continue
        clean[norm_alias] = entry_id
    return clean


def _save_custom_links(links: dict[str, str]) -> None:
    _ensure_storage()
    temp = CUSTOM_LINKS_FILE.with_suffix(".tmp")
    temp.write_text(json.dumps(links, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(CUSTOM_LINKS_FILE)


def _entry_custom_aliases(entry_id: str) -> list[str]:
    links = _load_custom_links()
    return sorted([alias for alias, target_id in links.items() if str(target_id) == str(entry_id)])


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
        "short_id": str(entry.get("short_id") or ""),
        "short_path": f"/interviews/{entry.get('short_id')}",
        "word_count": _word_count(md_text),
        "char_count": len(md_text),
        "preview": " ".join(md_text.replace("\n", " ").split())[:220],
        "custom_links": _entry_custom_aliases(str(entry.get("id") or "")),
    }
    if include_body:
        payload["markdown"] = md_text
        payload["html"] = _render_markdown(md_text)
    return payload


def _is_reserved_id(value: str) -> bool:
    return value in {"upload", "api"}


def _resolve_entry_ref(ref: str) -> tuple[dict[str, Any] | None, str | None]:
    token = str(ref or "").strip()
    entries = _load_entries()

    for entry in entries:
        if str(entry.get("id")) == token:
            return entry, "id"

    for entry in entries:
        if str(entry.get("short_id") or "") == token:
            return entry, "short"

    alias = _normalize_alias(token)
    links = _load_custom_links()
    target_id = links.get(alias)
    if target_id:
        for entry in entries:
            if str(entry.get("id")) == str(target_id):
                return entry, "alias"

    return None, None


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
    entry, _ = _resolve_entry_ref(entry_id)
    if not entry:
        return _api_error("Interview not found", 404)
    return jsonify({"ok": True, "entry": _serialize_entry(entry, include_body=True)})


@interviews_bp.get("/api/custom-links")
@require_login
def api_custom_links_list():
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    links = _load_custom_links()
    entries = {str(entry.get("id")): entry for entry in _load_entries()}
    result: list[dict[str, Any]] = []
    for alias, target_id in sorted(links.items(), key=lambda kv: kv[0]):
        entry = entries.get(str(target_id))
        if not entry:
            continue
        short_id = str(entry.get("short_id") or "")
        result.append(
            {
                "alias": alias,
                "entry_id": str(entry.get("id")),
                "short_id": short_id,
                "title": entry.get("title"),
                "path": f"/interviews/{alias}",
                "target_path": f"/interviews/{short_id}",
            }
        )

    return jsonify({"ok": True, "links": result})


@interviews_bp.post("/api/custom-links")
@require_login
def api_custom_links_create():
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    payload = request.get_json(silent=True) or {}
    alias = _normalize_alias(payload.get("alias"))
    entry_id = str(payload.get("entry_id") or "").strip()

    if not _is_valid_alias(alias):
        return _api_error("Alias must start with a letter and contain only a-z, 0-9, _ or -")

    entry = _get_entry(entry_id)
    if not entry:
        return _api_error("Interview not found", 404)

    links = _load_custom_links()
    links[alias] = str(entry.get("id"))
    _save_custom_links(links)
    return jsonify({"ok": True, "alias": alias, "entry_id": str(entry.get("id"))})


@interviews_bp.delete("/api/custom-links/<alias>")
@require_login
def api_custom_links_delete(alias: str):
    if not _user_can_upload():
        return _api_error("Upload permissions required", 403)

    norm_alias = _normalize_alias(alias)
    links = _load_custom_links()
    if norm_alias not in links:
        return _api_error("Alias not found", 404)

    links.pop(norm_alias, None)
    _save_custom_links(links)
    return jsonify({"ok": True})


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
        short_id = _next_short_id(entries)
        entries.append(
            {
                "id": entry_id,
            "short_id": short_id,
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

    links = _load_custom_links()
    next_links = {alias: target_id for alias, target_id in links.items() if str(target_id) != str(target.get("id"))}
    if next_links != links:
        _save_custom_links(next_links)

    return jsonify({"ok": True})


@interviews_bp.get("/<entry_id>")
def detail(entry_id: str) -> str:
    if _is_reserved_id(entry_id):
        abort(404)

    entry, source = _resolve_entry_ref(entry_id)
    if not entry:
        abort(404)

    if source == "id":
        return redirect(url_for("interviews.detail", entry_id=str(entry.get("short_id") or entry_id)), code=302)

    return render_template("react.html", page="interviews")
