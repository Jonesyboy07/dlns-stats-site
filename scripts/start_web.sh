#!/usr/bin/env bash
set -euo pipefail

echo "========================================"
echo "  Starting Waitress (Flask)"
echo "========================================"
echo
echo "Listening on http://127.0.0.1:5050"
waitress-serve --listen=127.0.0.1:5050 wsgi:app
