#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."
if [ -z "${PYTHON_EXE:-}" ]; then
    if [ -f ".venv/bin/python" ]; then PYTHON_EXE=".venv/bin/python"
    elif [ -f "venv/bin/python" ]; then PYTHON_EXE="venv/bin/python"
    else PYTHON_EXE="python3"
    fi
fi
exec "$PYTHON_EXE" -m scripts.sync_cdn_assets "$@"
