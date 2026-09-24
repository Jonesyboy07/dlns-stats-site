from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


# The tracked specification lives with the docs (docs/openapi_spec.json), not
# next to this module. `parents[2]` is the repo root because this file is
# backend/app/openapi_spec.py; the other candidates keep it working from an
# installed/source layout where the JSON sits beside the module.
_SPEC_CANDIDATES = (
    Path(__file__).resolve().parents[2] / "docs" / "openapi_spec.json",
    Path(__file__).resolve().parents[1] / "openapi_spec.json",
    Path(__file__).with_name("openapi_spec.json"),
)

SPEC_PATH = next((p for p in _SPEC_CANDIDATES if p.exists()), _SPEC_CANDIDATES[0])


def get_openapi_spec() -> Dict[str, Any]:
    """Load the OpenAPI specification from JSON."""
    with SPEC_PATH.open("r", encoding="utf-8") as spec_file:
        return json.load(spec_file)