import os, mimetypes, time, random, subprocess, hashlib, logging, json
from pathlib import Path
from flask import (
    Blueprint, jsonify, send_file, abort,
    render_template, Response, stream_with_context, request
)

# ---------------- HARD-CODED CONFIG ----------------
MEDIA_ROOT = Path("static/sounds").resolve()   # Audio files
CACHE_DIR = Path("_cache").resolve()           # Cache dir for JSON + transcodes
TRANSCODE_ENABLED = True
CACHE_TRANSCODE = True
TRANSCODE_FORMAT_NON_MP3 = "opus"
TRANSCODE_BITRATE = "96k"
RESAMPLE_HZ = 48000

ALLOWED_EXTS = {".mp3", ".wav", ".ogg", ".m4a", ".flac", ".aac"}

# 12h TTL for folder trees, stats and file list
CACHE_TTL = 12 * 3600  # seconds

# ---------------- Logging ----------------
log = logging.getLogger("wavebox")
if not log.handlers:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)-8s | %(message)s",
        datefmt="%H:%M:%S",
    )

# ---------------- Blueprint Definition ----------------
wavebox_bp = Blueprint(
    "wavebox",
    __name__,
    url_prefix="/sounds",              # ✅ Prefix for all routes
    template_folder="templates/sounds"
)

# ---------------- Ensure required folders exist ----------------
CACHE_DIR.mkdir(parents=True, exist_ok=True)
MEDIA_ROOT.mkdir(parents=True, exist_ok=True)

# =====================================================
# Disk Cache System (JSON on disk, low RAM)
# =====================================================
def _safe_cache_key(key: str) -> str:
    # keep it filesystem-friendly and reasonably short
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
                return json.loads(p.read_text(encoding="utf-8"))
    except Exception as e:
        log.warning("[Cache] read failed for %s: %s", key, e)
    return None

def disk_cache_set(key: str, data) -> None:
    p = _cache_path_for(key)
    try:
        p.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        log.warning("[Cache] write failed for %s: %s", key, e)

def disk_cache_delete(key: str) -> bool:
    p = _cache_path_for(key)
    try:
        if p.exists():
            p.unlink()
            return True
    except Exception as e:
        log.warning("[Cache] delete failed for %s: %s", key, e)
    return False

def disk_cache_clear_all() -> int:
    n = 0
    try:
        for p in CACHE_DIR.glob("*.json"):
            try:
                p.unlink()
                n += 1
            except Exception:
                pass
    except Exception:
        pass
    return n

# =====================================================
# Helper Functions
# =====================================================
def is_allowed_file(path: Path) -> bool:
    return path.suffix.lower() in ALLOWED_EXTS

def safe_join_media(relpath: str) -> Path:
    p = (MEDIA_ROOT / relpath).resolve()
    if not str(p).startswith(str(MEDIA_ROOT)):
        abort(403)
    return p

def human_size(num: int) -> str:
    if num == 0:
        return "0 B"
    units = ["B","KB","MB","GB","TB"]
    i = 0
    n = float(num)
    while n >= 1024 and i < len(units) - 1:
        n /= 1024.0
        i += 1
    return f"{n:.1f} {units[i]}"

