"""Build/refresh the full replay index for instant replay lookups.

Run this after uploading new replay zips (e.g. when a new Night Shift week's
recordings are added to the Filebrowser share):

    python scripts/build_replay_index.py

The web server also auto-refreshes this index in the background every
REPLAY_INDEX_REFRESH_HOURS (default 6h), so this script is only needed if you
want new replays to be searchable immediately.
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from backend.app.main_web import create_app  # noqa: E402
from backend.app.blueprints.db_api import rebuild_replay_index  # noqa: E402


def main() -> int:
    app = create_app()
    with app.app_context():
        count = rebuild_replay_index()
    print(f"Replay index rebuilt: {count} replay(s) indexed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
