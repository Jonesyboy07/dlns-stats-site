from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from flask import current_app


def _project_root() -> Path:
    return Path(current_app.root_path).parent.parent


def _default_help_config() -> dict[str, Any]:
    return {
        "title": "Help & Contribute",
        "intro": "Want to help improve DLNS Stats? Pick a task that fits your time and skill level.",
        "banner": {
            "enabled": True,
            "badge": "Help wanted",
            "title": "Want to help the project?",
            "message": "We are looking for people who can help improve DLNS Stats with data cleanup, UI polish, and documentation.",
            "details": [
                "Match data cleanup and validation",
                "UI, accessibility, and layout polish",
                "Documentation, bug fixes, and feature ideas",
            ],
            "cta": {
                "label": "Read the help page",
                "url": "/help",
            },
        },
        "sections": [
            {
                "id": "small",
                "title": "Small Contributions",
                "icon": "⚡",
                "accent": "#6366f1",
                "body": "Found a bug, typo, or small UI issue? These are the easiest places to start.",
                "bullets": [
                    "Bug fixes",
                    "UI improvements",
                    "Documentation updates",
                    "Small feature additions",
                    "Code optimizations",
                ],
                "cta": {
                    "label": "View Repository",
                    "url": "https://github.com/Jonesyboy07/dlns-stats-site",
                },
            },
            {
                "id": "major",
                "title": "Major Contributions",
                "icon": "🚀",
                "accent": "#8b5cf6",
                "body": "Have bigger ideas or want to collaborate regularly? We can use help with larger features.",
                "bullets": [
                    "New major features",
                    "Architecture discussions",
                    "Long-term project planning",
                    "Regular collaboration",
                    "Backend improvements",
                ],
                "cta": {
                    "label": "Message on Discord",
                    "url": "https://discord.com",
                },
            },
            {
                "id": "getting-started",
                "title": "Getting Started",
                "icon": "🛠",
                "accent": "#10b981",
                "body": "A practical path to jump in and make a change.",
                "steps": [
                    "Fork the repository on GitHub",
                    "Clone your fork locally",
                    "Install dependencies with pip install -r requirements.txt",
                    "Make your changes",
                    "Test your changes",
                    "Submit a pull request",
                ],
                "subsections": [
                    {
                        "title": "Tech Stack",
                        "bullets": [
                            "Backend: Python Flask",
                            "Templates: Jinja templating engine",
                            "Database: SQLite",
                            "Styling: PicoCSS, CSS (inline & file-based)",
                            "JavaScript: File-based JavaScript",
                            "Caching: Flask-Caching",
                        ],
                    },
                ],
            },
        ],
        "support": {
            "title": "Other Ways to Help",
            "body": "Not a developer? You can still help by supporting the project, sharing it, or sending feedback.",
            "links": [
                {
                    "label": "Ko-fi",
                    "url": "",
                },
                {
                    "label": "Patreon",
                    "url": "",
                },
            ],
        },
    }


def _config_path() -> Path:
    configured = current_app.config.get("HELP_CONFIG_PATH") or current_app.config.get("SITE_BANNER_PATH")
    if configured:
        return Path(str(configured)).resolve()
    return _project_root() / "data" / "help_config.json"


