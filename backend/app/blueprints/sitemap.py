from __future__ import annotations
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import quote
from flask import Blueprint, Response, abort, current_app, request, has_request_context
from ..heroes import get_all_hero_names
from ..indexnow import configured_key
from .db_api import get_ro_conn
from typing import Optional

sitemap_bp = Blueprint('sitemap', __name__)

# Simple in-process cache
_SITEMAP_XML_CACHE: Optional[str] = None
_SITEMAP_CACHE_AT: Optional[float] = None
_SITEMAP_TTL_SECS = 900  # 15 minutes

def _now_ts() -> float:
    return datetime.now(timezone.utc).timestamp()

def _base_url() -> str:
    configured = str(current_app.config.get('BASE_URL', '')).strip().rstrip('/')
    if configured:
        return configured
    if has_request_context():
        return request.url_root.rstrip('/')
    return 'http://localhost:5050'

def _safe_lastmod(val) -> str:
    # Accept ISO strings, or epoch (int/float), fallback to today
    try:
        if val is None:
            raise ValueError("no date")
        if isinstance(val, (int, float)):
            dt = datetime.fromtimestamp(float(val), tz=timezone.utc)
            return dt.strftime('%Y-%m-%d')
        s = str(val)
        # Try parse ISO-like strings
        try:
            dt = datetime.fromisoformat(s.replace('Z', '+00:00'))
            return dt.date().isoformat()
        except Exception:
            # Just take first 10 chars if looks like YYYY-MM-DD...
            if len(s) >= 10 and s[4] == '-' and s[7] == '-':
                return s[:10]
            return datetime.now(timezone.utc).date().isoformat()
    except Exception:
        return datetime.now(timezone.utc).date().isoformat()

