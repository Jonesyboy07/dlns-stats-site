from __future__ import annotations

import json
from importlib import import_module
from pathlib import Path
from typing import Any

from flask import Blueprint, Flask


REGISTRY_FILE = Path(__file__).with_name("registry.json")


def _load_blueprint_specs() -> list[dict[str, str]]:
    with REGISTRY_FILE.open("r", encoding="utf-8") as fp:
        data = json.load(fp)

    if not isinstance(data, list):
        raise RuntimeError("blueprints/registry.json must contain a list.")

    specs: list[dict[str, str]] = []
    for index, item in enumerate(data):
        if not isinstance(item, dict):
            raise RuntimeError(f"Invalid blueprint entry at index {index}: expected object.")

        module = item.get("module")
        attr = item.get("attr")
        if not isinstance(module, str) or not module:
            raise RuntimeError(f"Invalid module at index {index}.")
        if not isinstance(attr, str) or not attr:
            raise RuntimeError(f"Invalid attr at index {index}.")

        specs.append({"module": module, "attr": attr})

    return specs


def load_blueprints() -> list[Blueprint]:
    blueprints: list[Blueprint] = []

    for spec in _load_blueprint_specs():
        module_name = spec["module"]
        attr_name = spec["attr"]

        module = import_module(f"blueprints.{module_name}")
        candidate: Any = getattr(module, attr_name, None)
        if not isinstance(candidate, Blueprint):
            raise RuntimeError(
                f"blueprints.{module_name}.{attr_name} is missing or not a Flask Blueprint."
            )

        blueprints.append(candidate)

    return blueprints


def register_blueprints(app: Flask) -> None:
    for blueprint in load_blueprints():
        app.register_blueprint(blueprint)
