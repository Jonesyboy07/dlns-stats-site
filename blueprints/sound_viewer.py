# ruff: noqa
from __future__ import annotations
import os, mimetypes, time, random, subprocess, hashlib, logging, json, threading
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
log.info("🚀 [Wavebox] Sound system initialized. Awaiting first request to build cache.")

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
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        return False

# =====================================================
# ---------------- DIRECTORY SCANS ----------------
# =====================================================
import pprint

# =====================================================
# ---------------- DEBUG-AWARE TREE BUILDER ----------------
# =====================================================
def build_tree(path: Path, rel: str = "", depth: int = 0, seen=None):
    """Recursively build folder/file tree with detailed debug logging."""
    if seen is None:
        seen = set()

    prefix = "│  " * depth
    log.debug("%s📂 Scanning: %s", prefix, path)

    node = {
        "name": path.name if rel else "sounds",
        "path": rel,
        "type": "dir",
        "children": []
    }

    # Prevent infinite recursion on duplicate / cyclic paths
    real_path = path.resolve()
    if real_path in seen:
        log.warning("%s⚠️ Skipping already-seen folder: %s", prefix, path)
        return node
    seen.add(real_path)

    try:
        entries = sorted(
            [p for p in path.iterdir() if not p.name.startswith(".")],
            key=lambda p: (p.is_file(), p.name.lower())
        )
    except Exception as e:
        log.warning("%s❌ Error reading folder %s: %s", prefix, path, e)
        return node

    for entry in entries:
        rel_child = f"{rel}/{entry.name}" if rel else entry.name
        rel_child = rel_child.replace("\\", "/")

        # Avoid self-referencing or cyclic paths
        if entry.resolve() == path.resolve():
            log.warning("%s🔁 Skipping self-reference: %s", prefix, entry)
            continue

        if entry.is_symlink():
            log.info("%s⛓️  Skipping symlink: %s", prefix, entry)
            continue

        if entry.is_dir():
            log.debug("%s→ Entering folder: %s", prefix, entry.name)
            node["children"].append(build_tree(entry, rel_child, depth + 1, seen))
        elif entry.is_file() and is_allowed_file(entry):
            try:
                size = entry.stat().st_size
            except Exception:
                size = 0
            log.debug("%s🎵 File: %s (%.1f KB)", prefix, entry.name, size / 1024)
            node["children"].append({
                "name": entry.name,
                "path": rel_child,
                "type": "file",
                "size": size
            })
        else:
            log.debug("%s🚫 Skipped: %s", prefix, entry.name)

    if depth == 0:
        log.info("✅ Finished scanning top-level folder: %s", path)
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

# =====================================================
# ---------------- BACKGROUND CACHING ----------------
# =====================================================
def _background_cache_builder(force=False):
    start = time.time()
    log.info("🧠 [CacheInit] Starting background cache builder (force=%s)...", force)
    try:
        cur_hash = compute_dir_hash(MEDIA_ROOT)
        if not force and cur_hash == _cache_state.get("last_hash"):
            log.info("✅ [CacheInit] No changes detected — cache valid.")
            return
        _cache_state["last_hash"] = cur_hash

        log.info("📁 [CacheBuild] Scanning media tree...")
        tree_data = build_tree(MEDIA_ROOT)
        disk_cache_set("tree_root", tree_data)
        log.info("✅ Tree cache built (%d top-level items)", len(tree_data.get("children", [])))

        log.info("📊 [CacheBuild] Computing stats...")
        folders, files, total = collect_stats(MEDIA_ROOT)
        stats = {
            "folders": folders,
            "files": files,
            "bytes": total,
            "human_size": human_size(total),
            "updated_at": int(time.time())
        }
        disk_cache_set("stats", stats)
        log.info("✅ Stats: %d files, %d folders, %s total", files, folders, human_size(total))

        log.info("🎵 [CacheBuild] Collecting playable files...")
        filelist = all_playables()
        disk_cache_set("files", filelist)
        log.info("✅ Playables cached (%d items)", len(filelist))

        log.info("🟢 [CacheInit] Build complete in %.2fs", time.time() - start)
    except Exception as e:
        log.exception("❌ [CacheInit] Builder failed: %s", e)

def _launch_background_cache_builder(block=False):
    if block:
        _background_cache_builder(force=True)
    else:
        threading.Thread(target=_background_cache_builder, daemon=True).start()

# =====================================================
# ---------------- AUTO WATCHER ----------------
# =====================================================
_cache_watcher_started = False