def _build_sitemap_xml() -> str:
    urlset = ET.Element('urlset')
    urlset.set('xmlns', 'http://www.sitemaps.org/schemas/sitemap/0.9')

    def add_url(loc: str, lastmod: Optional[str] = None, changefreq: str = 'weekly', priority: str = '0.5'):
        url = ET.SubElement(urlset, 'url')
        ET.SubElement(url, 'loc').text = loc
        if lastmod:
            ET.SubElement(url, 'lastmod').text = lastmod
        ET.SubElement(url, 'changefreq').text = changefreq
        ET.SubElement(url, 'priority').text = priority

    base = _base_url()
    today = datetime.now(timezone.utc).date().isoformat()
    # Placeholder bracket rows have negative IDs and no duration; they are not
    # indexable match reports and must not leak into any sitemap section.
    VALID_MATCH = "match_id > 0 AND duration_s IS NOT NULL"
    VALID_MATCH_M = "m.match_id > 0 AND m.duration_s IS NOT NULL"
    # matches.start_time is a mix of epoch strings and ISO strings. Normalise to
    # YYYY-MM-DD before aggregating so MAX picks the genuinely newest match.
    MATCH_DATE_M = (
        "COALESCE("
        "CASE WHEN m.start_time GLOB '[0-9]*' AND m.start_time NOT GLOB '*-*' "
        "THEN date(CAST(m.start_time AS INTEGER), 'unixepoch') "
        "ELSE date(m.start_time) END, "
        "date(m.created_at))"
    )

    content_lastmod = today
    try:
        with get_ro_conn() as conn:
            row = conn.execute(
                f"SELECT COALESCE(start_time, created_at) FROM matches "
                f"WHERE {VALID_MATCH} ORDER BY match_id DESC LIMIT 1"
            ).fetchone()
            if row:
                content_lastmod = _safe_lastmod(row[0])
    except Exception:
        pass

    # Public static pages. URLs here must match each page's canonical link; /search,
    # admin routes and the /dlns API are deliberately absent.
    add_url(f'{base}/', content_lastmod, 'daily', '1.0')
    add_url(f'{base}/matchlist', content_lastmod, 'daily', '0.8')
    add_url(f'{base}/players', content_lastmod, 'weekly', '0.8')
    add_url(f'{base}/teams', content_lastmod, 'weekly', '0.8')
    add_url(f'{base}/heroes', content_lastmod, 'weekly', '0.9')
    add_url(f'{base}/items', None, 'weekly', '0.7')
    add_url(f'{base}/stats/', content_lastmod, 'daily', '0.9')
    add_url(f'{base}/week', content_lastmod, 'daily', '0.9')
    add_url(f'{base}/help', None, 'monthly', '0.4')
    add_url(f'{base}/community', None, 'weekly', '0.5')
    add_url(f'{base}/updates', None, 'weekly', '0.5')
    add_url(f'{base}/interviews/', None, 'weekly', '0.6')

    # Dynamic content
    try:
        with get_ro_conn() as conn:
            # Matches (limit to avoid massive sitemaps)
            try:
                rows = conn.execute(f"""
                    SELECT match_id,
                        COALESCE(start_time, created_at) AS dt
                    FROM matches
                    WHERE {VALID_MATCH}
                    ORDER BY match_id DESC
                    LIMIT 15000
                """).fetchall()
                for match_id, dt in rows:
                    add_url(f'{base}/matches/{match_id}', _safe_lastmod(dt), 'monthly', '0.6')
            except Exception as e:
                current_app.logger.warning(f"sitemap: matches query failed: {e}")

            # Players. The inner joins deliberately exclude profiles that have
            # never appeared in a recorded match (thin, no-content pages).
            try:
                rows = conn.execute(f"""
                    SELECT u.account_id,
                           MAX({MATCH_DATE_M}) AS last_activity
                    FROM users u
                    JOIN players p ON p.account_id = u.account_id
                    JOIN matches m ON m.match_id = p.match_id
                    WHERE TRIM(COALESCE(u.persona_name, '')) <> ''
                      AND {VALID_MATCH_M}
                    GROUP BY u.account_id
                    ORDER BY u.account_id DESC
                    LIMIT 15000
                """).fetchall()
                for account_id, last_activity in rows:
                    # /player/<id> is the canonical form; /users/<id> is an alias.
                    add_url(f'{base}/player/{account_id}', _safe_lastmod(last_activity), 'weekly', '0.7')
            except Exception as e:
                current_app.logger.warning(f"sitemap: users query failed: {e}")

            # Heroes only when the league has actually seen them played. A hero
            # with zero appearances renders an empty page and should not be submitted.
            try:
                known_heroes = get_all_hero_names()
                rows = conn.execute(f"""
                    SELECT p.hero_id,
                           MAX({MATCH_DATE_M}) AS last_activity
                    FROM players p
                    JOIN matches m ON m.match_id = p.match_id
                    WHERE p.hero_id IS NOT NULL
                      AND {VALID_MATCH_M}
                    GROUP BY p.hero_id
                    ORDER BY p.hero_id
                """).fetchall()
                for hero_id, last_activity in rows:
                    if str(hero_id) not in known_heroes:
                        continue
                    add_url(f'{base}/hero/{hero_id}', _safe_lastmod(last_activity), 'weekly', '0.7')
            except Exception as e:
                current_app.logger.warning(f"sitemap: heroes query failed: {e}")

            # Teams appear in the league feed rather than a separate table. The
            # window function keeps the newest spelling of each team name.
            try:
                rows = conn.execute(f"""
                    SELECT team_name, last_activity FROM (
                        SELECT team_name, last_activity,
                               ROW_NUMBER() OVER (
                                   PARTITION BY LOWER(team_name) ORDER BY match_id DESC
                               ) AS rn
                        FROM (
                            SELECT event_team_a AS team_name,
                                   COALESCE(start_time, created_at) AS last_activity,
                                   match_id
                            FROM matches
                            WHERE TRIM(COALESCE(event_team_a, '')) <> '' AND {VALID_MATCH}
                            UNION ALL
                            SELECT event_team_b AS team_name,
                                   COALESCE(start_time, created_at) AS last_activity,
                                   match_id
                            FROM matches
                            WHERE TRIM(COALESCE(event_team_b, '')) <> '' AND {VALID_MATCH}
                        )
                    )
                    WHERE rn = 1
                    ORDER BY team_name
                    LIMIT 500
                """).fetchall()
                for team_name, last_activity in rows:
                    add_url(
                        f'{base}/team/{quote(str(team_name), safe="")}',
                        _safe_lastmod(last_activity),
                        'weekly',
                        '0.7',
                    )
            except Exception as e:
                current_app.logger.warning(f"sitemap: teams query failed: {e}")

            # Week pages are stable, shareable summaries of each Night Shift week.
            try:
                rows = conn.execute(f"""
                    SELECT event_week, last_activity FROM (
                        SELECT event_week,
                               COALESCE(start_time, created_at) AS last_activity,
                               ROW_NUMBER() OVER (
                                   PARTITION BY event_week ORDER BY match_id DESC
                               ) AS rn
                        FROM matches
                        WHERE event_week IS NOT NULL
                          AND event_title = 'Night Shift'
                          AND {VALID_MATCH}
                    )
                    WHERE rn = 1
                    ORDER BY event_week DESC
                    LIMIT 300
                """).fetchall()
                for week, last_activity in rows:
                    add_url(f'{base}/week/{week}', _safe_lastmod(last_activity), 'weekly', '0.7')
            except Exception as e:
                current_app.logger.warning(f"sitemap: weeks query failed: {e}")

    except Exception as e:
        current_app.logger.error(f"sitemap build failed, returning minimal sitemap: {e}")

    xml_str = ET.tostring(urlset, encoding='unicode', method='xml')
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + xml_str

