"""Resolve the site's optional content-addressed CDN asset URLs."""
import os
from urllib.parse import quote, urlsplit

import requests
from flask import current_app, g, url_for


def site_asset_urls():
    if hasattr(g, 'cdn_site_asset_urls'):
        return g.cdn_site_asset_urls
    g.cdn_site_asset_urls = {}
    public = os.getenv('CDN_PUBLIC_BASE_URL', '').strip().rstrip('/')
    manifest_base = os.getenv('CDN_MANIFEST_BASE_URL', '').strip().rstrip('/')
    if not public or not manifest_base:
        return g.cdn_site_asset_urls
    if any(urlsplit(base).scheme not in ('http', 'https') or not urlsplit(base).netloc
           for base in (public, manifest_base)):
        current_app.logger.error('Invalid CDN_PUBLIC_BASE_URL or CDN_MANIFEST_BASE_URL')
        return g.cdn_site_asset_urls
    try:
        response = requests.get(f'{manifest_base}/__cdn/site-assets', timeout=(0.5, 1))
        response.raise_for_status()
        payload = response.json()
        files = payload['files']
        if payload['version'] != 1 or not isinstance(files, dict):
            raise ValueError('Invalid CDN site asset manifest')
        for name, path in files.items():
            if not isinstance(name, str) or not isinstance(path, str) or not path.startswith('__site_assets/'):
                raise ValueError('Invalid CDN site asset entry')
        g.cdn_site_asset_urls = {
            name: f"{public}/{quote(path, safe='/')}" for name, path in files.items()
        }
    except (requests.RequestException, ValueError, KeyError, TypeError):
        current_app.logger.warning('Could not resolve CDN site assets; using local URLs', exc_info=True)
    return g.cdn_site_asset_urls


def site_asset_url(filename: str) -> str:
    return site_asset_urls().get(filename) or url_for('static', filename=filename)


def stylesheet_url(filename: str) -> str:
    return site_asset_url(filename)