def _normalize_help_config(raw: Any) -> dict[str, Any]:
    default = _default_help_config()
    if not isinstance(raw, dict):
        return default

    banner_raw = raw.get("banner")
    if not isinstance(banner_raw, dict):
        banner_raw = raw

    cta_raw = banner_raw.get("cta") if isinstance(banner_raw.get("cta"), dict) else default["banner"]["cta"]
    details = banner_raw.get("details") if isinstance(banner_raw.get("details"), list) else default["banner"]["details"]

    sections_raw = raw.get("sections") if isinstance(raw.get("sections"), list) else default["sections"]
    sections: list[dict[str, Any]] = []
    for section in sections_raw:
        if not isinstance(section, dict):
            continue
        normalized: dict[str, Any] = {
            "id": str(section.get("id") or "section").strip(),
            "title": str(section.get("title") or "").strip(),
            "icon": str(section.get("icon") or "").strip(),
            "accent": str(section.get("accent") or "").strip(),
            "body": str(section.get("body") or "").strip(),
        }
        for key in ("bullets", "steps"):
            value = section.get(key)
            if isinstance(value, list):
                normalized[key] = [str(item).strip() for item in value if str(item).strip()]
        sub_raw = section.get("subsections")
        if isinstance(sub_raw, list):
            subsections: list[dict[str, Any]] = []
            for subsection in sub_raw:
                if not isinstance(subsection, dict):
                    continue
                subsections.append(
                    {
                        "title": str(subsection.get("title") or "").strip(),
                        "bullets": [
                            str(item).strip()
                            for item in (subsection.get("bullets") if isinstance(subsection.get("bullets"), list) else [])
                            if str(item).strip()
                        ],
                    }
                )
            if subsections:
                normalized["subsections"] = subsections
        cta = section.get("cta") if isinstance(section.get("cta"), dict) else None
        if cta:
            normalized["cta"] = {
                "label": str(cta.get("label") or "").strip(),
                "url": str(cta.get("url") or "").strip(),
            }
        sections.append(normalized)

    support_raw = raw.get("support") if isinstance(raw.get("support"), dict) else default["support"]
    support_links = support_raw.get("links") if isinstance(support_raw.get("links"), list) else default["support"]["links"]
    fallback_links: list[dict[str, str]] = []
    kofi_url = str(current_app.config.get("KOFI_URL") or "").strip()
    patreon_url = str(current_app.config.get("PATREON_URL") or "").strip()
    if kofi_url:
        fallback_links.append({"label": "Ko-fi", "url": kofi_url})
    if patreon_url:
        fallback_links.append({"label": "Patreon", "url": patreon_url})
    if not any(str(link.get("url") or "").strip() for link in support_links if isinstance(link, dict)):
        support_links = fallback_links or support_links

    return {
        "title": str(raw.get("title") or default["title"]).strip(),
        "intro": str(raw.get("intro") or default["intro"]).strip(),
        "banner": {
            "enabled": bool(banner_raw.get("enabled", default["banner"]["enabled"])),
            "badge": str(banner_raw.get("badge") or default["banner"]["badge"]).strip(),
            "title": str(banner_raw.get("title") or default["banner"]["title"]).strip(),
            "message": str(banner_raw.get("message") or default["banner"]["message"]).strip(),
            "details": [str(item).strip() for item in details if str(item).strip()],
            "cta": {
                "label": str(cta_raw.get("label") or default["banner"]["cta"]["label"]).strip(),
                "url": str(cta_raw.get("url") or default["banner"]["cta"]["url"]).strip(),
            },
        },
        "sections": sections,
        "support": {
            "title": str(support_raw.get("title") or default["support"]["title"]).strip(),
            "body": str(support_raw.get("body") or default["support"]["body"]).strip(),
            "links": [
                {
                    "label": str(link.get("label") or "").strip(),
                    "url": str(link.get("url") or "").strip(),
                }
                for link in support_links
                if isinstance(link, dict)
            ],
        },
    }


def load_help_config() -> dict[str, Any]:
    path = _config_path()
    fallback_path = _project_root() / "data" / "site_banner.json"
    try:
        with path.open("r", encoding="utf-8-sig") as f:
            raw = json.load(f)
    except FileNotFoundError:
        try:
            with fallback_path.open("r", encoding="utf-8-sig") as f:
                raw = json.load(f)
        except FileNotFoundError:
            return _default_help_config()
        except Exception:
            return _default_help_config()
    except Exception:
        return _default_help_config()
    return _normalize_help_config(raw)


def save_help_config(payload: dict[str, Any]) -> dict[str, Any]:
    path = _config_path()
    normalized = _normalize_help_config(payload)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as f:
        json.dump(normalized, f, ensure_ascii=False, indent=2)
        f.write("\n")
    tmp_path.replace(path)
    return normalized