@sitemap_bp.route('/sitemap.xml')
def sitemap():
    # Cache control: allow manual flush with ?flush=1
    global _SITEMAP_XML_CACHE, _SITEMAP_CACHE_AT
    try:
        if request.args.get('flush') == '1':
            _SITEMAP_XML_CACHE = None
            _SITEMAP_CACHE_AT = None

        now = _now_ts()
        if _SITEMAP_XML_CACHE and _SITEMAP_CACHE_AT and (now - _SITEMAP_CACHE_AT) < _SITEMAP_TTL_SECS:
            response = Response(_SITEMAP_XML_CACHE, mimetype='application/xml')
            response.headers['Cache-Control'] = 'public, max-age=900'
            return response

        xml = _build_sitemap_xml()
        _SITEMAP_XML_CACHE = xml
        _SITEMAP_CACHE_AT = now
        response = Response(xml, mimetype='application/xml')
        response.headers['Cache-Control'] = 'public, max-age=900'
        return response
    except Exception as e:
        current_app.logger.error(f"sitemap route error: {e}")
        # Minimal fallback
        base = _base_url()
        minimal = f'''<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>{base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>
  <url><loc>{base}/stats/</loc><changefreq>daily</changefreq><priority>0.9</priority></url>
</urlset>'''
        response = Response(minimal, mimetype='application/xml')
        response.headers['Cache-Control'] = 'public, max-age=300'
        return response

@sitemap_bp.route('/robots.txt')
def robots():
    base = _base_url()
    robots_txt = f"""User-agent: *
Allow: /

# Canonical sitemap location
Sitemap: {base}/sitemap.xml

# Avoid internal API and admin crawling; keep assets crawlable for rendering.
Disallow: /db/
Disallow: /admin/
Disallow: /react-admin
Disallow: /interviews/upload

# Optional: allow crawl of docs and app pages
Allow: /api/docs
Allow: /api/openapi.json
"""
    response = Response(robots_txt, mimetype='text/plain')
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response


@sitemap_bp.route('/<key>.txt')
def indexnow_key(key: str):
    """Serve the IndexNow ownership key at the origin root."""
    expected = configured_key()
    if not expected or key != expected:
        abort(404)
    response = Response(expected, mimetype='text/plain')
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response