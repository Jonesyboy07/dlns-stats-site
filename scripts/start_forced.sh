#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

PYTHON_EXE="${PYTHON_EXE:-python3}"

echo
echo "========================================"
echo "  Starting Waitress (Flask)"
echo "========================================"
echo

echo "[1/3] Preparing frontend build..."
"$SCRIPT_DIR/build_frontend.sh"

echo "[2/3] Starting Waitress..."
echo "Listening on http://127.0.0.1:5050"

exec "$PYTHON_EXE" -m waitress \
    --listen=127.0.0.1:5050 \
    --threads=12 \
    --channel-timeout=180 \
    wsgi:app
