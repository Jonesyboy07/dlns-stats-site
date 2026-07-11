from __future__ import annotations
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from flask import Blueprint, Response, current_app, request, has_request_context
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

    # Public static pages
    add_url(f'{base}/', today, 'daily', '1.0')
    add_url(f'{base}/search', today, 'weekly', '0.7')
    add_url(f'{base}/help', today, 'monthly', '0.5')
    add_url(f'{base}/community', today, 'weekly', '0.6')
    add_url(f'{base}/updates', today, 'weekly', '0.6')
    add_url(f'{base}/stats/', today, 'daily', '0.9')
    add_url(f'{base}/dlns/', today, 'weekly', '0.6')

    # Dynamic content
    try:
        with get_ro_conn() as conn:
            # Matches (limit to avoid massive sitemaps)
            try:
                rows = conn.execute("""
                    SELECT match_id,
                        COALESCE(start_time, created_at) AS dt
                    FROM matches
                    ORDER BY match_id DESC
                    LIMIT 15000
                """).fetchall()
                for match_id, dt in rows:
                    add_url(f'{base}/matches/{match_id}', _safe_lastmod(dt), 'monthly', '0.6')
            except Exception as e:
                current_app.logger.warning(f"sitemap: matches query failed: {e}")

            # Users last activity (via matches only)
            try:
                rows = conn.execute("""
                    SELECT u.account_id,
                           u.persona_name,
                           MAX(COALESCE(m.start_time, m.created_at)) AS last_activity
                    FROM users u
                    LEFT JOIN players p ON u.account_id = p.account_id
                    LEFT JOIN matches m ON p.match_id = m.match_id
                    WHERE u.persona_name IS NOT NULL
                    GROUP BY u.account_id, u.persona_name
                    ORDER BY last_activity DESC NULLS LAST
                    LIMIT 15000
                """).fetchall()
            except Exception:
                # SQLite doesn't support "NULLS LAST"; remove it if it fails
                try:
                    rows = conn.execute("""
                        SELECT u.account_id,
                               u.persona_name,
                               MAX(COALESCE(m.start_time, m.created_at)) AS last_activity
                        FROM users u
                        LEFT JOIN players p ON u.account_id = p.account_id
                        LEFT JOIN matches m ON p.match_id = m.match_id
                        WHERE u.persona_name IS NOT NULL
                        GROUP BY u.account_id, u.persona_name
                        ORDER BY last_activity DESC
                        LIMIT 15000
                    """).fetchall()
                except Exception as e:
                    current_app.logger.warning(f"sitemap: users query failed: {e}")
                    rows = []

            for account_id, _persona, last_activity in rows:
                add_url(f'{base}/users/{account_id}', _safe_lastmod(last_activity), 'weekly', '0.7')

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

# Avoid internal API crawling; keep assets crawlable for rendering.
Disallow: /db/

# Optional: allow crawl of docs and app pages
Allow: /api/docs
Allow: /api/openapi.json
"""
    response = Response(robots_txt, mimetype='text/plain')
    response.headers['Cache-Control'] = 'public, max-age=3600'
    return response