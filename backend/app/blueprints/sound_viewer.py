# ruff: noqa
from __future__ import annotations
import os, mimetypes, time, random, subprocess, hashlib, logging, json, threading, shutil, io, zipfile, sqlite3
from pathlib import Path
from urllib.parse import quote
from flask import (
    Blueprint, jsonify, send_file, abort, render_template,
    Response, stream_with_context, request, current_app
)
from werkzeug.utils import secure_filename
from ..utils.auth import get_current_user

# =====================================================
# ---------------- CONFIGURATION ----------------
# =====================================================
MEDIA_ROOT = Path("static/sounds").resolve()
CACHE_DIR = Path("_cache").resolve()
RECORDED_ROOT = Path("data/recorded").resolve()
UPLOAD_LOG = RECORDED_ROOT / "_uploads.json"
UPLOAD_DB = Path("data/sounds_uploads.sqlite3").resolve()

TRANSCODE_ENABLED = True
CACHE_TRANSCODE = True
TRANSCODE_FORMAT_NON_MP3 = "opus"
TRANSCODE_BITRATE = "96k"
RESAMPLE_HZ = 48000
CACHE_TTL = 12 * 3600
ALLOWED_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}

# Admin user IDs (easy to add more)
ADMIN_USER_IDS = [
    "281950593436614656",
    "285203317162770442",
    "950380630905069578",
    "114096996456857609"
]

# =====================================================
# ---------------- LOGGING ----------------
# =====================================================
log = logging.getLogger("wavebox")
if not log.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        datefmt="%H:%M:%S",
    )

FFMPEG_BIN = shutil.which("ffmpeg") or "C:\\ffmpeg\\bin\\ffmpeg.exe"
if not Path(FFMPEG_BIN).exists():
    log.warning(f"⚠️ FFmpeg not found at {FFMPEG_BIN}")
else:
    log.info(f"🎬 Using FFmpeg: {FFMPEG_BIN}")

# =====================================================
# ---------------- BLUEPRINT ----------------
# =====================================================
wavebox_bp = Blueprint(
    "wavebox",
    __name__,
    url_prefix="/sounds",
    template_folder="templates/sounds"
)
for d in (MEDIA_ROOT, CACHE_DIR, RECORDED_ROOT):
    d.mkdir(parents=True, exist_ok=True)

_cache_state = {"last_hash": ""}
_backup_state = {"started": False}
_upload_log_lock = threading.RLock()
_uploads_db_ready = False
_backup_sync_state = {"running": False, "last_started": 0}

# =====================================================
# ---------------- CACHE UTILITIES ----------------
# =====================================================
def _safe_cache_key(key: str) -> str:
    key = key.replace("/", "_").replace("\\", "_").replace("..", ".")
    if len(key) > 160:
        h = hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]
        key = key[:140] + "-" + h
    return key

def _cache_path_for(key: str) -> Path:
    return CACHE_DIR / f"{_safe_cache_key(key)}.json"

def disk_cache_get(key: str, ttl: int = CACHE_TTL):
    p = _cache_path_for(key)
    try:
        if p.exists():
            age = time.time() - p.stat().st_mtime
            if age < ttl:
                return json.loads(p.read_text("utf-8"))
    except Exception as e:
        log.warning("[Cache] Read failed for %s: %s", key, e)
    return None

def disk_cache_set(key: str, data):
    try:
        _cache_path_for(key).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        log.warning("[Cache] Write failed for %s: %s", key, e)

def disk_cache_clear_all() -> int:
    n = 0
    for p in CACHE_DIR.glob("*.json"):
        try:
            p.unlink()
            n += 1
        except Exception:
            pass
    return n

# =====================================================
# ---------------- HELPERS ----------------
# =====================================================
def is_allowed_file(path: Path) -> bool:
    return path.suffix.lower() in ALLOWED_EXTS

def safe_join_media(relpath: str) -> Path:
    p = (MEDIA_ROOT / relpath).resolve()
    if not str(p).startswith(str(MEDIA_ROOT)):
        abort(403)
    return p

def human_size(num: int) -> str:
    units = ["B", "KB", "MB", "GB", "TB"]
    i = 0
    while num >= 1024 and i < len(units) - 1:
        num /= 1024
        i += 1
    return f"{num:.1f} {units[i]}"

