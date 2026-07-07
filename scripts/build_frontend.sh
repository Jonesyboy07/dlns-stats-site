#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

NPM_EXE="${NPM_EXE:-npm}"

if [ ! -d "frontend" ]; then
    echo "Frontend folder not found."
    exit 1
fi

cd frontend

if [ ! -d "node_modules" ]; then
    echo "Installing frontend dependencies..."
    "$NPM_EXE" install
fi

echo "Building frontend..."
"$NPM_EXE" run build

echo "Frontend build complete."
