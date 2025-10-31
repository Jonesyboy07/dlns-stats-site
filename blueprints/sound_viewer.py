# ruff: noqa
from __future__ import annotations
import os, mimetypes, time, random, subprocess, hashlib, logging, json, threading, shutil
from pathlib import Path
from flask import (
    Blueprint, jsonify, send_file, abort, render_template,
    Response, stream_with_context, request, current_app
)
from werkzeug.utils import secure_filename
from utils.auth import get_current_user

# =====================================================
# ---------------- CONFIGURATION ----------------
# =====================================================
MEDIA_ROOT = Path("static/sounds").resolve()
CACHE_DIR = Path("_cache").resolve()
RECORDED_ROOT = Path("data/recorded").resolve()
UPLOAD_LOG = RECORDED_ROOT / "_uploads.json"

TRANSCODE_ENABLED = True
CACHE_TRANSCODE = True
TRANSCODE_FORMAT_NON_MP3 = "opus"
TRANSCODE_BITRATE = "96k"
RESAMPLE_HZ = 48000
CACHE_TTL = 12 * 3600
ALLOWED_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}

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
    return render_template("sounds.html")

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
def _load_upload_log():
    if UPLOAD_LOG.exists():
        try:
            return json.loads(UPLOAD_LOG.read_text("utf-8"))
        except Exception:
            return {}
    return {}

def _save_upload_log(data):
    try:
        UPLOAD_LOG.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        log.warning("[Upload] Failed to write log: %s", e)

def is_owner():
    user = get_current_user()
    if not user:
        return False
    uid = str(user.get("id") if isinstance(user, dict) else getattr(user, "id", None))
    return uid == str(current_app.config.get("DISCORD_OWNER_ID", ""))

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

    # ✅ File physically exists in data/recorded/
    if recorded_path.exists():
        # Try to enrich from uploads log
        for entry in uploads.values():
            if str(entry.get("saved_to", "")).lower() == rel:
                return jsonify({
                    "ok": True,
                    "exists": True,
                    "status": entry.get("status", "pending"),
                    "accepted_at": entry.get("accepted_at"),
                    "uploader": entry.get("user"),
                    "timestamp": entry.get("timestamp"),
                    "path": rel
                })

        # File exists but not logged — treat as pending
        return jsonify({
            "ok": True,
            "exists": True,
            "status": "pending",
            "path": rel
        })

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
@wavebox_bp.get("/dev")
def dev_dashboard():
    if not is_owner():
        abort(403)
    uploads = _load_upload_log()
    return render_template("sounds_dev.html", uploads=uploads)

@wavebox_bp.get("/api/me")
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({"ok": False, "user": None})
    return jsonify({"ok": True, "user": user})

# =====================================================
# ---------------- ERROR HANDLERS ----------------
# =====================================================
@wavebox_bp.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "Not found"}), 404

@wavebox_bp.errorhandler(403)
def forbidden(e):
    return jsonify({"ok": False, "error": "Forbidden"}), 403
