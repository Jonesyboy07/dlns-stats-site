"""Add public GET routes missing from docs/openapi_spec.json.

Hand-written entries are never modified. Summaries come from view docstrings and
query parameters are discovered from `request.args.get("name")` in the view source,
so re-run this after adding routes and then refine the generated stubs.

    python scripts/sync_openapi.py          # write changes
    python scripts/sync_openapi.py --check  # exit 1 if routes are undocumented
    python scripts/sync_openapi.py --infer  # fill placeholder response schemas from live data
"""
from __future__ import annotations

import inspect
import json
import os
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
os.environ.setdefault("CACHE_WARMUP_ON_STARTUP", "false")

from backend.app.main_web import create_app  # noqa: E402

SPEC = ROOT / "docs" / "openapi_spec.json"
PREFIXES = ("/db/", "/api/", "/auth/api/")
SKIP = ("/db/help-config", "/api/docs", "/api/openapi.json", "/api/a/")
TAGS = {
    "/db/heroes": "Heroes",
    "/db/matches": "Matches",
    "/db/users": "Users",
    "/db/stats": "Stats",
    "/db/search": "Search",
    "/db/team": "Teams",
    "/db/series": "Matches",
    "/db/nightshift": "Stats",
    "/db/items": "Items",
    "/db/players": "Players",
    "/db/weeks": "Stats",
    "/api/community": "Community",
    "/api/updates": "Community",
}
TAG_DESCRIPTIONS = {
    "Teams": "Team rosters, results, and weekly performance.",
    "Items": "Item name dictionaries.",
    "Players": "Global player listings.",
    "Site": "Site-level metadata such as streams and banners.",
}
CONVERTER = re.compile(r"<(?:(\w+)(?:\([^)]*\))?:)?(\w+)>")
QUERY_ARG = re.compile(r"request\.args\.(?:get|getlist)\(\s*[\"'](\w+)[\"']")


def _tag(rule: str) -> str:
    for prefix, tag in TAGS.items():
        if rule.startswith(prefix):
            return tag
    return "Site"


def _path_params(rule: str) -> list[dict]:
    params = []
    for conv, name in CONVERTER.findall(rule):
        params.append(
            {
                "name": name,
                "in": "path",
                "required": True,
                "description": f"{name.replace('_', ' ').capitalize()}.",
                "schema": {"type": "integer" if conv == "int" else "string"},
            }
        )
    return params


def _query_params(view) -> list[dict]:
    try:
        source = inspect.getsource(view)
    except (OSError, TypeError):
        return []
    names = list(dict.fromkeys(QUERY_ARG.findall(source)))
    return [
        {
            "name": n,
            "in": "query",
            "required": False,
            "description": f"Optional `{n}` filter.",
            "schema": {"type": "string"},
        }
        for n in names
    ]


def _summary(view, rule: str) -> tuple[str, str]:
    doc = inspect.getdoc(view) or ""
    first = doc.strip().splitlines()[0].rstrip(".") if doc.strip() else ""
    summary = first or "Get " + rule.strip("/").replace("/", " ").replace("_", " ")
    return summary, doc.strip()


def main(check: bool) -> int:
    app = create_app()
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    paths = spec["paths"]
    documented = {CONVERTER.sub(r"{\2}", p) for p in paths}
    added = []

    for rule in sorted(app.url_map.iter_rules(), key=lambda r: r.rule):
        if "GET" not in rule.methods or not rule.rule.startswith(PREFIXES):
            continue
        if rule.rule.startswith(SKIP):
            continue
        key = CONVERTER.sub(r"{\2}", rule.rule)
        if key in documented:
            continue
        view = app.view_functions[rule.endpoint]
        summary, description = _summary(view, key)
        protected = rule.rule.startswith(("/admin", "/interviews")) or "admin" in rule.rule
        entry = {
            "tags": [_tag(rule.rule)],
            "summary": summary,
            "parameters": _path_params(rule.rule) + _query_params(view),
            "responses": {
                "200": {
                    "description": "Successful response",
                    "content": {
                        "application/json": {
                            "schema": {"type": "object", "additionalProperties": True}
                        }
                    },
                },
                "404": {
                    "description": "Not found",
                    "content": {
                        "application/json": {"schema": {"$ref": "#/components/schemas/Error"}}
                    },
                },
            },
        }
        if description and description != summary:
            entry["description"] = description
        if protected:
            entry["description"] = (entry.get("description", "") + " Requires admin access.").strip()
        paths.setdefault(key, {})["get"] = entry
        documented.add(key)
        added.append(key)

    if check:
        for key in added:
            print("undocumented:", key)
        return 1 if added else 0

    existing = {t["name"] for t in spec.get("tags", [])}
    for tag in {e["get"]["tags"][0] for k, e in paths.items() if "get" in e}:
        if tag not in existing and tag in TAG_DESCRIPTIONS:
            spec.setdefault("tags", []).append({"name": tag, "description": TAG_DESCRIPTIONS[tag]})

    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Added {len(added)} paths:")
    for key in added:
        print("  ", key)
    return 0


