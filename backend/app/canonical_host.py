"""Canonical host and HTTPS redirects.

Cloudflare performs the primary www -> apex redirect. This middleware is a
defence-in-depth guard for requests that reach Flask directly, or if a redirect
rule is missing. It only applies to GET/HEAD and deliberately skips local and
health-check hosts so it can never turn a probe into a redirect loop.
"""

from __future__ import annotations

from urllib.parse import urlparse

from flask import Flask, current_app, redirect, request

_LOCAL_HOSTS = {"127.0.0.1", "localhost", "::1", "testserver"}


def _split_host(value: str) -> str:
    host = (value or "").strip().lower()
    if host.startswith("["):
        return host.split("]", 1)[0].lstrip("[")
    if host.count(":") == 1:
        return host.rsplit(":", 1)[0]
    return host


def _canonical_host() -> str:
    configured = str(current_app.config.get("CANONICAL_HOST", "") or "").strip()
    if configured:
        return configured.lower()
    base_url = str(current_app.config.get("BASE_URL", "") or "").strip()
    return urlparse(base_url).netloc.lower()


def _exempt_hosts() -> set[str]:
    raw = str(current_app.config.get("CANONICAL_REDIRECT_EXEMPT_HOSTS", "") or "")
    configured = {item.strip().lower() for item in raw.split(",") if item.strip()}
    return configured | _LOCAL_HOSTS


def _enabled() -> bool:
    value = current_app.config.get("CANONICAL_REDIRECTS", True)
    return str(value).strip().lower() not in {"0", "false", "no", "off"}


def _force_https() -> bool:
    raw = current_app.config.get("FORCE_HTTPS")
    if raw is None or str(raw).strip() == "":
        return str(current_app.config.get("BASE_URL", "") or "").startswith("https://")
    return str(raw).strip().lower() not in {"0", "false", "no", "off"}


def _redirect_target(canonical_host: str) -> str:
    # RAW_URI keeps the exact path/query encoding; full_path is the fallback.
    raw = request.environ.get("RAW_URI")
    if not raw or not raw.startswith("/"):
        raw = request.full_path.rstrip("?")
        if not raw.startswith("/"):
            raw = "/" + raw
    return f"https://{canonical_host}{raw}"


def register_canonical_redirect(app: Flask) -> None:
    @app.before_request
    def _canonical_redirect():
        if not _enabled() or request.method not in ("GET", "HEAD"):
            return None

        canonical_host = _canonical_host()
        if not canonical_host:
            return None

        request_host = _split_host(request.host)
        if request_host in _exempt_hosts():
            return None

        needs_host = request_host != _split_host(canonical_host)
        needs_https = _force_https() and request.scheme != "https"
        if not (needs_host or needs_https):
            return None

        target = _redirect_target(canonical_host)
        current_app.logger.debug(
            "canonical redirect %s%s -> %s", request.host, request.path, target
        )
        response = redirect(target, code=301)
        # A 301 is cached indefinitely without an explicit policy. If the proxy
        # chain briefly reports the wrong scheme, those cached redirects keep
        # replaying in browsers long after the origin is fixed, so never let a
        # canonical redirect stick in a browser cache.
        response.headers["Cache-Control"] = "no-store"
        return response
