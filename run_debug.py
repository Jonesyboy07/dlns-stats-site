#!/usr/bin/env python3
"""
DLNS Stats - Debug Entry Point
Run the Flask web application in debug mode

    python run_debug.py                     # uses data/dlns.sqlite3 and data/matches.json
    python run_debug.py --sandbox           # uses copies in data/sandbox/, made on first run
    python run_debug.py --sandbox --reset   # re-copies the real data over the sandbox
"""
import argparse
import os
import shutil
import sqlite3
import sys
from pathlib import Path

# Add project root to path so backend stays a real package
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

DATA_DIR = project_root / 'data'
SANDBOX_DIR = DATA_DIR / 'sandbox'
# Everything the app reads or writes next to the DB (the DB itself is copied separately).
SANDBOX_COPIES = ('matches.json', 'brackets.json', 'user_cache.json', 'avatar_cache.json', 'update.md')


def prepare_sandbox(reset: bool) -> Path:
    """Copy the real data into data/sandbox/ (once, or again with reset) and return the sandbox DB path."""
    db = SANDBOX_DIR / 'dlns.sqlite3'
    if reset and SANDBOX_DIR.exists():
        shutil.rmtree(SANDBOX_DIR)
    if db.exists():
        return db
    SANDBOX_DIR.mkdir(parents=True, exist_ok=True)
    real_db = DATA_DIR / 'dlns.sqlite3'
    if real_db.exists():
        # The backup API gives a consistent copy even with a -wal file beside the real DB.
        src, dst = sqlite3.connect(real_db), sqlite3.connect(db)
        try:
            src.backup(dst)
        finally:
            src.close()
            dst.close()
    for name in SANDBOX_COPIES:
        if (DATA_DIR / name).exists():
            shutil.copy2(DATA_DIR / name, SANDBOX_DIR / name)
    print(f'Sandbox data copied to {SANDBOX_DIR}')
    return db


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Run the site in debug mode.')
    parser.add_argument('--sandbox', action='store_true', help='Read and write data/sandbox/ instead of data/.')
    parser.add_argument('--reset', action='store_true', help='With --sandbox: start again from a fresh copy of data/.')
    args = parser.parse_args()
    # The reloader re-runs this file with the same argv; only the first process may reset.
    if args.sandbox:
        os.environ['DB_PATH'] = str(prepare_sandbox(args.reset and not os.environ.get('WERKZEUG_RUN_MAIN')))
        print(f"Sandbox mode: using {os.environ['DB_PATH']}")

    from backend.app.debug_web import create_app

    app = create_app()
    app.run(debug=True, host='127.0.0.1', port=5050)
