#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

PYTHON_EXE="${PYTHON_EXE:-python3}"

echo "Starting Waitress on http://127.0.0.1:5050"

exec "$PYTHON_EXE" -m waitress \
    --listen=127.0.0.1:5050 \
    --threads=12 \
    --channel-timeout=180 \
    wsgi:app
