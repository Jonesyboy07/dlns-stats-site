from __future__ import annotations

import ast
import importlib.util
import unittest
from pathlib import Path

DB_PKG = Path(__file__).resolve().parents[1] / "app" / "blueprints" / "db"


class DbPackageImportTests(unittest.TestCase):
    def test_every_relative_import_resolves(self):
        """Function-local imports only fail at request time, so check them statically."""
        bad = []
        for path in sorted(DB_PKG.glob("*.py")):
            package = f"backend.app.blueprints.db{'' if path.stem == '__init__' else ''}"
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom) or not node.level:
                    continue
                name = "." * node.level + (node.module or "")
                try:
                    resolved = importlib.util.resolve_name(name, package)
                    found = importlib.util.find_spec(resolved) is not None
                except (ImportError, ValueError, ModuleNotFoundError):
                    found = False
                if not found:
                    bad.append(f"{path.name}:{node.lineno} {name}")
        self.assertEqual(bad, [])


if __name__ == "__main__":
    unittest.main()
