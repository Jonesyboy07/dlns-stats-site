from __future__ import annotations

import os
from pathlib import Path
from flask import Flask, render_template, request, redirect, url_for, send_from_directory, make_response, Response
from flask_compress import Compress
try:
    import markdown
except ImportError:
    markdown = None

import json
import hashlib
from email.utils import formatdate
from datetime import datetime, timezone
from db_api import bp as db_api_bp, get_ro_conn
from cache import cache
from dotenv import load_dotenv
from expo import expo_bp
from stats_bp import stats_bp
from heroes import get_hero_name
from sitemap import sitemap_bp
from onelane import onelane_bp


def create_app() -> Flask:
    # Load .env if present
    load_dotenv()
    app = Flask(__name__)
    app.config['DATABASE_PATH'] = Path('./data/dlns.sqlite3')
    app.config['BASE_URL'] = 'https://dlns-stats.co.uk'  # Change this to your real domain
    app.config['OG_IMAGE'] = os.getenv('OG_IMAGE', 'og.png')  # place og.png in /static
    
    # Default DB path is ./data/dlns.sqlite3 from current working directory
    default_db = Path.cwd() / "data" / "dlns.sqlite3"
    app.config["DB_PATH"] = os.getenv("DB_PATH", str(default_db))
    app.config["API_LATEST_LIMIT"] = int(os.getenv("API_LATEST_LIMIT", "20"))
    # Cache config (simple default; can switch to Redis/Memcached via env)
    cache_config = {
        "CACHE_TYPE": os.getenv("CACHE_TYPE", "SimpleCache"),
        "CACHE_DEFAULT_TIMEOUT": int(os.getenv("CACHE_DEFAULT_TIMEOUT", "60")),
    }
    cache.init_app(app, config=cache_config)
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
            "application/x-ndjson",          
            "text/markdown",                 
            "text/csv",                      
            "text/tab-separated-values",     
        ],
        TEMPLATES_AUTO_RELOAD=False,
    )
    compress.init_app(app)

    # Register blueprints
    app.register_blueprint(db_api_bp)
    app.register_blueprint(expo_bp)
    app.register_blueprint(stats_bp)
    app.register_blueprint(sitemap_bp)
    app.register_blueprint(onelane_bp) 

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
            YOUTUBE_URL=app.config["YOUTUBE_URL"],
            TWITCH_URL=app.config["TWITCH_URL"],
            DEADLOCK_URL=app.config["DEADLOCK_URL"],
            KOFI_URL=app.config["KOFI_URL"],
            PATREON_URL=app.config["PATREON_URL"],
            BASE_URL=app.config["BASE_URL"].rstrip('/'),
        )

    # If templates call get_hero_name, expose it:
    @app.context_processor
    def inject_helpers():
        return dict(get_hero_name=get_hero_name)

    def _abs(url_path: str) -> str:
        base = app.config['BASE_URL'].rstrip('/')
        if not url_path:
            return base + '/'
        return url_path if url_path.startswith('http') else (base + url_path if url_path.startswith('/') else base + '/' + url_path)

    def _og_image_abs() -> str:
        return _abs(url_for('static', filename=app.config['OG_IMAGE']))

    @app.get("/")
    @cache.cached(timeout=60, query_string=True)
    def index():  # type: ignore
        # Filters
        order = (request.args.get("order") or "desc").lower()
        order = "asc" if order == "asc" else "desc"
        team = request.args.get("team") or ""
        game_mode = request.args.get("game_mode") or ""
        match_mode = request.args.get("match_mode") or ""
        limit = 20

        with get_ro_conn() as conn:
            # Distinct values for select options
            gms = [r[0] for r in conn.execute("SELECT DISTINCT game_mode FROM matches WHERE game_mode IS NOT NULL ORDER BY 1").fetchall() if r[0]]
            mms = [r[0] for r in conn.execute("SELECT DISTINCT match_mode FROM matches WHERE match_mode IS NOT NULL ORDER BY 1").fetchall() if r[0]]

            sql = (
                "SELECT match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, start_time, created_at FROM matches"
            )
            conds = []
            params = []
            if team in ("0", "1"):
                conds.append("winning_team = ?")
                params.append(int(team))
            if game_mode:
                conds.append("game_mode = ?")
                params.append(game_mode)
            if match_mode:
                conds.append("match_mode = ?")
                params.append(match_mode)
            if conds:
                sql += " WHERE " + " AND ".join(conds)
            sql += f" ORDER BY COALESCE(start_time, created_at) {'ASC' if order == 'asc' else 'DESC'} LIMIT ?"
            params.append(limit)
            cur = conn.execute(sql, tuple(params))
            latest = [
                {
                    "match_id": r[0],
                    "duration_s": r[1],
                    "winning_team": r[2],
                    "match_outcome": r[3],
                    "game_mode": r[4],
                    "match_mode": r[5],
                    "start_time": r[6],
                    "created_at": r[7],
                }
                for r in cur.fetchall()
            ]
        return render_template(
            "home.html",
            latest=latest,
            order=order,
            team=team,
            game_mode=game_mode,
            match_mode=match_mode,
            limit=limit,
            game_modes=gms,
            match_modes=mms,
            # SEO
            meta_title="DLNS Stats • Latest Matches",
            meta_desc="Fan made site for DLNS (Deadlock Night Shift). Has DLNS + Fight Night games that are possible to grab through API. Explore stats across all logged games.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )

    @app.get("/search")
    @cache.cached(timeout=30, query_string=True)
    def search():  # type: ignore
        q = (request.args.get("q") or "").strip()
        if not q:
            return render_template(
                "search.html",
                q="",
                users=[],
                meta_title="DLNS Stats • Search",
                meta_desc="Search DLNS users and matches.",
                meta_image=_og_image_abs(),
                meta_url=_abs(request.path),
            )
        if q.isdigit():
            return redirect(url_for("match_detail", match_id=int(q)))
        # Otherwise, search users by persona
        with get_ro_conn() as conn:
            cur = conn.execute(
                "SELECT account_id, persona_name FROM users WHERE persona_name LIKE ? ORDER BY persona_name LIMIT 50",
                (f"%{q}%",),
            )
            users = [{"account_id": r[0], "persona_name": r[1]} for r in cur.fetchall()]
        return render_template(
            "search.html",
            q=q,
            users=users,
            meta_title=f"Search • {q} • DLNS Stats",
            meta_desc=f"Search results for “{q}” on DLNS Stats.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.full_path.split('?',1)[0] + ('?' + request.query_string.decode() if request.query_string else '')),
        )

    @app.get("/matches/<int:match_id>")
    @cache.cached(timeout=60, query_string=True)
    def match_detail(match_id: int):  # type: ignore
        team_filter = request.args.get("team") or ""
        with get_ro_conn() as conn:
            mcur = conn.execute(
                "SELECT match_id, duration_s, winning_team, match_outcome, game_mode, match_mode, start_time, created_at FROM matches WHERE match_id = ?",
                (match_id,)
            )
            mrow = mcur.fetchone()
            if not mrow:
                return render_template("match.html", match=None, players=[]), 404
            match = {
                "match_id": mrow[0],
                "duration_s": mrow[1],
                "winning_team": mrow[2],
                "match_outcome": mrow[3],
                "game_mode": mrow[4],
                "match_mode": mrow[5],
                "start_time": mrow[6],
                "created_at": mrow[7],
            }
            if team_filter in ("0", "1"):
                pcur = conn.execute(
                    "SELECT p.*, u.persona_name FROM players p LEFT JOIN users u ON u.account_id = p.account_id WHERE p.match_id = ? AND p.team = ? ORDER BY p.team, p.player_slot",
                    (match_id, int(team_filter))
                )
            else:
                pcur = conn.execute(
                    "SELECT p.*, u.persona_name FROM players p LEFT JOIN users u ON u.account_id = p.account_id WHERE p.match_id = ? ORDER BY p.team, p.player_slot",
                    (match_id,)
                )
            cols = [c[0] for c in pcur.description]
            players = [dict(zip(cols, row)) for row in pcur.fetchall()]
        # Build a concise description
        dur = format_duration(match["duration_s"]) if match else "-"
        wteam = team_name(match["winning_team"]) if match else "Unknown"
        when = match.get("start_time") or match.get("created_at") if match else None
        desc_bits = [f"Match {match_id}", f"Duration {dur}", f"Winning Team {wteam}"]
        if when: 
            desc_bits.append(f"Played at {when}")
        meta = dict(
            meta_title=f"Match {match_id} • DLNS Stats",
            meta_desc=" • ".join(desc_bits),
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )
        return render_template("match.html", match=match, players=players, team_filter=team_filter, **meta)

    @app.get("/users/<int:account_id>")
    @cache.cached(timeout=60, query_string=True)
    def user_detail(account_id: int):  # type: ignore
        order = (request.args.get("order") or "desc").lower()
        order = "asc" if order == "asc" else "desc"
        res = (request.args.get("res") or "").lower()  # win|loss|''
        teamf = request.args.get("team") or ""
        limit = 20
        with get_ro_conn() as conn:
            ucur = conn.execute(
                "SELECT account_id, persona_name, updated_at FROM users WHERE account_id = ?",
                (account_id,)
            )
            urow = ucur.fetchone()
            if not urow:
                return render_template("user.html", user=None, stats=None, matches=[]), 404
            user = {"account_id": urow[0], "persona_name": urow[1], "updated_at": urow[2]}
            scur = conn.execute("SELECT * FROM user_stats WHERE account_id = ?", (account_id,))
            scolumns = [c[0] for c in scur.description] if scur.description else []
            srow = scur.fetchone()
            stats = dict(zip(scolumns, srow)) if srow else None
            sql = (
                "SELECT p.match_id, p.team, p.result, p.hero_id, p.kills, p.deaths, p.assists, p.creep_kills, p.last_hits, p.denies, p.shots_hit, p.shots_missed, p.player_damage, p.obj_damage, p.player_healing, p.pings_count, m.duration_s, m.winning_team, m.start_time, m.created_at "
                "FROM players p JOIN matches m ON m.match_id = p.match_id WHERE p.account_id = ?"
            )
            params = [account_id]
            if res in ("win", "loss"):
                sql += " AND p.result = ?"
                params.append("Win" if res == "win" else "Loss")
            if teamf in ("0", "1"):
                sql += " AND p.team = ?"
                params.append(int(teamf))
            sql += f" ORDER BY COALESCE(m.start_time, m.created_at) {'ASC' if order == 'asc' else 'DESC'} LIMIT ?"
            params.append(limit)
            mcur = conn.execute(sql, tuple(params))
            mcols = [c[0] for c in mcur.description]
            matches = [dict(zip(mcols, row)) for row in mcur.fetchall()]
        plays = (stats or {}).get("matches_played", None)
        kd = (stats or {}).get("avg_kda", None)
        wr = (stats or {}).get("winrate", None)
        bits = [f"Player {user['persona_name']}"]
        if plays is not None: 
            bits.append(f"Matches {plays}")
        if wr is not None: 
            bits.append(f"Winrate {round(wr * 100, 1)}%")
        if kd is not None: 
            bits.append(f"Avg KDA {round(kd, 2)}")
        meta = dict(
            meta_title=f"{user['persona_name']} • DLNS Stats",
            meta_desc=" • ".join(bits) or "DLNS player profile and match history.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )
        return render_template("user.html", user=user, stats=stats, matches=matches, order=order, res=res, teamf=teamf, limit=limit, **meta)

    @app.get("/updates")
    @cache.cached(timeout=300)
    def updates():  # type: ignore
        """Render the updates page from markdown file."""
        updates_file = Path(app.config["DB_PATH"]).parent / "update.md"
        
        if not updates_file.exists():
            content = "<h1>Updates</h1><p>No updates file found.</p>"
        else:
            try:
                with open(updates_file, 'r', encoding='utf-8') as f:
                    md_content = f.read()
                
                if markdown:
                    # Convert markdown to HTML with extensions for better formatting
                    content = markdown.markdown(
                        md_content, 
                        extensions=['extra', 'codehilite', 'toc']
                    )
                else:
                    # Fallback: basic HTML conversion if markdown not available
                    content = md_content.replace('\n\n', '</p><p>').replace('\n', '<br>')
                    content = f"<p>{content}</p>"
                    # Basic markdown-like formatting
                    import re
                    content = re.sub(r'^# (.+)$', r'<h1>\1</h1>', content, flags=re.MULTILINE)
                    content = re.sub(r'^## (.+)$', r'<h2>\1</h2>', content, flags=re.MULTILINE)
                    content = re.sub(r'^### (.+)$', r'<h3>\1</h3>', content, flags=re.MULTILINE)
                    content = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', content)
                    content = re.sub(r'\*(.+?)\*', r'<em>\1</em>', content)
                    
            except Exception as e:
                content = f"<h1>Updates</h1><p>Error reading updates file: {e}</p>"
        
        return render_template(
            "updates.html",
            content=content,
            meta_title="Updates • DLNS Stats",
            meta_desc="Latest updates and changes for DLNS Stats.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )

    @app.route('/favicon.ico')
    def favicon():  # type: ignore
        return send_from_directory(app.static_folder, 'favicon.ico', mimetype='image/vnd.microsoft.icon')

    @app.get("/community")
    def community():  # type: ignore
        groups = load_community_groups()
        html = render_template(
            "community.html",
            groups=groups,
            meta_title="Community • DLNS Stats",
            meta_desc="Support the Deadlock community. Links to YouTube, Twitch, Ko‑fi, Patreon, and more.",
            meta_image=_og_image_abs(),
            meta_url=_abs(request.path),
        )
        resp = make_response(html)
        etag, lastmod = _file_etag_and_lastmod(COMMUNITY_FILE)
        if etag:
            resp.headers["ETag"] = etag
        if lastmod:
            resp.headers["Last-Modified"] = lastmod
        resp.headers["Cache-Control"] = "no-cache"
        return resp

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

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(host="0.0.0.0", port=5050, debug=False)
