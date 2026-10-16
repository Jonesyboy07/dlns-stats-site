from __future__ import annotations

"""/db routes: site."""

import os
import threading
import time
from typing import Any, Dict
import requests
from flask import jsonify, request

from ...cache import cache
from ...utils.auth import require_admin
from ...help_config import load_help_config, save_help_config
from .core import (
    bp,
)


@bp.get("/help-config")
@require_admin
def help_config():
    """Return the modular help configuration for admins."""
    resp = jsonify(load_help_config())
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.route("/help-config", methods=["PUT", "POST"])
@require_admin
def update_help_config():
    """Update the modular help configuration."""
    raw = request.get_json(silent=True)
    if not isinstance(raw, dict):
        return jsonify({"ok": False, "error": "JSON body required"}), 400

    config = save_help_config(raw)
    resp = jsonify({"ok": True, "help_config": config})
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.get("/site-banner")
@require_admin
def site_banner_alias():
    """Deprecated banner alias kept for compatibility."""
    resp = jsonify({"banner": load_help_config().get("banner", {})})
    resp.headers["Cache-Control"] = "no-store"
    return resp


# ── Twitch live status ────────────────────────────────────────────────────
# Drives the home page stream strip / widget. Credentials are read from the
# environment (TWITCH_CLIENT_ID + TWITCH_CLIENT_SECRET); when they are absent
# the endpoint reports configured=false and the UI degrades to a plain link.
_twitch_token_lock = threading.Lock()


_twitch_token: Dict[str, Any] = {"token": None, "expires_at": 0.0}


def _twitch_app_token(client_id: str, client_secret: str) -> str | None:
    """Return a memoized app access token via the client-credentials flow."""
    now = time.time()
    with _twitch_token_lock:
        token = _twitch_token.get("token")
        if token and float(_twitch_token.get("expires_at") or 0) > now + 60:
            return token

    try:
        resp = requests.post(
            "https://id.twitch.tv/oauth2/token",
            params={
                "client_id": client_id,
                "client_secret": client_secret,
                "grant_type": "client_credentials",
            },
            timeout=3,
        )
    except requests.RequestException:
        return None

    if resp.status_code != 200:
        return None

    payload = resp.json() or {}
    token = payload.get("access_token")
    if not token:
        return None

    expires_in = int(payload.get("expires_in") or 0)
    with _twitch_token_lock:
        _twitch_token["token"] = token
        _twitch_token["expires_at"] = now + max(expires_in - 60, 60)
    return token


@bp.get("/stream/status")
@cache.cached(timeout=60, stale_for=900)  # slow upstream: serve the last answer while it refreshes
def stream_status():  # type: ignore
    """Live/offline state for the DLNS Twitch channel.

    Response fields:
      configured   – whether Twitch credentials are present
      channel      – login name being checked
      channel_url  – link to open the channel
      live         – true when a stream is currently up
      title/game_name/viewer_count/started_at – set while live
      display_name/avatar_url – channel identity, when it can be resolved
      next_stream  – {start_time, title, category} from the channel schedule

    While a stream is live the identity and schedule lookups are skipped, so the
    live path costs one token request plus one /helix/streams request.
    """
    channel = (os.getenv("TWITCH_CHANNEL") or "deadlocknightshift").strip().lower()
    channel_url = f"https://www.twitch.tv/{channel}"
    client_id = (os.getenv("TWITCH_CLIENT_ID") or "").strip()
    client_secret = (os.getenv("TWITCH_CLIENT_SECRET") or "").strip()

    payload: Dict[str, Any] = {
        "configured": bool(client_id and client_secret),
        "channel": channel,
        "channel_url": channel_url,
        "live": False,
        "title": None,
        "game_name": None,
        "viewer_count": None,
        "started_at": None,
        "next_stream": None,
        "checked_at": int(time.time()),
    }

    if not payload["configured"]:
        return jsonify(payload)

    token = _twitch_app_token(client_id, client_secret)
    if not token:
        payload["error"] = "auth"
        return jsonify(payload)

    headers = {"Client-Id": client_id, "Authorization": f"Bearer {token}"}

    try:
        resp = requests.get(
            "https://api.twitch.tv/helix/streams",
            params={"user_login": channel},
            headers=headers,
            timeout=3,
        )
        if resp.status_code == 200:
            data = (resp.json() or {}).get("data") or []
            if data:
                stream = data[0]
                payload.update(
                    {
                        "live": True,
                        "title": stream.get("title"),
                        "game_name": stream.get("game_name"),
                        "viewer_count": stream.get("viewer_count"),
                        "started_at": stream.get("started_at"),
                        # /helix/streams already reports the display name, so a
                        # live stream needs no /helix/users round trip.
                        "display_name": stream.get("user_name"),
                    }
                )
        elif resp.status_code == 401:
            # Token expired early — clear it so the next request re-authenticates.
            with _twitch_token_lock:
                _twitch_token["token"] = None
                _twitch_token["expires_at"] = 0.0
        else:
            payload["error"] = f"streams:{resp.status_code}"
    except requests.RequestException:
        payload["error"] = "network"
        return jsonify(payload)

    # While a stream is up there is nothing else to look up — skipping the
    # identity and schedule calls keeps the live path to two HTTP calls.
    if payload["live"]:
        return jsonify(payload)

    # Channel identity — needed for the display name and the schedule call.
    broadcaster_id = None
    try:
        user_resp = requests.get(
            "https://api.twitch.tv/helix/users",
            params={"login": channel},
            headers=headers,
            timeout=3,
        )
        if user_resp.status_code == 200:
            users = (user_resp.json() or {}).get("data") or []
            if users:
                broadcaster_id = users[0].get("id")
                payload["display_name"] = users[0].get("display_name")
                payload["avatar_url"] = users[0].get("profile_image_url")
    except requests.RequestException:
        pass

    if not broadcaster_id:
        return jsonify(payload)

    # Next scheduled stream, when the channel publishes a schedule.
    try:
        sched_resp = requests.get(
            "https://api.twitch.tv/helix/schedule",
            params={"broadcaster_id": broadcaster_id, "first": 1},
            headers=headers,
            timeout=3,
        )
        if sched_resp.status_code == 200:
            segments = ((sched_resp.json() or {}).get("data") or {}).get("segments") or []
            if segments:
                segment = segments[0]
                payload["next_stream"] = {
                    "start_time": segment.get("start_time"),
                    "title": segment.get("title"),
                    "category": (segment.get("category") or {}).get("name"),
                }
    except requests.RequestException:
        pass

    return jsonify(payload)
