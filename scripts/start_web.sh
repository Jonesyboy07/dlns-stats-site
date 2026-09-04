#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

# Prefer virtual environment Python over system Python
if [ -f ".venv/bin/python" ]; then
    PYTHON_EXE="${PYTHON_EXE:-.venv/bin/python}"
elif [ -f "venv/bin/python" ]; then
    PYTHON_EXE="${PYTHON_EXE:-venv/bin/python}"
else
    PYTHON_EXE="${PYTHON_EXE:-python3}"
fi

# Start frontend build watcher in the background (auto-rebuild on changes)
echo "Starting frontend build watcher..."
cd frontend
if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    npm install
fi
npm run build:watch &
VITE_WATCH_PID=$!
cd "$SCRIPT_DIR/.."

# Cleanup: kill the vite watcher when this script exits
cleanup() {
    echo ""
    echo "Shutting down frontend watcher..."
    kill "$VITE_WATCH_PID" 2>/dev/null || true
    wait "$VITE_WATCH_PID" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "Refreshing replay index..."
"$PYTHON_EXE" scripts/build_replay_index.py || echo "Warning: replay index refresh failed (continuing)."

echo "Starting Waitress on http://127.0.0.1:5050"

"$PYTHON_EXE" -m waitress \
    --listen=127.0.0.1:5050 \
    --threads=12 \
    --channel-timeout=180 \
    wsgi:app