def ffmpeg_exists():
    try:
        subprocess.run([FFMPEG_BIN, "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        return False

# =====================================================
# ---------------- DIRECTORY SCANS ----------------
# =====================================================
def build_tree(path: Path, rel: str = "", seen=None):
    """Recursively build folder/file tree."""
    if seen is None:
        seen = set()
    node = {"name": path.name if rel else "sounds", "path": rel, "type": "dir", "children": []}
    real_path = path.resolve()
    if real_path in seen:
        return node
    seen.add(real_path)
    try:
        entries = sorted(
            [p for p in path.iterdir() if not p.name.startswith(".")],
            key=lambda p: (p.is_file(), p.name.lower())
        )
    except Exception:
        return node
    for entry in entries:
        rel_child = f"{rel}/{entry.name}" if rel else entry.name
        rel_child = rel_child.replace("\\", "/")
        if entry.is_dir():
            node["children"].append(build_tree(entry, rel_child, seen))
        elif entry.is_file() and is_allowed_file(entry):
            try:
                size = entry.stat().st_size
            except Exception:
                size = 0
            node["children"].append({
                "name": entry.name,
                "path": rel_child,
                "type": "file",
                "size": size
            })
    return node

def collect_stats(path: Path):
    folder_count, file_count, total_bytes = 0, 0, 0
    for root, dirs, files in os.walk(path):
        folder_count += len(dirs)
        for f in files:
            p = Path(root) / f
            if is_allowed_file(p):
                file_count += 1
                try:
                    total_bytes += p.stat().st_size
                except FileNotFoundError:
                    pass
    return folder_count, file_count, total_bytes

def all_playables():
    return [
        Path(root, f).relative_to(MEDIA_ROOT).as_posix()
        for root, _, files in os.walk(MEDIA_ROOT)
        for f in files if is_allowed_file(Path(root, f))
    ]

# =====================================================
# ---------------- HASH & WATCHER ----------------
# =====================================================
def compute_dir_hash(path: Path) -> str:
    sha = hashlib.sha1()
    for root, _, files in os.walk(path):
        for f in sorted(files):
            fp = Path(root, f)
            if not is_allowed_file(fp):
                continue
            sha.update(fp.name.encode())
            try:
                sha.update(str(fp.stat().st_mtime_ns).encode())
            except Exception:
                pass
    return sha.hexdigest()

def _background_cache_builder(force=False):
    start = time.time()
    try:
        cur_hash = compute_dir_hash(MEDIA_ROOT)
        if not force and cur_hash == _cache_state.get("last_hash"):
            return
        _cache_state["last_hash"] = cur_hash

        tree_data = build_tree(MEDIA_ROOT)
        disk_cache_set("tree_root", tree_data)

        folders, files, total = collect_stats(MEDIA_ROOT)
        stats = {
            "folders": folders,
            "files": files,
            "bytes": total,
            "human_size": human_size(total),
            "updated_at": int(time.time())
        }
        disk_cache_set("stats", stats)

        filelist = all_playables()
        disk_cache_set("files", filelist)

        log.info("✅ Cache rebuilt in %.2fs", time.time() - start)
    except Exception as e:
        log.exception("[CacheInit] Builder failed: %s", e)

def _launch_background_cache_builder(block=False):
    if block:
        _background_cache_builder(force=True)
    else:
        threading.Thread(target=_background_cache_builder, daemon=True).start()

_cache_watcher_started = False

@wavebox_bp.before_app_request
def _init_cache_watcher():
    global _cache_watcher_started
    if _cache_watcher_started:
        return
    _cache_watcher_started = True
    _launch_background_cache_builder()
    _launch_backup_watcher()
    def watch_loop():
        while True:
            time.sleep(300)
            try:
                new_hash = compute_dir_hash(MEDIA_ROOT)
                if new_hash != _cache_state.get("last_hash"):
                    _background_cache_builder(force=True)
            except Exception as e:
                log.warning("[CacheWatch] Error: %s", e)
    threading.Thread(target=watch_loop, daemon=True).start()

# =====================================================
# ---------------- ROUTES ----------------
# =====================================================
@wavebox_bp.get("/")
def index():
    # Serve React app
    return render_template("react.html", page="sounds")

@wavebox_bp.get("/api/tree")
def api_tree():
    rel = (request.args.get("path") or "").strip()
    cache_key = f"tree_{rel or 'root'}"
    cached = disk_cache_get(cache_key)
    if cached:
        return jsonify(cached)
    path = (MEDIA_ROOT / rel).resolve()
    if not str(path).startswith(str(MEDIA_ROOT)) or not path.exists():
        return jsonify({"name": "invalid", "path": rel, "type": "dir", "children": []})
    data = build_tree(path, rel)
    disk_cache_set(cache_key, data)
    return jsonify(data)

@wavebox_bp.get("/api/stats")
def api_stats():
    data = disk_cache_get("stats")
    if not data:
        _launch_background_cache_builder(block=True)
        data = disk_cache_get("stats")
    return jsonify(data or {"ok": False, "error": "Cache unavailable"})

@wavebox_bp.get("/api/random")
def api_random():
    filelist = disk_cache_get("files")
    if not filelist:
        _launch_background_cache_builder(block=True)
        filelist = disk_cache_get("files")
    if not filelist:
        return jsonify({"ok": False, "error": "No files"}), 404
    return jsonify({"ok": True, "path": random.choice(filelist)})

# =====================================================
# ---------------- MEDIA / STREAMING ----------------
# =====================================================
def transcode_stream(src: Path, normalize: bool, target: str):
    if not ffmpeg_exists():
        return None, None
    codec, fmt, mime = ("libopus", "ogg", "audio/ogg") if target == "opus" else ("libmp3lame", "mp3", "audio/mpeg")
    filters = []
    if RESAMPLE_HZ: filters.append(f"aresample={RESAMPLE_HZ}")
    if normalize:   filters.append("loudnorm=I=-16:LRA=11:TP=-1.5")
    af = ",".join(filters) or "anull"
    cmd = [
        FFMPEG_BIN, "-v", "error", "-nostdin",
        "-i", str(src), "-vn", "-ac", "2", "-af", af,
        "-c:a", codec, "-b:a", TRANSCODE_BITRATE, "-f", fmt, "pipe:1"
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=65536)
    def generate():
        try:
            while chunk := proc.stdout.read(65536):
                yield chunk
        finally:
            if proc.poll() is None:
                proc.kill()
    return stream_with_context(generate()), mime

@wavebox_bp.get("/media/<path:relpath>")
def media(relpath):
    p = safe_join_media(relpath)
    if not p.exists() or not is_allowed_file(p):
        abort(404)
    return send_file(
        p,
        mimetype=mimetypes.guess_type(p.name)[0] or "application/octet-stream",
        conditional=True
    )

@wavebox_bp.get("/stream/<path:relpath>")
def stream(relpath):
    src = safe_join_media(relpath)
    if not src.exists() or not is_allowed_file(src):
        abort(404)
    normalize = request.args.get("normalize") == "1"
    ext = src.suffix.lower()
    if ext == ".mp3" and not normalize:
        return media(relpath)
    target = "mp3" if (ext == ".mp3" and not normalize) else TRANSCODE_FORMAT_NON_MP3
    generator, mime = transcode_stream(src, normalize, target)
    if not generator:
        return media(relpath)
    resp = Response(generator, mimetype=mime)
    resp.headers["X-Transcoded"] = "1"
    if normalize:
        resp.headers["X-Normalized"] = "1"
    return resp

# =====================================================
# ---------------- UPLOAD SYSTEM ----------------
# =====================================================
def _upload_db_conn():
    conn = sqlite3.connect(str(UPLOAD_DB))
    conn.row_factory = sqlite3.Row
    return conn

def _upsert_upload_row(conn, upload_id: str, entry: dict):
    user = entry.get("user") if isinstance(entry.get("user"), dict) else {}
    conn.execute(
        """
        INSERT INTO uploads (
            upload_id, filename, path, saved_to, timestamp, status, accepted_at,
            user_id, user_username, user_avatar, is_backup, backup_note
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(upload_id) DO UPDATE SET
            filename=excluded.filename,
            path=excluded.path,
            saved_to=excluded.saved_to,
            timestamp=excluded.timestamp,
            status=excluded.status,
            accepted_at=excluded.accepted_at,
            user_id=excluded.user_id,
            user_username=excluded.user_username,
            user_avatar=excluded.user_avatar,
            is_backup=excluded.is_backup,
            backup_note=excluded.backup_note
        """,
        (
            str(upload_id),
            entry.get("filename"),
            entry.get("path"),
            entry.get("saved_to"),
            entry.get("timestamp"),
            entry.get("status", "pending"),
            entry.get("accepted_at"),
            user.get("id"),
            user.get("username") or user.get("name"),
            user.get("avatar"),
            1 if entry.get("is_backup") else 0,
            entry.get("backup_note"),
        ),
    )

def _ensure_upload_db():
    global _uploads_db_ready
    if _uploads_db_ready:
        return

    with _upload_log_lock:
        if _uploads_db_ready:
            return

        UPLOAD_DB.parent.mkdir(parents=True, exist_ok=True)
        conn = _upload_db_conn()
        try:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS uploads (
                    upload_id TEXT PRIMARY KEY,
                    filename TEXT,
                    path TEXT,
                    saved_to TEXT,
                    timestamp INTEGER,
                    status TEXT,
                    accepted_at INTEGER,
                    user_id TEXT,
                    user_username TEXT,
                    user_avatar TEXT,
                    is_backup INTEGER DEFAULT 0,
                    backup_note TEXT
                )
                """
            )

            row = conn.execute("SELECT COUNT(*) AS c FROM uploads").fetchone()
            db_count = int(row["c"] if row else 0)

            if db_count == 0 and UPLOAD_LOG.exists():
                try:
                    legacy = json.loads(UPLOAD_LOG.read_text("utf-8"))
                    if isinstance(legacy, dict):
                        migrated = 0
                        for upload_id, entry in legacy.items():
                            if isinstance(entry, dict):
                                _upsert_upload_row(conn, str(upload_id), entry)
                                migrated += 1
                        conn.commit()
                        log.warning("[UploadDB] Migrated %d entries from legacy JSON log", migrated)
                except Exception as e:
                    log.warning("[UploadDB] Legacy JSON migration failed: %s", e)

            _uploads_db_ready = True
        finally:
            conn.close()

def _row_to_upload_entry(row: sqlite3.Row) -> dict:
    user_id = row["user_id"]
    username = row["user_username"]
    avatar = row["user_avatar"]

    user = {
        "id": user_id,
        "username": username,
        "name": username,
        "avatar": avatar,
    }

    entry = {
        "user": user,
        "filename": row["filename"],
        "path": row["path"],
        "saved_to": row["saved_to"],
        "timestamp": row["timestamp"],
        "status": row["status"] or "pending",
    }

    if row["accepted_at"] is not None:
        entry["accepted_at"] = row["accepted_at"]
    if int(row["is_backup"] or 0) == 1:
        entry["is_backup"] = True
    if row["backup_note"]:
        entry["backup_note"] = row["backup_note"]

    return entry

def _load_upload_log():
    try:
        _ensure_upload_db()
        conn = _upload_db_conn()
        try:
            rows = conn.execute(
                "SELECT * FROM uploads ORDER BY COALESCE(timestamp, 0) ASC, upload_id ASC"
            ).fetchall()
            return {row["upload_id"]: _row_to_upload_entry(row) for row in rows}
        finally:
            conn.close()
    except Exception as e:
        log.warning("[UploadDB] Read failed: %s", e)
        return {}

def _save_upload_log(data):
    try:
        _ensure_upload_db()
        with _upload_log_lock:
            conn = _upload_db_conn()
            try:
                existing_rows = conn.execute("SELECT upload_id FROM uploads").fetchall()
                existing_ids = {row["upload_id"] for row in existing_rows}
                incoming_ids = set()

                for upload_id, entry in (data or {}).items():
                    upload_id = str(upload_id)
                    incoming_ids.add(upload_id)
                    if isinstance(entry, dict):
                        _upsert_upload_row(conn, upload_id, entry)

                stale_ids = existing_ids - incoming_ids
                for stale_id in stale_ids:
                    conn.execute("DELETE FROM uploads WHERE upload_id = ?", (stale_id,))

                conn.commit()
            finally:
                conn.close()
    except Exception as e:
        log.warning("[UploadDB] Write failed: %s", e)

def _sync_recorded_backups() -> int:
    """
    Ensure every audio file in data/recorded has a log entry.
    Missing entries are recovered as system backup uploads.
    """
    if not RECORDED_ROOT.exists():
        log.warning("[BackupSync] Recorded root missing: %s", RECORDED_ROOT)
        return 0

    started_at = time.time()
    now_ts = int(time.time())

    uploads = _load_upload_log()
    log_entry_count = len(uploads)
    existing_saved_to = {
        str(entry.get("saved_to", "")).replace("\\", "/").lower()
        for entry in uploads.values()
        if entry.get("saved_to")
    }

    added = 0
    scanned_audio_files = 0
    recovered_paths = []
    for fpath in RECORDED_ROOT.rglob("*"):
        if not fpath.is_file() or not is_allowed_file(fpath):
            continue

        scanned_audio_files += 1
        rel = str(fpath.relative_to(RECORDED_ROOT)).replace("\\", "/").lower()
        if rel in existing_saved_to:
            continue

        entry_id = f"backup-{now_ts}-{added}-{hashlib.sha1(rel.encode('utf-8')).hexdigest()[:10]}"
        uploads[entry_id] = {
            "user": {
                "id": "system-backup",
                "username": "System Backup",
                "avatar": None,
            },
            "filename": fpath.name,
            "path": rel,
            "saved_to": rel,
            "timestamp": now_ts,
            "status": "pending",
            "is_backup": True,
            "backup_note": "Recovered by hourly backup scan (missing upload log entry).",
        }
        existing_saved_to.add(rel)
        recovered_paths.append(rel)
        added += 1

    if added:
        _save_upload_log(uploads)
        log.warning("[BackupSync] Added %d recovered upload entries as System Backup", added)
        log.warning("[BackupSync] Recovered paths (up to 10): %s", ", ".join(recovered_paths[:10]))

    missing_count = max(scanned_audio_files - len(existing_saved_to), 0)
    log.info(
        "[BackupSync] Scan summary: scanned_audio=%d, log_entries=%d, unique_saved_to=%d, recovered=%d, unresolved_missing=%d, duration=%.2fs",
        scanned_audio_files,
        log_entry_count,
        len(existing_saved_to),
        added,
        missing_count,
        time.time() - started_at,
    )

    return added

def _trigger_backup_sync_async(reason: str = "manual"):
    with _upload_log_lock:
        if _backup_sync_state["running"]:
            log.info("[BackupSync] Skip trigger (%s): previous run still active", reason)
            return
        _backup_sync_state["running"] = True
        _backup_sync_state["last_started"] = int(time.time())

    def _run():
        try:
            recovered = _sync_recorded_backups()
            log.info("[BackupSync] Async run complete (%s), recovered=%d", reason, recovered)
        except Exception as e:
            log.warning("[BackupSync] Async run failed (%s): %s", reason, e)
        finally:
            with _upload_log_lock:
                _backup_sync_state["running"] = False

    threading.Thread(target=_run, daemon=True).start()

def _launch_backup_watcher():
    if _backup_state["started"]:
        return
    _backup_state["started"] = True
    log.info("[BackupSync] Starting hourly backup watcher (interval=3600s)")

    _trigger_backup_sync_async(reason="startup")

    def backup_loop():
        while True:
            try:
                _trigger_backup_sync_async(reason="hourly")
            except Exception as e:
                log.warning("[BackupSync] Error: %s", e)
            time.sleep(3600)

    threading.Thread(target=backup_loop, daemon=True).start()

def is_owner():
    user = get_current_user()
    if not user:
        return False
    uid = str(user.get("id") if isinstance(user, dict) else getattr(user, "id", None))
    return uid in ADMIN_USER_IDS

def _current_user_id(user=None) -> str:
    if user is None:
        user = get_current_user()
    if not user:
        return ""
    uid = user.get("id") if isinstance(user, dict) else getattr(user, "id", None)
    return str(uid) if uid is not None else ""

def _is_owner_user(user=None) -> bool:
    uid = _current_user_id(user)
    return bool(uid and uid in ADMIN_USER_IDS)

def _normalize_relpath(relpath: str) -> str:
    return str(relpath or "").replace("\\", "/").lstrip("/").lower()

def _entry_uploader_id(entry: dict) -> str:
    if not isinstance(entry, dict):
        return ""
    user = entry.get("user") if isinstance(entry.get("user"), dict) else {}
    uid = user.get("id")
    return str(uid) if uid is not None else ""

def _build_upload_index(uploads: dict) -> dict:
    by_rel = {}
    for entry in (uploads or {}).values():
        if not isinstance(entry, dict):
            continue
        rel = _normalize_relpath(entry.get("saved_to") or entry.get("path") or "")
        if rel:
            by_rel[rel] = entry
    return by_rel

def _can_preview_entry(entry, current_user_id: str, is_admin: bool) -> bool:
    if is_admin:
        return True
    if not isinstance(entry, dict):
        return False
    status = str(entry.get("status") or "pending").lower()
    if status == "accepted":
        return True
    if status == "pending":
        return bool(current_user_id and current_user_id == _entry_uploader_id(entry))
    return False

def _preview_url_for(relpath: str) -> str:
    rel = _normalize_relpath(relpath)
    return f"/sounds/recorded/{quote(rel, safe='/')}"

@wavebox_bp.post("/api/upload")
def api_upload():
    """
    Accepts a recorded audio file and stores it under data/recorded/<path>. Always saved as .mp3.
    Expects form fields:
      - file: the uploaded blob
      - path: e.g. 'vo/astro/line_01.mp3' (the canonical final path within sounds/)
    """
    file = request.files.get("file")
    relpath = (request.form.get("path") or "").strip().replace("\\", "/").lower()
    if not file or not relpath:
        return jsonify({"ok": False, "error": "Missing file or path"}), 400

    rel = Path(relpath)
    rel_dir = rel.parent
    filename = rel.stem + ".mp3"

    save_dir = (RECORDED_ROOT / rel_dir).resolve()
    save_path = save_dir / filename

    if not str(save_dir).startswith(str(RECORDED_ROOT)):
        return jsonify({"ok": False, "error": "Invalid path"}), 400

    save_dir.mkdir(parents=True, exist_ok=True)

    if save_path.exists():
        return jsonify({"ok": False, "error": "Recording already exists"}), 409

    temp_path = save_dir / f"__temp__{secure_filename(file.filename)}"
    file.save(temp_path)

    if temp_path.suffix.lower() not in (".webm", ".wav", ".mp3"):
        temp_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": "Unsupported file type"}), 400

    try:
        if temp_path.suffix.lower() != ".mp3":
            subprocess.run(
                ["ffmpeg", "-y", "-i", str(temp_path), "-vn", "-ac", "2", "-ar", "44100", "-b:a", "192k", "-f", "mp3", str(save_path)],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True,
            )
            temp_path.unlink(missing_ok=True)
        else:
            temp_path.rename(save_path)
    except subprocess.CalledProcessError:
        temp_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": "Conversion failed"}), 500

    log_data = _load_upload_log()
    user = get_current_user() or {"id": "unknown", "name": "anonymous"}
    entry = {
        "user": user,
        "filename": save_path.name,
        "path": relpath.replace("\\", "/"),  # canonical path
        "saved_to": str(save_path.relative_to(RECORDED_ROOT)).replace("\\", "/"),  # normalize for URLs
        "timestamp": int(time.time()),
        "status": "pending"
    }

    log_data[str(time.time())] = entry
    _save_upload_log(log_data)

    return jsonify({"ok": True, "entry": entry})

@wavebox_bp.get("/recorded/<path:relpath>")
def recorded_media(relpath):
    """
    Serve uploaded recordings for preview.
    Files are stored in data/recorded/.
    """
    current_user = get_current_user()
    current_user_id = _current_user_id(current_user)
    admin_access = _is_owner_user(current_user)

    relpath = _normalize_relpath(relpath)
    p = (RECORDED_ROOT / relpath).resolve()

    # Prevent directory traversal
    if not str(p).startswith(str(RECORDED_ROOT)):
        abort(403)

    if not p.exists() or not is_allowed_file(p):
        abort(404)

    uploads = _load_upload_log()
    upload_index = _build_upload_index(uploads)
    entry = upload_index.get(relpath)

    # Accepted recordings are previewable by everyone.
    # Pending recordings are previewable by admins and the original uploader only.
    if entry:
        if not _can_preview_entry(entry, current_user_id, admin_access):
            abort(403)
    elif not admin_access:
        # Untracked files remain admin-only.
        abort(403)

    mime = mimetypes.guess_type(p.name)[0] or "application/octet-stream"
    return send_file(p, mimetype=mime, conditional=True)


@wavebox_bp.post("/api/accept")
def api_accept():
    """Mark an uploaded recording as accepted without moving the file."""
    if not is_owner():
        abort(403)

    data = request.get_json(silent=True) or {}
    target_id = data.get("id")
    if not target_id:
        return jsonify({"ok": False, "error": "Missing id"}), 400

    uploads = _load_upload_log()
    entry = uploads.get(target_id)
    if not entry:
        return jsonify({"ok": False, "error": "Upload not found"}), 404

    rel = entry.get("saved_to")
    if not rel:
        return jsonify({"ok": False, "error": "Invalid saved path"}), 400

    # Make sure the recorded file actually exists
    p = RECORDED_ROOT / rel
    if not p.exists():
        return jsonify({"ok": False, "error": "File not found"}), 404

    # Update status only — no move
    entry["status"] = "accepted"
    entry["accepted_at"] = int(time.time())
    uploads[target_id] = entry
    _save_upload_log(uploads)

    log.info("✅ [Accept] Marked as accepted (no move): %s", rel)
    return jsonify({"ok": True, "entry": entry})


@wavebox_bp.post("/api/accept-all")
def api_accept_all():
    """Bulk-accept all pending recordings without moving files (admin-only)."""
    if not is_owner():
        abort(403)

    uploads = _load_upload_log()
    changed = 0
    accepted_ids = []
    now_ts = int(time.time())

    for uid, entry in uploads.items():
        if entry.get("status") != "pending":
            continue

        rel = entry.get("saved_to")
        if not rel:
            continue

        p = (RECORDED_ROOT / rel).resolve()
        if not str(p).startswith(str(RECORDED_ROOT)) or not p.exists():
            continue

        entry["status"] = "accepted"
        entry["accepted_at"] = now_ts
        uploads[uid] = entry
        changed += 1
        accepted_ids.append(uid)

    _save_upload_log(uploads)

    log.info("✅ [AcceptAll] Marked %d pending recordings as accepted", changed)
    return jsonify({"ok": True, "accepted": changed, "ids": accepted_ids})

@wavebox_bp.post("/api/reject")
def api_reject():
    """
    Rejects and deletes a pending recording from data/recorded and removes it from the log.
    Body JSON: { "id": "<upload-log-key>" }
    """
    if not is_owner():
        abort(403)

    data = request.get_json(silent=True) or {}
    target_id = data.get("id")
    if not target_id:
        return jsonify({"ok": False, "error": "Missing id"}), 400

    uploads = _load_upload_log()
    entry = uploads.get(target_id)
    if not entry:
        return jsonify({"ok": False, "error": "Upload not found"}), 404

    rel = entry.get("saved_to")
    if rel:
        p = RECORDED_ROOT / rel
        try:
            if p.exists():
                p.unlink()
        except Exception as e:
            log.warning("[Reject] Could not delete %s: %s", p, e)

    uploads.pop(target_id, None)
    _save_upload_log(uploads)

    return jsonify({"ok": True, "removed": target_id})

@wavebox_bp.get("/api/exists")
def api_exists():
    """
    Check the status of a canonical line (used by recorder.js).
    Query: ?path=vo/astro/line_01.mp3
    Looks ONLY inside data/recorded/, and reports:
      - missing: no file yet
      - pending: uploaded but not accepted
      - accepted: marked accepted in _uploads.json
    """
    rel = (request.args.get("path") or "").strip()
    if not rel:
        return jsonify({"ok": False, "error": "Missing path"}), 400

    # Normalize (Windows safe)
    rel = rel.replace("\\", "/").lstrip("/").lower()
    if not rel.endswith(".mp3"):
        rel = str(Path(rel).with_suffix(".mp3"))

    # Build absolute path
    recorded_path = (RECORDED_ROOT / rel).resolve()

    # Prevent traversal
    if not str(recorded_path).startswith(str(RECORDED_ROOT)):
        return jsonify({"ok": False, "error": "Invalid path"}), 400

    uploads = _load_upload_log()
    upload_index = _build_upload_index(uploads)
    current_user = get_current_user()
    current_user_id = _current_user_id(current_user)
    admin_access = _is_owner_user(current_user)

    # ✅ File physically exists in data/recorded/
    if recorded_path.exists():
        # Try to enrich from uploads log
        entry = upload_index.get(rel)
        if entry:
            can_preview = _can_preview_entry(entry, current_user_id, admin_access)
            payload = {
                "ok": True,
                "exists": True,
                "status": entry.get("status", "pending"),
                "accepted_at": entry.get("accepted_at"),
                "uploader": entry.get("user"),
                "timestamp": entry.get("timestamp"),
                "path": rel,
                "can_preview": can_preview,
            }
            if can_preview:
                payload["preview_url"] = _preview_url_for(rel)
            return jsonify(payload)

        # File exists but not logged — treat as pending
        can_preview = admin_access
        payload = {
            "ok": True,
            "exists": True,
            "status": "pending",
            "path": rel,
            "can_preview": can_preview,
        }
        if can_preview:
            payload["preview_url"] = _preview_url_for(rel)
        return jsonify(payload)

    # ❌ File not in data/recorded
    return jsonify({
        "ok": True,
        "exists": False,
        "status": "missing",
        "path": rel
    })


# =====================================================
# ---------------- DEV DASHBOARD + USER ----------------
# =====================================================
@wavebox_bp.get("/api/download-accepted")
def api_download_accepted():
    """
    Download all accepted recordings as a zip file.
    Admin-only endpoint.
    """
    if not is_owner():
        abort(403)
    
    uploads = _load_upload_log()
    accepted = [e for e in uploads.values() if e.get("status") == "accepted"]
    
    if not accepted:
        return jsonify({"ok": False, "error": "No accepted recordings"}), 404
    
    # Create in-memory zip file
    zip_buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for entry in accepted:
                rel = entry.get("saved_to")
                if not rel:
                    continue
                
                p = (RECORDED_ROOT / rel).resolve()
                
                # Security check - prevent directory traversal
                if not str(p).startswith(str(RECORDED_ROOT)) or not p.exists():
                    log.warning("[Download] Skipping invalid/missing path: %s", rel)
                    continue
                
                # Add file to zip using the original path as the archive name
                zf.write(p, arcname=rel)
        
        zip_buffer.seek(0)
        log.info("✅ [Download] Created zip with %d accepted recordings", len(accepted))
        
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"submitted_sounds_{int(time.time())}.zip"
        )
    except Exception as e:
        log.exception("[Download] Failed to create zip: %s", e)
        return jsonify({"ok": False, "error": "Failed to create zip file"}), 500

@wavebox_bp.get("/api/download-all")
def api_download_all():
    """
    Download all recordings (pending, accepted, rejected) as a zip file.
    Admin-only endpoint.
    """
    if not is_owner():
        abort(403)
    
    uploads = _load_upload_log()
    
    if not uploads:
        return jsonify({"ok": False, "error": "No recordings"}), 404
    
    # Create in-memory zip file
    zip_buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for entry in uploads.values():
                rel = entry.get("saved_to")
                if not rel:
                    continue
                
                p = (RECORDED_ROOT / rel).resolve()
                
                # Security check - prevent directory traversal
                if not str(p).startswith(str(RECORDED_ROOT)) or not p.exists():
                    log.warning("[Download] Skipping invalid/missing path: %s", rel)
                    continue
                
                # Add file to zip using the original path as the archive name
                zf.write(p, arcname=rel)
        
        zip_buffer.seek(0)
        log.info("✅ [Download] Created zip with %d total recordings", len(uploads))
        
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"all_submitted_sounds_{int(time.time())}.zip"
        )
    except Exception as e:
        log.exception("[Download] Failed to create zip: %s", e)
        return jsonify({"ok": False, "error": "Failed to create zip file"}), 500

@wavebox_bp.get("/api/download")
def api_download_key():
    """
    API-key-authenticated download endpoint.
    Query params:
      - api_key: must match SOUNDS_DOWNLOAD_API_KEY in .env
      - filter:  'pending' | 'accepted' | 'all' (default: 'accepted')
    """
    provided_key = request.args.get("api_key", "").strip()
    expected_key = os.environ.get("SOUNDS_DOWNLOAD_API_KEY", "")

    if not expected_key:
        log.error("[Download] SOUNDS_DOWNLOAD_API_KEY is not set in environment")
        abort(500)

    if not provided_key or provided_key != expected_key:
        abort(403)

    filter_mode = request.args.get("filter", "accepted").strip().lower()
    if filter_mode not in ("pending", "accepted", "all"):
        return jsonify({"ok": False, "error": "filter must be 'pending', 'accepted', or 'all'"}), 400

    uploads = _load_upload_log()

    if filter_mode == "all":
        entries = list(uploads.values())
    else:
        entries = [e for e in uploads.values() if e.get("status") == filter_mode]

    if not entries:
        return jsonify({"ok": False, "error": f"No {filter_mode} recordings found"}), 404

    zip_buffer = io.BytesIO()
    try:
        with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zf:
            for entry in entries:
                rel = entry.get("saved_to")
                if not rel:
                    continue
                p = (RECORDED_ROOT / rel).resolve()
                if not str(p).startswith(str(RECORDED_ROOT)) or not p.exists():
                    log.warning("[Download] Skipping invalid/missing path: %s", rel)
                    continue
                zf.write(p, arcname=rel)

        zip_buffer.seek(0)
        log.info("✅ [Download] API key download: filter=%s count=%d", filter_mode, len(entries))
        return send_file(
            zip_buffer,
            mimetype="application/zip",
            as_attachment=True,
            download_name=f"sounds_{filter_mode}_{int(time.time())}.zip"
        )
    except Exception as e:
        log.exception("[Download] Failed to create zip: %s", e)
        return jsonify({"ok": False, "error": "Failed to create zip file"}), 500

@wavebox_bp.get("/api/uploads")
def api_uploads():
    """Fetch all uploads for the dev dashboard (admin-only)."""
    if not is_owner():
        abort(403)
    uploads = _load_upload_log()
    return jsonify({
        "ok": True,
        "uploads": uploads,
        "accepted_count": len([e for e in uploads.values() if e.get("status") == "accepted"]),
        "pending_count": len([e for e in uploads.values() if e.get("status") == "pending"]),
    })

@wavebox_bp.get("/dev")
def dev_dashboard():
    if not is_owner():
        abort(403)
    # Serve React app
    return render_template("react.html", page="dev")

@wavebox_bp.get("/api/me")
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({"ok": False, "user": None})
    return jsonify({"ok": True, "user": user})

@wavebox_bp.get("/api/all-statuses")
def api_all_statuses():
    """
    Return status map for all files in data/recorded/.
    Returns: { "path/to/file.mp3": { "status": "pending|accepted|missing", ... }, ... }
    """
    uploads = _load_upload_log()
    upload_index = _build_upload_index(uploads)
    current_user = get_current_user()
    current_user_id = _current_user_id(current_user)
    admin_access = _is_owner_user(current_user)
    result = {}
    
    # Map all recorded files
    if RECORDED_ROOT.exists():
        for fpath in RECORDED_ROOT.rglob("*"):
            if not fpath.is_file():
                continue
            
            rel = str(fpath.relative_to(RECORDED_ROOT)).replace("\\", "/").lower()
            
            entry = upload_index.get(rel)
            if entry:
                status = str(entry.get("status") or "pending").lower()
                visible = status == "accepted" or admin_access or (status == "pending" and current_user_id == _entry_uploader_id(entry))
                if not visible:
                    continue

                can_preview = _can_preview_entry(entry, current_user_id, admin_access)
                payload = {
                    "status": status,
                    "accepted_at": entry.get("accepted_at"),
                    "uploader": entry.get("user"),
                    "timestamp": entry.get("timestamp"),
                    "can_preview": can_preview,
                }
                if can_preview:
                    payload["preview_url"] = _preview_url_for(rel)
                result[rel] = payload
            elif admin_access:
                # Untracked files are only visible to admins.
                result[rel] = {
                    "status": "pending",
                    "can_preview": True,
                    "preview_url": _preview_url_for(rel),
                }
    
    return jsonify({"ok": True, "statuses": result})

# =====================================================
# ---------------- ERROR HANDLERS ----------------
# =====================================================
@wavebox_bp.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "Not found"}), 404

@wavebox_bp.errorhandler(403)
def forbidden(e):
    return jsonify({"ok": False, "error": "Forbidden"}), 403
