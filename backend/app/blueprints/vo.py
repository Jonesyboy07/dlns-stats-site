from __future__ import annotations

import csv
import io
import json
import os
import time
from pathlib import Path

import requests
from flask import Blueprint, abort, jsonify, render_template, request, send_from_directory, send_file

from ..utils.auth import get_current_user

vo_bp = Blueprint(
    "vo",
    __name__,
    url_prefix="/vo",
)

DATA_DIR = Path("data")
VO_UPLOADS_DIR = DATA_DIR / "vo_uploads"
VO_MARKDOWN_FILE = VO_UPLOADS_DIR / "content.md"
VO_ASSETS_META_FILE = VO_UPLOADS_DIR / "assets.json"
ADMIN_IDS = {
    "281950593436614656",
    "285203317162770442",
    "950380630905069578",
    "114096996456857609"
}


def _is_admin(user: dict | None) -> bool:
    if not user:
        return False
    return str(user.get("id")) in ADMIN_IDS


def _default_content() -> dict:
    return {
        "markdown": "",
        "assets": {"zip": None, "videos": [], "images": []},
        "updated_at": None,
        "updated_by": None,
    }


def _load_vo_content() -> dict:
    try:
        VO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
        
        # Load markdown content
        markdown = ""
        if VO_MARKDOWN_FILE.exists():
            markdown = VO_MARKDOWN_FILE.read_text(encoding="utf-8")
        
        # Load assets metadata
        assets = {"zip": None, "videos": [], "images": []}
        if VO_ASSETS_META_FILE.exists():
            assets_data = json.loads(VO_ASSETS_META_FILE.read_text(encoding="utf-8"))
            assets.update(assets_data)
        
        # Load last updated metadata
        updated_at = None
        updated_by = None
        if VO_ASSETS_META_FILE.exists():
            meta = json.loads(VO_ASSETS_META_FILE.read_text(encoding="utf-8"))
            updated_at = meta.get("updated_at")
            updated_by = meta.get("updated_by")
        
        return {
            "markdown": markdown,
            "assets": assets,
            "updated_at": updated_at,
            "updated_by": updated_by,
        }
    except Exception:
        pass
    return _default_content()


def _save_vo_content(markdown: str, assets: dict | None, user: dict) -> dict:
    VO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Save markdown to .md file
    VO_MARKDOWN_FILE.write_text(markdown or "", encoding="utf-8")
    
    # Save assets metadata with timestamps
    safe_assets = assets if isinstance(assets, dict) else {}
    safe_assets.setdefault("zip", None)
    safe_assets.setdefault("videos", [])
    safe_assets.setdefault("images", [])
    
    meta = {
        **safe_assets,
        "updated_at": int(time.time()),
        "updated_by": user.get("username") or user.get("global_name") or user.get("name") or str(user.get("id")),
    }
    VO_ASSETS_META_FILE.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
    
    return {
        "markdown": markdown or "",
        "assets": safe_assets,
        "updated_at": meta["updated_at"],
        "updated_by": meta["updated_by"],
    }


@vo_bp.get("/api/tasks")
def api_vo_tasks():
    """Proxy VO spreadsheet as JSON to avoid exposing the CSV URL to clients."""
    sheet_url = os.getenv("VO_SHEET_CSV_URL")
    if not sheet_url:
        return jsonify({"ok": False, "error": "Sheet URL not configured"}), 500

    try:
        resp = requests.get(sheet_url, timeout=10)
        if resp.status_code != 200:
            return jsonify({"ok": False, "error": f"Sheet fetch failed ({resp.status_code})"}), 502
    except Exception as exc:  # noqa: BLE001
        return jsonify({"ok": False, "error": f"Sheet fetch error: {exc}"}), 502

    reader = csv.DictReader(io.StringIO(resp.text))
    tasks = []
    for row in reader:
        tasks.append({
            "title": row.get("Line") or row.get("Title") or row.get("Line ID") or "",
            "owner": row.get("Owner") or row.get("Assignee") or row.get("Assigned To") or "",
            "status": row.get("Status") or row.get("Status ") or row.get("State") or "Open",
            "raw": row,
        })

    return jsonify({"ok": True, "tasks": tasks})


@vo_bp.get("/api/content")
def api_vo_content_get():
    content = _load_vo_content()
    return jsonify({"ok": True, "content": content})


@vo_bp.post("/api/content")
def api_vo_content_save():
    user = get_current_user()
    if not _is_admin(user):
        abort(403)

    payload = request.get_json(silent=True) or {}
    markdown = payload.get("markdown") or payload.get("html") or ""
    assets = payload.get("assets") or {}
    saved = _save_vo_content(markdown, assets, user)
    return jsonify({"ok": True, "content": saved})


@vo_bp.post("/api/upload")
def api_vo_upload():
    """Upload a file (image, video, or zip)."""
    user = get_current_user()
    if not _is_admin(user):
        abort(403)
    
    if 'file' not in request.files:
        return jsonify({"ok": False, "error": "No file provided"}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({"ok": False, "error": "No file selected"}), 400
    
    # Create uploads directory
    VO_UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    
    # Save file
    file_path = VO_UPLOADS_DIR / file.filename
    file.save(str(file_path))
    
    # Return file info
    return jsonify({
        "ok": True,
        "file": {
            "name": file.filename,
            "size": file_path.stat().st_size,
            "type": file.content_type or "",
        }
    })


@vo_bp.get("/uploads/<path:filename>")
def vo_uploads(filename):
    """Serve uploaded files (images, videos, zip)."""
    file_path = VO_UPLOADS_DIR / filename
    
    # Security check - ensure file exists and is in the uploads directory
    if not file_path.exists() or not file_path.is_file():
        abort(404)
    
    # For ZIP files, force download
    if filename.lower().endswith('.zip'):
        return send_file(
            str(file_path),
            as_attachment=True,
            download_name=filename,
            mimetype='application/zip'
        )
    
    # For other files, serve inline
    return send_from_directory(VO_UPLOADS_DIR, filename)


@vo_bp.get("")
def vo_public():
    """Public Community VO hub (React bundle)."""
    return render_template("react.html", page="vo")


@vo_bp.get("/admin")
def vo_admin():
    """Admin-only Community VO management (React bundle)."""
    user = get_current_user()
    if not _is_admin(user):
        abort(403)
    return render_template("react.html", page="vo_admin")