@wavebox_bp.before_app_request
def _init_cache_watcher():
    global _cache_watcher_started
    if _cache_watcher_started:
        return
    _cache_watcher_started = True
    log.info("⚙️ [CacheInit] Launching background cache builder + watcher...")
    _launch_background_cache_builder()

    def watch_loop():
        while True:
            time.sleep(300)
            try:
                new_hash = compute_dir_hash(MEDIA_ROOT)
                if new_hash != _cache_state.get("last_hash"):
                    log.info("♻️ [CacheWatch] Media changed — rebuilding cache.")
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
    """
    Return the folder tree for a given path — fast and cache-friendly.
    Uses the disk cache if present, only rescans when missing.
    """
    rel = (request.args.get("path") or "").strip()
    log.info("🌲 [API TREE] Request for path=%r", rel)

    cache_key = f"tree_{rel or 'root'}"
    cached = disk_cache_get(cache_key)

    # ✅ Serve directly from cache if available
    if cached:
        log.info("⚡ [API TREE] Served from cache: %s", cache_key)
        return jsonify(cached)

    # --- Only rebuild if missing ---
    path = (MEDIA_ROOT / rel).resolve()
    if not str(path).startswith(str(MEDIA_ROOT)):
        log.warning("🚫 [API TREE] Blocked invalid path: %s", rel)
        return jsonify({"name": "invalid", "path": rel, "type": "dir", "children": []})

    if not path.exists() or not path.is_dir():
        log.warning("⚠️ [API TREE] Nonexistent folder: %s", rel)
        return jsonify({"name": "missing", "path": rel, "type": "dir", "children": []})

    start = time.time()
    log.info("📁 [API TREE] Rebuilding folder tree for '%s'...", rel or "root")
    data = build_tree(path, rel)
    disk_cache_set(cache_key, data)
    elapsed = time.time() - start
    log.info("✅ [API TREE] Built tree for '%s' in %.2fs (cached)", rel or "root", elapsed)

    return jsonify(data)



@wavebox_bp.get("/api/stats")
def api_stats():
    data = disk_cache_get("stats")
    if not data:
        log.info("⚙️ [API] Stats cache missing — building synchronously.")
        _launch_background_cache_builder(block=True)
        data = disk_cache_get("stats")
    return jsonify(data or {"ok": False, "error": "Cache unavailable"})

@wavebox_bp.get("/api/random")
def api_random():
    filelist = disk_cache_get("files")
    if not filelist:
        log.info("⚙️ [API] Files cache missing — rebuilding synchronously.")
        _launch_background_cache_builder(block=True)
        filelist = disk_cache_get("files")
    if not filelist:
        return jsonify({"ok": False, "error": "No files"}), 404
    return jsonify({"ok": True, "path": random.choice(filelist)})

@wavebox_bp.get("/api/cache-status")
def cache_status():
    """Debug info"""
    return jsonify({
        "last_hash": _cache_state.get("last_hash"),
        "tree_cached": _cache_path_for("tree_root").exists(),
        "stats_cached": _cache_path_for("stats").exists(),
        "files_cached": _cache_path_for("files").exists(),
        "media_root": str(MEDIA_ROOT),
        "cache_dir": str(CACHE_DIR),
    })
    
@wavebox_bp.get("/api/debug/tree")
def debug_tree():
    """Logs the full folder tree structure to the console and returns success."""
    log.info("🪵 [Debug] Building folder tree for manual inspection...")
    data = build_tree(MEDIA_ROOT)
    pretty = pprint.pformat(data, indent=2, width=100)
    log.info("=== BEGIN TREE STRUCTURE ===\n%s\n=== END TREE STRUCTURE ===", pretty)
    return jsonify({"ok": True, "message": "Tree structure printed to console."})

@wavebox_bp.get("/api/debug/files")
def debug_files():
    """Show all playable file paths in cache or directly scanned."""
    log.info("🪵 [Debug] Listing all playable files...")
    files = all_playables()
    for f in files:
        log.info("🎵 %s", f)
    return jsonify({"ok": True, "count": len(files), "files": files[:50]})  # limit for sanity

@wavebox_bp.get("/api/debug/stats")
def debug_stats():
    """Force stats rebuild and print result."""
    log.info("🧾 [Debug] Rebuilding media stats manually...")
    folders, files, total = collect_stats(MEDIA_ROOT)
    human = human_size(total)
    log.info("📊 Folders: %d | Files: %d | Total: %s", folders, files, human)
    return jsonify({
        "ok": True,
        "folders": folders,
        "files": files,
        "size": human,
        "updated_at": int(time.time())
    })

