#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR/.."

PYTHON_EXE="${PYTHON_EXE:-python3}"

MATCHFILE="data/matches.json"
DB_PATH="data/dlns.sqlite3"
STATUS_PATH="data/matches_status.json"
CACHE_PATH="data/user_cache.json"
CONCURRENCY="4"
RECHECK="false"

ARG="${1:-}"

case "${ARG,,}" in
    recheckall|--recheckall|full)
        RECHECK="true"
        ;;
esac

if [ ! -f "$MATCHFILE" ]; then
    echo
    echo "Match file not found: $MATCHFILE"
    exit 1
fi

echo
echo "========================================"
echo "  Updating DB from data/matches.json"
echo "========================================"
echo "DB: $DB_PATH"
echo "Match file: $MATCHFILE"
echo "Recheck all: $RECHECK"
echo

"$PYTHON_EXE" backend/main.py \
    -matchfile "$MATCHFILE" \
    -db "$DB_PATH" \
    -status "$STATUS_PATH" \
    -cache "$CACHE_PATH" \
    -concurrency "$CONCURRENCY" \
    -recheckall "$RECHECK"

echo
echo "DB update complete."
