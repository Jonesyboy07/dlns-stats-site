from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict


SPEC_PATH = Path(__file__).with_name("openapi_spec.json")


def get_openapi_spec() -> Dict[str, Any]:
    """Load the OpenAPI specification from JSON."""
    with SPEC_PATH.open("r", encoding="utf-8") as spec_file:
        return json.load(spec_file)