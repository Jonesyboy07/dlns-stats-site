"""Standalone public CDN application. Run with a production WSGI server."""
from __future__ import annotations

import hashlib
import json
import os
import re
import tempfile
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_file

from backend.app.cdn_storage import VERSION_HASH_LENGTH, cdn_root, file_hash, resolve_path, short_hash
from backend.app.cdn_logging import configure_cdn_logging

load_dotenv()

ASSET_MIME_TYPES = {
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.mjs': 'application/javascript',
    '.ttf': 'font/ttf',
    '.otf': 'font/otf',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
}


def create_cdn_app(root: Path | None = None) -> Flask:
    app = Flask(__name__, static_folder=None)
    configure_cdn_logging(app.logger, 'cdn.log')
    try:
        app.config['CDN_ROOT'] = Path(root).resolve() if root else cdn_root()
    except (OSError, RuntimeError):
        app.logger.exception('CDN startup failed')
        raise
    app.logger.info('CDN origin started; root=%s', app.config['CDN_ROOT'])

    def find_file(name: str) -> Path:
        try:
            path = resolve_path(app.config['CDN_ROOT'], name)
        except ValueError:
            abort(404)
        if not path.is_file():
            abort(404)
        return path

    @app.after_request
    def headers(response):
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['X-Content-Type-Options'] = 'nosniff'
        if response.status_code >= 400:
            response.headers['Cache-Control'] = 'no-store'
        if not request.path.startswith('/__cdn/') or response.status_code >= 400:
            app.logger.info('request method=%s path=%s status=%s cache_control=%s',
                            request.method, request.path, response.status_code,
                            response.headers.get('Cache-Control', '-'))
        return response

    @app.get('/__cdn/manifest')
    def manifest():
        names = request.args.getlist('path')
        if not names or len(names) > 32:
            abort(400, description='Provide between 1 and 32 path parameters')
        files = {}
        for name in names:
            path = find_file(name)
            files[name] = short_hash(file_hash(path))
        response = jsonify({'files': files})
        response.headers['Cache-Control'] = 'no-cache, no-store'
        return response

    @app.get('/__cdn/site-assets')
    def site_assets():
        manifest_path = app.config['CDN_ROOT'] / '.site-assets-manifest.json'
        if not manifest_path.is_file() or manifest_path.is_symlink():
            abort(503, description='Site asset manifest is not available')
        with manifest_path.open('r', encoding='utf-8') as stream:
            data = json.load(stream)
        if data.get('version') != 1 or not isinstance(data.get('files'), dict):
            app.logger.error('Invalid site asset manifest')
            abort(500)
        response = jsonify(data)
        response.headers['Cache-Control'] = 'no-store'
        return response

    @app.get('/<path:name>')
    def serve(name):
        path = find_file(name)
        version = request.args.get('v')
        hash_pattern = rf'(?:[0-9a-f]{{{VERSION_HASH_LENGTH}}}|[0-9a-f]{{16}}|[0-9a-f]{{64}})'
        if version is not None and not re.fullmatch(hash_pattern, version):
            abort(404)
        filename_hash = re.search(rf'\.({hash_pattern})(?:\.[^./]+)?$', name)
        filename_hash = filename_hash.group(1) if name.startswith('__site_assets/') and filename_hash else None
        snapshot = tempfile.TemporaryFile()
        handed_off = False
        try:
            digest = hashlib.sha256()
            size = 0
            with path.open('rb') as source:
                modified = os.fstat(source.fileno()).st_mtime
                for chunk in iter(lambda: source.read(1024 * 1024), b''):
                    digest.update(chunk)
                    size += len(chunk)
                    snapshot.write(chunk)
            digest = digest.hexdigest()
            if version is not None and not digest.startswith(version):
                abort(404)
            if filename_hash and not digest.startswith(filename_hash):
                abort(404)
            snapshot.seek(0)
            response = send_file(snapshot, download_name=path.name, mimetype=ASSET_MIME_TYPES.get(path.suffix.lower()), conditional=False,
                                 etag=digest, last_modified=modified)
            response.content_length = size
            response.make_conditional(request, accept_ranges=True, complete_length=size)
            response.call_on_close(snapshot.close)
            handed_off = True
        finally:
            if not handed_off:
                snapshot.close()
        response.headers['Cache-Control'] = (
            'public, max-age=31536000, immutable' if version or filename_hash else 'public, no-cache'
        )
        return response

    @app.errorhandler(OSError)
    def io_error(error):
        app.logger.exception('CDN filesystem error')
        return 'CDN filesystem error', 500

    return app
