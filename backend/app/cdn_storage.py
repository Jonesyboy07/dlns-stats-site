"""Shared filesystem rules for the CDN and its upload tools."""
from __future__ import annotations

import hashlib
import os
from pathlib import Path, PurePosixPath
from urllib.parse import quote

BLOCKED_SUFFIXES = {
    '.env', '.db', '.sqlite', '.sqlite3', '.log', '.bak', '.backup',
    '.ini', '.conf', '.py', '.sh', '.pem', '.key',
}
VERSION_HASH_LENGTH = 8


def short_hash(digest: str) -> str:
    return digest[:VERSION_HASH_LENGTH]


def cdn_root() -> Path:
    value = os.environ.get('CDN_ROOT', '').strip()
    if not value:
        raise RuntimeError('CDN_ROOT is not configured')
    root = Path(value).resolve()
    if not root.is_dir():
        raise RuntimeError(f'CDN_ROOT is not an existing directory: {root}')
    return root


def resolve_path(root: Path, name: str) -> Path:
    if not name or '\\' in name or '\x00' in name:
        raise ValueError('Invalid path')
    parts = name.split('/')
    if any(not p or p in ('.', '..') or p.startswith('.') for p in parts):
        raise ValueError('Invalid or protected path')
    if PurePosixPath(name).suffix.lower() in BLOCKED_SUFFIXES:
        raise ValueError('Protected file type')
    path = root.joinpath(*parts)
    if any(p.is_symlink() for p in [root.joinpath(*parts[:i]) for i in range(1, len(parts) + 1)]):
        raise ValueError('Symbolic links are not allowed')
    if not path.resolve().is_relative_to(root):
        raise ValueError('Path escapes CDN root')
    return path


def file_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def versioned_url(base: str, name: str, digest: str) -> str:
    return f"{base.rstrip('/')}/{quote(name, safe='/')}?v={digest}"
