from __future__ import annotations

import json
import os
import re

import requests
from flask import Blueprint, current_app, render_template, request


dmm_bp = Blueprint("dmm", __name__, url_prefix="/dmm")

GAMEBANANA_MOD_URL_RE = re.compile(
    r"^https?://(?:www\.)?gamebanana\.com/mods/(\d+)(?:[/?#].*)?$",
    re.IGNORECASE,
)


def _extract_mod_id(mod_page_url: str) -> str | None:
    match = GAMEBANANA_MOD_URL_RE.match(mod_page_url.strip())
    if not match:
        return None
    return match.group(1)


def _debug_enabled() -> bool:
    return current_app.debug or os.getenv("DMM_SYNC_DEBUG", "").lower() in {"1", "true", "yes", "on"}


@dmm_bp.route("/", methods=["GET", "POST"])
def sync_mod():
    mod_page_url = ""
    mod_id = ""
    response_payload = None
    response_text = ""
    error = ""
    status_code = None

    if request.method == "POST":
        mod_page_url = (request.form.get("mod_page_url") or "").strip()
        mod_id = _extract_mod_id(mod_page_url) or ""

        if not mod_page_url:
            error = "Please enter a GameBanana mod page URL."
        elif not mod_id:
            error = "Invalid URL. Use format: https://gamebanana.com/mods/656087"
        else:
            endpoint = f"https://api.deadlockmods.app/api/v2/sync/{mod_id}"
            try:
                if _debug_enabled():
                    current_app.logger.info(
                        "[DMM] Sync request start mod_id=%s endpoint=%s",
                        mod_id,
                        endpoint,
                    )

                resp = requests.post(endpoint, timeout=20)
                status_code = resp.status_code

                if _debug_enabled():
                    current_app.logger.info(
                        "[DMM] Sync response status=%s content_type=%s",
                        status_code,
                        resp.headers.get("Content-Type", ""),
                    )

                try:
                    response_payload = resp.json()
                    response_text = json.dumps(response_payload, indent=2, ensure_ascii=False)
                except ValueError:
                    response_text = resp.text
                    error = "The API did not return valid JSON."
                    if _debug_enabled():
                        preview = (resp.text or "")[:500]
                        current_app.logger.warning(
                            "[DMM] Non-JSON response status=%s body_preview=%r",
                            status_code,
                            preview,
                        )
            except requests.RequestException as exc:
                error = f"Sync request failed: {exc}"
                if _debug_enabled():
                    current_app.logger.exception("[DMM] Request exception")

    return render_template(
        "dmm/sync.html",
        mod_page_url=mod_page_url,
        mod_id=mod_id,
        status_code=status_code,
        response_payload=response_payload,
        response_text=response_text,
        error=error,
    )
