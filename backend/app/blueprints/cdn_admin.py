from __future__ import annotations

import os
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

from flask import Blueprint, current_app, jsonify, render_template, request

from ..cdn_storage import cdn_root, file_hash, resolve_path, short_hash, versioned_url
from ..utils.auth import get_current_user, require_owners

cdn_admin_bp = Blueprint('cdn_admin', __name__, url_prefix='/admin/cdn')


@cdn_admin_bp.get('/')
@require_owners
def page():
    return render_template('admin/cdn.html')


@cdn_admin_bp.post('/upload')
@require_owners
def upload():
    if os.getenv('DLNS_SANDBOX') == '1':
        return jsonify(ok=False, error='CDN uploads are disabled in sandbox mode'), 403
    origin = request.headers.get('Origin', '')
    if origin.rstrip('/') != request.host_url.rstrip('/'):
        return jsonify(ok=False, error='Invalid request origin'), 403
    try:
        limit = int(os.getenv('CDN_UPLOAD_MAX_BYTES', str(50 * 1024 * 1024)))
        if limit <= 0:
            raise ValueError('CDN_UPLOAD_MAX_BYTES must be positive')
        if request.content_length is None or request.content_length > limit + 65536:
            return jsonify(ok=False, error='Upload is too large or has no content length'), 413
        item = request.files.get('file')
        if not item or not item.filename:
            return jsonify(ok=False, error='Choose a file'), 400
        folder = request.form.get('folder', '').strip().strip('/')
        if '/' in item.filename or '\\' in item.filename:
            return jsonify(ok=False, error='Invalid filename'), 400
        name = f'{folder}/{item.filename}' if folder else item.filename
        root = cdn_root()
        destination = resolve_path(root, name)
        if name.split('/', 1)[0] in ('__cdn', '__site_assets'):
            return jsonify(ok=False, error='That path is reserved'), 400
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination = resolve_path(root, name)
        replace = request.form.get('replace') == 'true'
        if destination.exists() and not replace:
            return jsonify(ok=False, error='File exists; confirm replacement to overwrite it'), 409
        temp_name = None
        try:
            with tempfile.NamedTemporaryFile(dir=destination.parent, prefix='.cdn-upload-', delete=False) as temp:
                temp_name = temp.name
                size = 0
                while True:
                    chunk = item.stream.read(1024 * 1024)
                    if not chunk:
                        break
                    size += len(chunk)
                    if size > limit:
                        return jsonify(ok=False, error='File exceeds the upload limit'), 413
                    temp.write(chunk)
            os.chmod(temp_name, 0o644)
            digest = file_hash(Path(temp_name))
            if replace and destination.is_file():
                previous = file_hash(destination)
                if previous != digest and short_hash(previous) == short_hash(digest):
                    return jsonify(ok=False, error='Hash collision with existing file; choose a different filename'), 409
            if replace:
                os.replace(temp_name, destination)
                temp_name = None
            else:
                try:
                    os.link(temp_name, destination)
                except FileExistsError:
                    return jsonify(ok=False, error='File exists; confirm replacement to overwrite it'), 409
            digest = short_hash(digest)
        finally:
            if temp_name is not None:
                os.unlink(temp_name)
        user = get_current_user()
        current_app.logger.info('CDN upload %s by %s (%s), replace=%s', name, user['username'], user['id'], replace)
        base = os.getenv('CDN_PUBLIC_BASE_URL', '').strip()
        if not base or urlsplit(base).scheme not in ('http', 'https') or not urlsplit(base).netloc:
            return jsonify(ok=True, path=name, hash=digest, url=None,
                           warning='Set CDN_PUBLIC_BASE_URL to generate a public URL')
        return jsonify(ok=True, path=name, hash=digest, url=versioned_url(base, name, digest))
    except ValueError as error:
        return jsonify(ok=False, error=str(error)), 400
    except (OSError, RuntimeError):
        current_app.logger.exception('CDN upload failed')
        return jsonify(ok=False, error='CDN storage is unavailable; check server logs'), 500