def _infer(value, depth: int = 0) -> dict:
    """Small JSON-schema inference from a real response body."""
    if isinstance(value, bool):
        return {"type": "boolean"}
    if isinstance(value, int):
        return {"type": "integer"}
    if isinstance(value, float):
        return {"type": "number"}
    if isinstance(value, str):
        return {"type": "string"}
    if value is None:
        return {"nullable": True}
    if isinstance(value, list):
        if not value:
            return {"type": "array", "items": {}}
        merged = _infer(value[0], depth + 1)
        for item in value[1:20]:
            merged = _merge(merged, _infer(item, depth + 1))
        return {"type": "array", "items": merged}
    if isinstance(value, dict):
        if depth >= 4:
            return {"type": "object", "additionalProperties": True}
        return {
            "type": "object",
            "properties": {k: _infer(v, depth + 1) for k, v in list(value.items())[:60]},
        }
    return {}


def _merge(a: dict, b: dict) -> dict:
    if a.get("nullable") and "type" not in a:
        return {**b, "nullable": True}
    if b.get("nullable") and "type" not in b:
        return {**a, "nullable": True}
    if a.get("type") == "integer" and b.get("type") == "number":
        return b
    if a.get("type") != b.get("type"):
        return a
    if a.get("type") == "object":
        props = dict(a.get("properties", {}))
        for k, v in b.get("properties", {}).items():
            props[k] = _merge(props[k], v) if k in props else v
        return {"type": "object", "properties": props}
    if a.get("type") == "array":
        return {"type": "array", "items": _merge(a.get("items", {}), b.get("items", {}))}
    return a


PLACEHOLDER = {"type": "object", "additionalProperties": True}


def infer_schemas() -> int:
    """Replace generated placeholder response schemas with ones inferred from live data."""
    from unittest import mock

    from backend.app.cache_warmup import _discover_seed_ids

    # Offline on purpose: routes that depend on third parties are skipped, not awaited.
    block = mock.patch("requests.sessions.Session.request", side_effect=OSError("offline"))
    block.start()
    app = create_app()
    seed = _discover_seed_ids(app)
    values = {
        "match_id": seed["match_id"],
        "account_id": seed["account_id"],
        "hero_id": seed["hero_id"],
        "week": seed["event_week"],
        "event_week": seed["event_week"],
    }
    spec = json.loads(SPEC.read_text(encoding="utf-8"))
    updated = skipped = 0
    client = app.test_client()
    for key, ops in spec["paths"].items():
        get = ops.get("get")
        if not get or not key.startswith(PREFIXES) or key.startswith(SKIP):
            continue
        ok = get.get("responses", {}).get("200", {}).get("content", {}).get("application/json")
        if not ok or ok.get("schema") != PLACEHOLDER:
            continue
        url = key
        for name in re.findall(r"{(\w+)}", key):
            if values.get(name) is None:
                url = None
                break
            url = url.replace("{" + name + "}", str(values[name]))
        if url is None:
            skipped += 1
            continue
        resp = client.get(url)
        body = resp.get_json(silent=True) if resp.status_code == 200 else None
        if body is None:
            skipped += 1
            print("skipped:", key, resp.status_code)
            continue
        ok["schema"] = _infer(body)
        updated += 1
        print("inferred:", key)
    SPEC.write_text(json.dumps(spec, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Inferred {updated} schemas, skipped {skipped}.")
    return 0


if __name__ == "__main__":
    if "--infer" in sys.argv:
        raise SystemExit(infer_schemas())
    raise SystemExit(main("--check" in sys.argv))
