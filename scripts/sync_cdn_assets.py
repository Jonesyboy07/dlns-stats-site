"""Publish content-addressed website assets to the CDN."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import os
import posixpath
import re
import tempfile
import time
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

from dotenv import load_dotenv

from backend.app.cdn_storage import cdn_root, resolve_path, short_hash
from backend.app.cdn_logging import configure_cdn_logging

PROJECT = Path(__file__).resolve().parents[1]
MANIFEST = '.site-assets-manifest.json'
CDN_MANAGED_STATIC_FILES = frozenset({
    'android-chrome-192x192.png',
    'android-chrome-512x512.png',
    'apple-touch-icon.png',
    'favicon-16x16.png',
    'favicon-32x32.png',
    'favicon.ico',
    'site.webmanifest',
})
URL_RE = re.compile(r'url\(\s*(["\']?)([^)"\']+)\1\s*\)', re.IGNORECASE)
logger = logging.getLogger('dlns.cdn_sync')


def _atomic_write(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp_name = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix='.cdn-sync-', delete=False) as temp:
            temp_name = temp.name
            temp.write(data)
        os.chmod(temp_name, 0o644)
        os.replace(temp_name, path)
        temp_name = None
    finally:
        if temp_name is not None:
            os.unlink(temp_name)


def _hashed_name(name: str, data: bytes, *, full: bool = False) -> str:
    directory, filename = posixpath.split(name)
    stem, suffix = posixpath.splitext(filename)
    digest = hashlib.sha256(data).hexdigest()
    return posixpath.join(directory, f'{stem}.{digest if full else short_hash(digest)}{suffix}')


def _rewrite_css(data: bytes, name: str, assets: dict[str, str]) -> bytes:
    text = data.decode('utf-8')

    def replace(match):
        raw = match.group(2).strip()
        parsed = urlsplit(raw)
        if parsed.scheme or parsed.netloc or raw.startswith(('#', '//', 'data:')):
            return match.group(0)
        path = unquote(parsed.path)
        if path.startswith('/static/') or path.startswith('/public/'):
            key = path.split('/', 2)[2]
        elif path.startswith('/'):
            return match.group(0)
        else:
            key = posixpath.normpath(posixpath.join(posixpath.dirname(name), path))
        target = assets.get(key)
        if not target:
            return match.group(0)
        rewritten = '/' + quote(target, safe='/')
        if parsed.query:
            rewritten += '?' + parsed.query
        if parsed.fragment:
            rewritten += '#' + parsed.fragment
        return f'url("{rewritten}")'

    return URL_RE.sub(replace, text).encode('utf-8')


def _mirror_file(root: Path, name: str, source: Path) -> None:
    try:
        target = resolve_path(root, name)
    except ValueError as error:
        logger.warning('Skipping protected CDN mirror path %s: %s', name, error)
        return

    source_stat = source.stat()
    if target.is_file():
        target_stat = target.stat()
        if target_stat.st_size == source_stat.st_size and target_stat.st_mtime_ns == source_stat.st_mtime_ns:
            return
    elif target.exists():
        raise RuntimeError(f'CDN mirror target is not a file: {name}')

    _atomic_write(target, source.read_bytes())
    os.utime(target, ns=(source_stat.st_atime_ns, source_stat.st_mtime_ns))
    logger.info('Mirrored %s', name)


def sync():
    root = cdn_root()
    sources = {}
    mirror_sources = {}
    for folder in ('static', 'public'):
        folder_root = PROJECT / folder
        for source in folder_root.rglob('*'):
            if not source.is_file() or source.is_symlink():
                continue
            relative = source.relative_to(folder_root).as_posix()
            if folder == 'static' and relative in CDN_MANAGED_STATIC_FILES:
                continue
            mirror_sources[f'{folder}/{relative}'] = source
            static_name = f'static/{relative}'
            if folder == 'public':
                if relative not in CDN_MANAGED_STATIC_FILES:
                    mirror_sources[static_name] = source
            else:
                mirror_sources.setdefault(static_name, source)

        for kind in ('css', 'fonts', 'images'):
            source_root = folder_root / kind
            for source in source_root.rglob('*'):
                if source.is_file() and not source.is_symlink():
                    relative = source.relative_to(PROJECT / folder).as_posix()
                    resolve_path(root, f'__site_assets/{relative}')
                    sources[relative] = source
    app_css = PROJECT / 'public' / 'react-app' / 'assets' / 'App.css'
    if app_css.is_file():
        sources['react-app/assets/App.css'] = app_css

    for name, source in mirror_sources.items():
        _mirror_file(root, name, source)

    assets = {}

    def publish(name, data):
        target_name = _hashed_name(f'__site_assets/{name}', data)
        target = resolve_path(root, target_name)
        if target.exists() and (not target.is_file() or target.read_bytes() != data):
            logger.warning('Short hash collision for %s; using full hash', target_name)
            target_name = _hashed_name(f'__site_assets/{name}', data, full=True)
            target = resolve_path(root, target_name)
            if target.exists() and (not target.is_file() or target.read_bytes() != data):
                raise RuntimeError(f'CDN hash collision or invalid published file: {target_name}')
        if not target.is_file():
            _atomic_write(target, data)
            logger.info('Published %s', target_name)
            print(f'Published {target_name}', flush=True)
        assets[name] = target_name

    for name, source in sources.items():
        if not name.lower().endswith('.css'):
            publish(name, source.read_bytes())
    for name, source in sources.items():
        if name.lower().endswith('.css'):
            publish(name, _rewrite_css(source.read_bytes(), name, assets))

    manifest_path = root / MANIFEST
    manifest = json.dumps({'version': 1, 'files': assets}, sort_keys=True).encode('utf-8')
    if not manifest_path.is_file() or manifest_path.read_bytes() != manifest:
        _atomic_write(manifest_path, manifest)
        logger.info('Updated site asset manifest; assets=%d', len(assets))
    # Only remove the unversioned copies formerly generated by this sync tool.
    for name in sources:
        old = resolve_path(root, f'__site_assets/{name}')
        if old.is_file():
            old.unlink()
            logger.info('Removed old managed copy __site_assets/%s', name)
            print(f'Removed old managed copy __site_assets/{name}', flush=True)


def main():
    load_dotenv(PROJECT / '.env')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--watch', action='store_true', help='Repeat every 5 seconds')
    args = parser.parse_args()
    configure_cdn_logging(logger, 'cdn_sync.log')
    logger.info('CDN asset sync started; watch=%s', args.watch)
    try:
        while True:
            sync()
            if not args.watch:
                logger.info('CDN asset sync completed')
                return
            time.sleep(5)
    except Exception:
        logger.exception('CDN asset sync failed')
        raise


if __name__ == '__main__':
    main()
