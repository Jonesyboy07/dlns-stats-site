"""Submit URLs to IndexNow (Bing, Yandex, Seznam and friends).

Useful after ingesting matches or publishing an interview. The site must already
serve the key at ``https://<BASE_URL host>/<INDEXNOW_KEY>.txt``.

    python scripts/indexnow_ping.py --recent 50
    python scripts/indexnow_ping.py /matches/123 /interviews/42
    python scripts/indexnow_ping.py https://dlns-stats.co.uk/players

Exits non-zero when IndexNow rejects the submission, so a deployment script can
notice instead of silently skipping the ping.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

from dotenv import load_dotenv

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))
load_dotenv(PROJECT_ROOT / ".env")

from backend.app.indexnow import recent_paths, submit_urls  # noqa: E402
from backend.app.main_web import create_app  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Submit URLs to IndexNow.")
    parser.add_argument("urls", nargs="*", help="Paths or absolute URLs to submit")
    parser.add_argument(
        "--recent",
        type=int,
        default=0,
        metavar="N",
        help="Also submit the N newest recorded matches",
    )
    args = parser.parse_args(argv)

    if not args.urls and args.recent <= 0:
        parser.error("provide at least one URL or --recent N")

    # A CLI ping should not kick off the web app's cache warmup crawler.
    os.environ.setdefault("CACHE_WARMUP_ON_STARTUP", "false")
    app = create_app()

    with app.app_context():
        paths = list(args.urls)
        if args.recent > 0:
            paths.extend(recent_paths(args.recent))
        paths = list(dict.fromkeys(paths))
        result = submit_urls(paths)

    if result["ok"]:
        print(f"IndexNow accepted {result.get('submitted', len(paths))} URL(s) (HTTP {result['status']}).")
        return 0
    print(f"IndexNow submission failed: {result['message']}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
