from __future__ import annotations

import os
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, make_response, Response
from flask_compress import Compress
from flask_cors import CORS
from werkzeug.exceptions import NotFound
try:
    import markdown
except ImportError:
    markdown = None

import json
import hashlib
from email.utils import formatdate
from datetime import datetime, timezone

# Import blueprints and registration helpers
from .blueprints.loader import register_blueprints
from .cache import cache
from .cache_warmup import schedule_cache_warmup
from dotenv import load_dotenv
from .heroes import get_hero_name
from .help_config import load_help_config


def _ensure_db_schema(app: Flask) -> None:
    """Create/upgrade the SQLite schema at app startup.

    The read-only API paths never run migrations, so without this the app can
    serve against a missing table (e.g. player_gold_sources / player_damage_sources)
    and 500 on every request. db_init is idempotent (CREATE IF NOT EXISTS + ALTER).
    """
    try:
        from ..main import db_connect, db_init

        db_path = Path(app.config.get("DB_PATH") or "./data/dlns.sqlite3").resolve()
        conn = db_connect(db_path)
        try:
            db_init(conn)
        finally:
            conn.close()
    except Exception:
        app.logger.exception("Failed to ensure DB schema at startup (will surface per-request)")


def create_app() -> Flask:
    # Load .env if present
    load_dotenv()
    
    # Set up paths - app is in backend/app, so we go up two levels to project root
    project_root = Path(__file__).parent.parent.parent
    template_folder = str(project_root / 'templates')
    static_folder = str(project_root / 'public')
    fallback_static_folder = project_root / 'static'
    
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)

    def _send_static_with_fallback(filename: str, mimetype: str | None = None):
        # Primary static root is /public; fall back to /static for migrated assets.
        try:
            return send_from_directory(app.static_folder, filename, mimetype=mimetype)
        except NotFound:
            return send_from_directory(str(fallback_static_folder), filename, mimetype=mimetype)
    
    # Configure MIME types for static files
    import mimetypes
    mimetypes.add_type('application/javascript', '.js')
    mimetypes.add_type('text/css', '.css')
    
    # Add secret key for sessions
    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'your-secret-key-change-this-in-production')
    
    app.config['DATABASE_PATH'] = Path('./data/dlns.sqlite3')
    app.config['BASE_URL'] = os.getenv('BASE_URL', 'http://localhost:5050')  # Use env variable
    app.config['OG_IMAGE'] = os.getenv('OG_IMAGE', 'og.png')  # place og.png in /static
    app.config['IMAGE_CDN_BASE'] = os.getenv('IMAGE_CDN_BASE', 'https://cdn.dlns-stats.co.uk/public/images')
    
    # Default DB path is ./data/dlns.sqlite3 from current working directory
    default_db = Path.cwd() / "data" / "dlns.sqlite3"
    app.config["DB_PATH"] = os.getenv("DB_PATH", str(default_db))
    app.config["API_LATEST_LIMIT"] = int(os.getenv("API_LATEST_LIMIT", "20"))
    app.config["REPLAY_SHARE_API_URL"] = (os.getenv("REPLAY_SHARE_API_URL") or "").strip()
    app.config["REPLAY_DOWNLOAD_BASE_URL"] = (os.getenv("REPLAY_DOWNLOAD_BASE_URL") or "").strip()
    app.config["REPLAY_URL_CACHE_TTL_SECONDS"] = int(
        os.getenv("REPLAY_URL_CACHE_TTL_SECONDS", str(48 * 60 * 60))
    )
    app.config["REPLAY_URL_FILE_CACHE_PATH"] = os.getenv(
        "REPLAY_URL_FILE_CACHE_PATH",
        str(project_root / "_cache" / "replay_urls.json"),
    )
    
    #Discord Info
    app.config["DISCORD_CLIENT_ID"] = os.getenv("DISCORD_CLIENT_ID")
    app.config["DISCORD_CLIENT_SECRET"] = os.getenv("DISCORD_CLIENT_SECRET")
    app.config["DISCORD_OWNER_ID"] = os.getenv("DISCORD_OWNER_ID")
    app.config["DISCORD_REDIRECT_URI"] = os.getenv("DISCORD_REDIRECT_URI")
    app.config["DISCORD_ADMIN_IDS"] = os.getenv("DISCORD_ADMIN_IDS", "")
    
    
    # Configure cache settings on app first. File-system cache survives process
    # restarts and allows much larger cache payloads than in-memory defaults.
    cache_dir = Path(
        os.getenv("CACHE_DIR", str(project_root / "_cache" / "flask_cache"))
    ).resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    app.config['CACHE_TYPE'] = os.getenv("CACHE_TYPE", "FileSystemCache")
    app.config['CACHE_DEFAULT_TIMEOUT'] = int(os.getenv("CACHE_DEFAULT_TIMEOUT", "900"))
    app.config['CACHE_DIR'] = str(cache_dir)
    app.config['CACHE_THRESHOLD'] = int(os.getenv("CACHE_THRESHOLD", "50000"))
    app.config['CACHE_IGNORE_ERRORS'] = True
    app.config['CACHE_WARMUP_ON_STARTUP'] = os.getenv("CACHE_WARMUP_ON_STARTUP", "true")
    app.config['CACHE_WARMUP_DELAY_SECONDS'] = float(os.getenv("CACHE_WARMUP_DELAY_SECONDS", "1.0"))
    
    # Initialize cache with config dict - must be BEFORE registering blueprints
    cache.init_app(app, config={
        "CACHE_TYPE": app.config['CACHE_TYPE'],
        "CACHE_DEFAULT_TIMEOUT": app.config['CACHE_DEFAULT_TIMEOUT'],
        "CACHE_DIR": app.config['CACHE_DIR'],
        "CACHE_THRESHOLD": app.config['CACHE_THRESHOLD'],
        "CACHE_IGNORE_ERRORS": app.config['CACHE_IGNORE_ERRORS'],
        })
    
    # Enable response compression site-wide (gzip/deflate, and Brotli if brotli package is present)
    compress = Compress()
    # Prefer Brotli when available; fall back to gzip. Compress virtually all text-like responses.
    app.config.update(
        COMPRESS_ALGORITHM=["br", "gzip"],
        COMPRESS_LEVEL=int(os.getenv("COMPRESS_LEVEL", "6")),
        COMPRESS_BR_LEVEL=int(os.getenv("COMPRESS_BR_LEVEL", "5")),
        COMPRESS_MIN_SIZE=int(os.getenv("COMPRESS_MIN_SIZE", "256")),
        COMPRESS_MIMETYPES=[
            "text/html",
            "text/css",
            "text/plain",
            "text/xml",
            "application/xml",
            "application/xhtml+xml",
            "image/svg+xml",
            "application/json",
            "application/ld+json",
            "application/geo+json",
            "application/manifest+json",
            "application/rss+xml",
            "application/atom+xml",
            "application/sitemap+xml",
            "application/javascript",
            "text/javascript",
            # Keep NDJSON uncompressed so streaming progress can flush per chunk.
            "text/markdown",                 
            "text/csv",                      
            "text/tab-separated-values",     
        ],
        TEMPLATES_AUTO_RELOAD=False,
    )
    compress.init_app(app)
    
    # Enable CORS for React frontend development (Vite runs on port 5173)
    # In production, restrict origins to your actual domain
    CORS(app, resources={
        r"/db/*": {
            "origins": [
                "http://localhost:5173",  # Vite dev server
                "http://127.0.0.1:5173",
                os.getenv("FRONTEND_URL", "")  # Production frontend URL
            ]
        }
    })

    # Ensure the schema exists before serving (creates any missing tables on deploy).
    _ensure_db_schema(app)

    # Register blueprints from blueprints/registry.json
    register_blueprints(app)

    # Prime key endpoints in background so first user request is warm.
    schedule_cache_warmup(app)

    # Jinja filters
    def format_duration(seconds: int | None) -> str:
        try:
            s = int(seconds or 0)
        except Exception:
            return "-"
        if s < 0:
            return "-"
        h, rem = divmod(s, 3600)
        m, sec = divmod(rem, 60)
        if h > 0:
            return f"{h}:{m:02d}:{sec:02d}"
        return f"{m}:{sec:02d}"

    def team_name(team: int | None) -> str:
        if team == 0:
            return "Amber"
        if team == 1:
            return "Sapphire"
        return "Unknown"

    app.jinja_env.filters["format_duration"] = format_duration
    app.jinja_env.filters["team_name"] = team_name

    # Expose selected environment-configurable links to templates
    app.config["YOUTUBE_URL"] = os.getenv("YOUTUBE_URL", "https://www.youtube.com/@DeadlockNightShift")
    app.config["TWITCH_URL"] = os.getenv("TWITCH_URL", "https://www.twitch.tv/deadlocknightshift")
    app.config["DEADLOCK_URL"] = os.getenv("DEADLOCK_URL", "https://store.steampowered.com/app/1422450/Deadlock/")
    app.config["KOFI_URL"] = os.getenv("KOFI_URL", "https://ko-fi.com/jonesy_alr")
    app.config["PATREON_URL"] = os.getenv("PATREON_URL", "")  # optional

    DATA_DIR = Path("data")
    COMMUNITY_FILE = DATA_DIR / "community.json"

    def ensure_community_file() -> None:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            if not COMMUNITY_FILE.exists():
                # Create a grouped default
                defaults = []
                dlns_items = []
                if app.config["YOUTUBE_URL"]:
                    dlns_items.append({
                        "name": "DLNS - YouTube",
                        "url": app.config["YOUTUBE_URL"],
                        "description": "Watch DLNS streams, VODs, and highlights."
                    })
                if app.config["TWITCH_URL"]:
                    dlns_items.append({
                        "name": "DLNS - Twitch",
                        "url": app.config["TWITCH_URL"],
                        "description": "Catch live DLNS streams every Wednesday."
                    })
                if dlns_items:
                    defaults.append({"group": "DLNS", "items": dlns_items})

                site_items = []
                if app.config["KOFI_URL"]:
                    site_items.append({
                        "name": "My Ko‑fi",
                        "url": app.config["KOFI_URL"],
                        "description": "Support the project and community. Donations help cover server costs and support future development."
                    })
                if app.config["PATREON_URL"]:
                    site_items.append({
                        "name": "Patreon",
                        "url": app.config["PATREON_URL"],
                        "description": "Become a patron to support future work."
                    })
                if site_items:
                    defaults.append({"group": "This Website", "items": site_items})

                COMMUNITY_FILE.write_text(json.dumps(defaults, ensure_ascii=False, indent=2), encoding="utf-8")
        except Exception:
            pass

    def _is_group_list(data: object) -> bool:
        # Accept groups that may contain either 'items' or nested 'groups'
        return isinstance(data, list) and all(
            isinstance(g, dict) and "group" in g and (
                ("items" in g and isinstance(g["items"], list)) or
                ("groups" in g and isinstance(g["groups"], list))
            )
            for g in (data or [])
        )

    def _is_flat_entry_list(data: object) -> bool:
        return isinstance(data, list) and all(
            isinstance(e, dict) and ("name" in e or "url" in e)
            for e in (data or [])
        )

    def _sanitize_entry(e: dict) -> dict:
        return {
            "name": (e.get("name") or "").strip(),
            "url": (e.get("url") or "").strip(),
            "description": (e.get("description") or "").strip(),
        }

    def _normalize_group(node: dict) -> dict:
        """Normalize one group node into {group: str, items: [...], groups: [...]}."""
        label = (node.get("group") or "Community").strip() or "Community"
        # Normalize items
        raw_items = node.get("items") if isinstance(node.get("items"), list) else []
        items = [_sanitize_entry(e) for e in raw_items if isinstance(e, dict)]
        # Normalize nested groups
        raw_groups = node.get("groups") if isinstance(node.get("groups"), list) else []
        groups = [_normalize_group(g) for g in raw_groups if isinstance(g, dict)]
        return {"group": label, "items": items, "groups": groups}

    def load_community_groups() -> list[dict]:
        """Return normalized groups tree:
           [{ 'group': str, 'items': [entry...], 'groups': [subgroup...] }, ...]
           Back-compat: flat list becomes one group named 'Community'.
        """
        try:
            ensure_community_file()
            with COMMUNITY_FILE.open("r", encoding="utf-8") as f:
                raw = json.load(f)

            if _is_group_list(raw):
                return [_normalize_group(g) for g in raw]  # type: ignore[arg-type]

            if _is_flat_entry_list(raw):
                items = [_sanitize_entry(e) for e in raw]  # type: ignore[arg-type]
                return [{"group": "Community", "items": items, "groups": []}]

            # Unknown shape -> empty
            return []
        except Exception:
            return []

    def _file_etag_and_lastmod(p: Path) -> tuple[str | None, str | None]:
        try:
            b = p.read_bytes()
            etag = '"' + hashlib.sha1(b).hexdigest() + f'-{len(b)}' + '"'
            st = p.stat()
            lastmod = formatdate(st.st_mtime, usegmt=True)
            return etag, lastmod
        except Exception:
            return None, None

    def cdn_image(path: str | None = None) -> str:
        base = (app.config.get("IMAGE_CDN_BASE", "") or "").strip().rstrip("/")
        clean_path = str(path or "").lstrip("/")
        if clean_path.lower().startswith("images/"):
            clean_path = clean_path[7:]
        if base:
            return f"{base}/{clean_path}" if clean_path else base
        if not clean_path:
            return url_for("static", filename="images/")
        return url_for("static", filename=f"images/{clean_path}")

    # Expose selected environment-configurable links to templates
    app.config["YOUTUBE_URL"] = os.getenv("YOUTUBE_URL", "https://www.youtube.com/@DeadlockNightShift")
    app.config["TWITCH_URL"] = os.getenv("TWITCH_URL", "https://www.twitch.tv/deadlocknightshift")
    app.config["DEADLOCK_URL"] = os.getenv("DEADLOCK_URL", "https://store.steampowered.com/app/1422450/Deadlock/")
    app.config["KOFI_URL"] = os.getenv("KOFI_URL", "https://ko-fi.com/jonesy_alr")
    app.config["PATREON_URL"] = os.getenv("PATREON_URL", "")  # optional

    DATA_DIR = Path("data")
    COMMUNITY_FILE = DATA_DIR / "community.json"

    def _file_etag_and_lastmod(p: Path) -> tuple[str | None, str | None]:
        try:
            b = p.read_bytes()
            etag = '"' + hashlib.sha1(b).hexdigest() + f'-{len(b)}' + '"'
            st = p.stat()
            lastmod = formatdate(st.st_mtime, usegmt=True)
            return etag, lastmod
        except Exception:
            return None, None

    # Context processors
    @app.context_processor
    def inject_links():
        return dict(
            YOUTUBE_URL=app.config.get("YOUTUBE_URL", ""),
            TWITCH_URL=app.config.get("TWITCH_URL", ""),
            DEADLOCK_URL=app.config.get("DEADLOCK_URL", ""),
            KOFI_URL=app.config.get("KOFI_URL", ""),
            PATREON_URL=app.config.get("PATREON_URL", ""),
            BASE_URL=app.config.get("BASE_URL", "").rstrip('/'),
            IMAGE_CDN_BASE=app.config.get("IMAGE_CDN_BASE", "").rstrip('/'),
        )

    # Add authentication context processor
    @app.context_processor
    def inject_auth():
        from .utils.auth import get_current_user, is_logged_in
        return dict(
            current_user=get_current_user(),
            is_logged_in=is_logged_in()
        )

    # If templates call get_hero_name, expose it:
    @app.context_processor
    def inject_helpers():
        return dict(get_hero_name=get_hero_name, cdn_image=cdn_image)

    @app.context_processor
    def inject_help_config():
        return dict(help_config=load_help_config())
    
    @app.template_filter("datetime")
    def format_datetime(value):
        try:
            ts = int(value)
            return datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M")
        except Exception:
            return "-"


    def _abs(url_path: str) -> str:
        base = app.config['BASE_URL'].rstrip('/')
        if not url_path:
            return base + '/'
        return url_path if url_path.startswith('http') else (base + url_path if url_path.startswith('/') else base + '/' + url_path)

    def _og_image_abs() -> str:
        return _abs(url_for('static', filename=app.config['OG_IMAGE']))

    @app.get("/")
    def index():
        return render_template("react.html", page="matchlist")

    @app.get("/search")
    def search():  # type: ignore
        return render_template("react.html", page="matchlist")

    @app.get("/matches/<int:match_id>")
    def match_detail(match_id: int):  # type: ignore
        return render_template("react.html", page="match_detail")

    @app.get("/users/<int:account_id>")
    def user_detail(account_id: int):  # type: ignore
        return render_template("react.html", page="player_detail")

    def _load_updates_html() -> str:
        """Read update.md and convert markdown to HTML for React/Jinja consumers."""
        updates_file = Path(app.config["DB_PATH"]).parent / "update.md"

        if not updates_file.exists():
            return "<h1>Updates</h1><p>No updates file found.</p>"

        try:
            with open(updates_file, 'r', encoding='utf-8') as f:
                md_content = f.read()

            if markdown:
                return markdown.markdown(
                    md_content,
                    extensions=['extra', 'codehilite', 'toc']
                )

            content = md_content.replace('\n\n', '</p><p>').replace('\n', '<br>')
            content = f"<p>{content}</p>"
            import re
            content = re.sub(r'^# (.+)$', r'<h1>\1</h1>', content, flags=re.MULTILINE)
            content = re.sub(r'^## (.+)$', r'<h2>\1</h2>', content, flags=re.MULTILINE)
            content = re.sub(r'^### (.+)$', r'<h3>\1</h3>', content, flags=re.MULTILINE)
            content = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', content)
            content = re.sub(r'\*(.+?)\*', r'<em>\1</em>', content)
            return content
        except Exception as e:
            return f"<h1>Updates</h1><p>Error reading updates file: {e}</p>"

    @app.get("/updates")
    def updates():  # type: ignore
        return render_template("react.html", page="matchlist")

    @app.get("/api/updates")
    @cache.cached(timeout=300)
    def updates_api():  # type: ignore
        return {"content_html": _load_updates_html()}

    @app.route('/favicon.ico')
    def favicon():  # type: ignore
        return _send_static_with_fallback('favicon.ico', mimetype='image/vnd.microsoft.icon')

    @app.route('/public/react-app/<path:filename>')
    def public_react_app_static(filename: str):  # type: ignore
        # Handle migrated bundle locations without breaking generated /public URLs.
        try:
            return send_from_directory(str(Path(app.static_folder) / 'react-app'), filename)
        except NotFound:
            return send_from_directory(str(fallback_static_folder / 'react-app'), filename)

    @app.route('/static/<path:filename>')
    def legacy_static(filename: str):  # type: ignore
        # Backward compatibility: older templates/chunks still request /static/* assets.
        return _send_static_with_fallback(filename)

    @app.get("/help")
    @cache.cached(timeout=30)
    def help_page():  # type: ignore
        return render_template("react.html", page="matchlist")

    @app.get("/community")
    def community():  # type: ignore
        return render_template("react.html", page="matchlist")

    # Serve raw JSON with ETag/Last-Modified for clients and Discord/Slack unfurls
    @app.get("/community.json")
    def community_json():  # type: ignore
        ensure_community_file()
        etag, lastmod = _file_etag_and_lastmod(COMMUNITY_FILE)
        inm = request.headers.get("If-None-Match")
        ims = request.headers.get("If-Modified-Since")
        if etag and inm and inm == etag:
            resp = make_response("", 304)
            resp.headers["ETag"] = etag
            if lastmod:
                resp.headers["Last-Modified"] = lastmod
            resp.headers["Cache-Control"] = "public, max-age=60"
            return resp
        if lastmod and ims:
            try:
                ims_dt = datetime.strptime(ims, "%a, %d %b %Y %H:%M:%S %Z").replace(tzinfo=timezone.utc)
                mtime = datetime.fromtimestamp(COMMUNITY_FILE.stat().st_mtime, tz=timezone.utc)
                if ims_dt >= mtime:
                    resp = make_response("", 304)
                    if etag:
                        resp.headers["ETag"] = etag
                    resp.headers["Last-Modified"] = lastmod
                    resp.headers["Cache-Control"] = "public, max-age=60"
                    return resp
            except Exception:
                pass
        payload = {"groups": load_community_groups()}
        resp = make_response(json.dumps(payload, ensure_ascii=False))
        resp.headers["Content-Type"] = "application/json; charset=utf-8"
        if etag:
            resp.headers["ETag"] = etag
        if lastmod:
            resp.headers["Last-Modified"] = lastmod
        resp.headers["Cache-Control"] = "public, max-age=60"
        return resp

    # Dynamic API (no template cache), supports read and admin update
    @app.get("/api/community")
    def community_api():  # type: ignore
        return {"groups": load_community_groups()}
    
    @app.get('/cgi-bin/<path:anything>')
    def fake_cgibin(anything):
        fake_response = "You really trying this? Nothing to be found here."
        return Response(fake_response, mimetype="text/plain", status=200)

    # API Documentation routes
    @app.get("/api/docs")
    def api_docs():  # type: ignore
        """Serve the API documentation using Swagger UI"""
        spec_url = url_for('openapi_spec')
        return render_template(
            "api_docs.html",
            spec_url=spec_url,
            meta_title="API Documentation • DLNS Stats",
            meta_desc="Complete API documentation for DLNS Stats. Access match data, player statistics, and community information.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )

    @app.get("/api/openapi.json")
    def openapi_spec():  # type: ignore
        """Serve the OpenAPI specification JSON"""
        from openapi_spec import get_openapi_spec
        
        spec = get_openapi_spec()
        # Update server URLs based on request
        base_url = request.url_root.rstrip('/')
        spec["servers"] = [
            {
                "url": base_url,
                "description": "Current server"
            }
        ]
        if base_url != "https://dlns-stats.co.uk":
            spec["servers"].append({
                "url": "https://dlns-stats.co.uk",
                "description": "Production server"
            })
        
        resp = make_response(json.dumps(spec, ensure_ascii=False, indent=2))
        resp.headers["Content-Type"] = "application/json; charset=utf-8"
        resp.headers["Cache-Control"] = "public, max-age=300"  # Cache for 5 minutes
        return resp

    return app

if __name__ == "__main__":
    app = create_app()
    app.run(port=5050, debug=False)
