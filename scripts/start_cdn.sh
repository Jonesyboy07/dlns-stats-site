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
echo "Starting CDN on http://127.0.0.1:5051"
exec "$PYTHON_EXE" -m waitress --listen=127.0.0.1:5051 --threads=8 cdn_wsgi:app