# =====================================================
# ---------------- MEDIA / STREAMING ----------------
# =====================================================
def transcode_stream(src: Path, normalize: bool, target: str):
    if not ffmpeg_exists():
        return None, None
    if target == "opus":
        codec, fmt, mime = "libopus", "ogg", "audio/ogg"
    else:
        codec, fmt, mime = "libmp3lame", "mp3", "audio/mpeg"

    filters = []
    if RESAMPLE_HZ:
        filters.append(f"aresample={RESAMPLE_HZ}")
    if normalize:
        filters.append("loudnorm=I=-16:LRA=11:TP=-1.5")
    af = ",".join(filters) or "anull"

    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
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
    return send_file(p, mimetype=mimetypes.guess_type(p.name)[0] or "application/octet-stream", conditional=True)

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
# ---------------- UPLOAD HANDLING ----------------
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
    Accepts a recorded audio file and stores it in
    data/recorded/<exact relative path>. Always saved as .mp3.
    Example:
      path=vo/astro/astro_allies_lasso_kill_01.mp3
      -> data/recorded/vo/astro/astro_allies_lasso_kill_01.mp3
    """
    file = request.files.get("file")
    relpath = (request.form.get("path") or "").strip().replace("\\", "/").lower()

    if not file or not relpath:
        return jsonify({"ok": False, "error": "Missing file or path"}), 400

    # Split the path cleanly
    rel = Path(relpath)
    rel_dir = rel.parent  # vo/astro
    filename = rel.stem + ".mp3"  # astro_allies_lasso_kill_01.mp3

    # Compute final save dir and path
    save_dir = (RECORDED_ROOT / rel_dir).resolve()
    save_path = save_dir / filename

    # Security check
    if not str(save_dir).startswith(str(RECORDED_ROOT)):
        return jsonify({"ok": False, "error": "Invalid path"}), 400

    # Ensure directory exists
    save_dir.mkdir(parents=True, exist_ok=True)

    # Prevent overwriting existing
    if save_path.exists():
        return jsonify({"ok": False, "error": "Recording already exists"}), 409

    # Save temporarily
    temp_path = save_dir / f"__temp__{secure_filename(file.filename)}"
    file.save(temp_path)

    # Validate allowed type
    if temp_path.suffix.lower() not in (".webm", ".wav", ".mp3"):
        temp_path.unlink(missing_ok=True)
        return jsonify({"ok": False, "error": "Unsupported file type"}), 400

    # Convert or rename to MP3
    try:
        if temp_path.suffix.lower() != ".mp3":
            subprocess.run(
                [
                    "ffmpeg", "-y", "-i", str(temp_path),
                    "-vn", "-ac", "2", "-ar", "44100",
                    "-b:a", "192k", "-f", "mp3", str(save_path)
                ],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=True,
            )
            temp_path.unlink(missing_ok=True)
        else:
            temp_path.rename(save_path)

    except subprocess.CalledProcessError as e:
        temp_path.unlink(missing_ok=True)
        log.error("❌ [Upload] Conversion failed: %s", e)
        return jsonify({"ok": False, "error": "Conversion failed"}), 500

    # Log entry
    log_data = _load_upload_log()
    user = get_current_user() or {"id": "unknown", "name": "anonymous"}
    entry = {
        "user": user,
        "filename": save_path.name,
        "path": relpath,
        "saved_to": str(save_path.relative_to(RECORDED_ROOT)),
        "timestamp": int(time.time()),
        "status": "pending"
    }
    log_data[str(time.time())] = entry
    _save_upload_log(log_data)

    log.info("📤 [Upload] Saved new recording: %s (%s)", save_path, user)
    return jsonify({"ok": True, "entry": entry})

@wavebox_bp.get("/dev")
def dev_dashboard():
    if not is_owner():
        abort(403)
    uploads = _load_upload_log()
    return render_template("sounds_dev.html", uploads=uploads)

@wavebox_bp.post("/api/reject")
def api_reject():
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
                log.info("🗑️ [Reject] Deleted rejected recording: %s", p)
        except Exception as e:
            log.warning("[Reject] Could not delete: %s", e)

    # remove entry completely
    uploads.pop(target_id, None)
    _save_upload_log(uploads)
    return jsonify({"ok": True, "removed": target_id})


@wavebox_bp.get("/api/exists")
def api_exists():
    """Check if a recorded version of a given file already exists."""
    rel = (request.args.get("path") or "").strip()
    if not rel:
        return jsonify({"ok": False, "error": "Missing path"}), 400

    p = (RECORDED_ROOT / rel).resolve()
    if not str(p).startswith(str(RECORDED_ROOT)):
        return jsonify({"ok": False, "error": "Invalid path"}), 400

    exists = p.exists()
    return jsonify({"ok": True, "exists": exists})


# =====================================================
# ---------------- USER + ERRORS ----------------
# =====================================================
@wavebox_bp.get("/api/me")
def api_me():
    user = get_current_user()
    if not user:
        return jsonify({"ok": False, "user": None})
    return jsonify({"ok": True, "user": user})

@wavebox_bp.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "Not found"}), 404

@wavebox_bp.errorhandler(403)
def forbidden(e):
    return jsonify({"ok": False, "error": "Forbidden"}), 403