def ffmpeg_exists():
    try:
        subprocess.run(["ffmpeg", "-version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        return True
    except FileNotFoundError:
        return False

def build_tree(path: Path, rel=""):
    node = {"name": (path.name if rel else (path.name or "sounds")), "path": rel, "type": "dir", "children": []}
    try:
        entries = sorted(path.iterdir(), key=lambda p: (p.is_file(), p.name.lower()))
    except PermissionError:
        log.warning("Permission denied scanning: %s", path)
        return node

    for e in entries:
        rel_child = (Path(rel) / e.name) if rel else Path(e.name)
        if e.is_dir():
            child = build_tree(e, rel_child.as_posix())
            node["children"].append(child)
        elif e.is_file() and is_allowed_file(e):
            size = e.stat().st_size if e.exists() else 0
            node["children"].append({
                "name": e.name,
                "path": rel_child.as_posix().replace("\\","/"),
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
# Transcoding + Transcode Cache (files on disk)
# =====================================================
def cache_key_for(file_path: Path, codec: str, bitrate: str, normalize: bool, sr: int):
    try:
        st = file_path.stat()
        key_str = f"{file_path.resolve()}|{st.st_mtime_ns}|{codec}|{bitrate}|{normalize}|{sr}"
    except OSError:
        key_str = f"{file_path.resolve()}|{codec}|{bitrate}|{normalize}|{sr}"
    return hashlib.sha256(key_str.encode("utf-8")).hexdigest()

def transcode_to_cache(src: Path, normalize: bool, target: str):
    if not ffmpeg_exists():
        log.error("[Transcode] FFmpeg not available.")
        return None

    if target == "opus":
        ext, codec, fmt = ".ogg", "libopus", "ogg"
    else:
        ext, codec, fmt = ".mp3", "libmp3lame", "mp3"

    key = cache_key_for(src, target, TRANSCODE_BITRATE, normalize, RESAMPLE_HZ)
    out_path = CACHE_DIR / f"{key}{ext}"
    if out_path.exists() and out_path.stat().st_size > 0:
        log.info("[Cache] Using cached %s for %s", out_path.name, src.name)
        return out_path

    filters = []
    if RESAMPLE_HZ: filters.append(f"aresample={RESAMPLE_HZ}")
    if normalize:   filters.append("loudnorm=I=-16:LRA=11:TP=-1.5")
    af = ",".join(filters) if filters else "anull"

    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-i", str(src), "-vn", "-ac", "2", "-af", af,
        "-c:a", codec, "-b:a", TRANSCODE_BITRATE, "-f", fmt, str(out_path)
    ]
    log.info("[Transcode] %s -> %s (normalize=%s)", src.name, out_path.name, normalize)

    try:
        subprocess.run(cmd, check=True)
        if out_path.exists() and out_path.stat().st_size > 0:
            return out_path
    except subprocess.CalledProcessError:
        log.error("[Transcode] Failed for %s", src.name)
    return None

def transcode_stream(src: Path, normalize: bool, target: str):
    if not ffmpeg_exists():
        return None, None

    if target == "opus":
        codec, fmt, mime = "libopus", "ogg", "audio/ogg"
    else:
        codec, fmt, mime = "libmp3lame", "mp3", "audio/mpeg"

    filters = []
    if RESAMPLE_HZ: filters.append(f"aresample={RESAMPLE_HZ}")
    if normalize:   filters.append("loudnorm=I=-16:LRA=11:TP=-1.5")
    af = ",".join(filters) if filters else "anull"

    cmd = [
        "ffmpeg", "-v", "error", "-nostdin",
        "-i", str(src), "-vn", "-ac", "2", "-af", af,
        "-c:a", codec, "-b:a", TRANSCODE_BITRATE, "-f", fmt, "pipe:1"
    ]

    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, bufsize=65536)

    def generate():
        try:
            while True:
                chunk = proc.stdout.read(65536)
                if not chunk:
                    break
                yield chunk
        finally:
            if proc.poll() is None:
                proc.kill()

    return stream_with_context(generate()), mime

# =====================================================
# Routes
# =====================================================
@wavebox_bp.get("/")
def index():
    return render_template("sounds.html")

# -------- Cached Folder Tree (12h per-folder) --------
@wavebox_bp.get("/api/tree")
def api_tree():
    rel = (request.args.get("path") or "").strip()
    # per-folder cache key; "root" when empty
    cache_key = f"tree_{rel or 'root'}"
    cached = disk_cache_get(cache_key)
    if cached:
        return jsonify(cached)

    path = MEDIA_ROOT / rel
    if not path.exists() or not path.is_dir():
        abort(404)

    data = build_tree(path, rel)
    disk_cache_set(cache_key, data)
    return jsonify(data)

# -------- Cached Stats (12h) --------
@wavebox_bp.get("/api/stats")
def api_stats():
    cache_key = "stats"
    cached = disk_cache_get(cache_key)
    if cached:
        return jsonify(cached)

    folders, files, total = collect_stats(MEDIA_ROOT)
    payload = {
        "folders": folders,
        "files": files,
        "bytes": total,
        "human_size": human_size(total),
        "updated_at": int(time.time())
    }
    disk_cache_set(cache_key, payload)
    return jsonify(payload)

# -------- Cached Random (12h) --------
@wavebox_bp.get("/api/random")
def api_random():
    # cache the playable list for fast selection
    cache_key = "files"
    filelist = disk_cache_get(cache_key)
    if filelist is None:
        filelist = all_playables()
        disk_cache_set(cache_key, filelist)

    if not filelist:
        return jsonify({"ok": False, "error": "No audio files found"}), 404
    return jsonify({"ok": True, "path": random.choice(filelist)})

# -------- Media (direct) --------
@wavebox_bp.get("/media/<path:relpath>")
def media(relpath):
    p = safe_join_media(relpath)
    if not p.exists() or not is_allowed_file(p):
        abort(404)

    # Direct send with HTTP conditional handling (supports range by Werkzeug)
    return send_file(
        p,
        mimetype=mimetypes.guess_type(p.name)[0] or "application/octet-stream",
        conditional=True
    )

# -------- Stream (transcode/normalize) --------
@wavebox_bp.get("/stream/<path:relpath>")
def stream(relpath):
    src = safe_join_media(relpath)
    if not src.exists() or not is_allowed_file(src):
        abort(404)

    normalize = request.args.get("normalize", "0") == "1"
    ext = src.suffix.lower()

    # If MP3 and no normalization requested -> direct
    if ext == ".mp3" and not normalize:
        return media(relpath)

    target = "mp3" if (ext == ".mp3" and not normalize) else TRANSCODE_FORMAT_NON_MP3

    if CACHE_TRANSCODE:
        cached = transcode_to_cache(src, normalize, target)
        if cached:
            mime = "audio/mpeg" if target == "mp3" else "audio/ogg"
            return send_file(cached, mimetype=mime, conditional=True)

    generator, mime = transcode_stream(src, normalize, target)
    if not generator:
        # fallback to direct file (may be slow if non-mp3)
        return media(relpath)

    resp = Response(generator, mimetype=mime)
    resp.headers["X-Transcoded"] = "1"
    if normalize:
        resp.headers["X-Normalized"] = "1"
    return resp

# -------- Cache Maintenance Endpoints --------
@wavebox_bp.post("/api/refresh-cache")
@wavebox_bp.get("/api/refresh-cache")  # allow GET for convenience
def refresh_cache_all():
    n = disk_cache_clear_all()
    return jsonify({"ok": True, "cleared": n, "ttl": CACHE_TTL})

@wavebox_bp.post("/api/refresh-cache/tree")
@wavebox_bp.get("/api/refresh-cache/tree")
def refresh_cache_tree():
    rel = (request.args.get("path") or "").strip()
    key = f"tree_{rel or 'root'}"
    ok = disk_cache_delete(key)
    return jsonify({"ok": ok, "key": key})

# ---------------- Error handlers ----------------
@wavebox_bp.errorhandler(404)
def not_found(e):
    return jsonify({"ok": False, "error": "Not found"}), 404

@wavebox_bp.errorhandler(403)
def forbidden(e):
    return jsonify({"ok": False, "error": "Forbidden"}), 403
