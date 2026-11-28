"""Run worker.py on a demo in its own process and read back its result.

Parsing happens out of process for isolation: boon is native code chewing through a
300 MB file, and a crash, a hang or a memory blow-up must cost one match, not the whole
sweep. The child gets a hard timeout.

The interpreter is `DEMO_PYTHON` when set, else this one. Pointing DEMO_PYTHON at a
separate virtualenv is how a different boon (say, an older one for pre-patch demos)
is used without touching the site's own environment.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Optional

WORKER = Path(__file__).with_name("worker.py")
DEFAULT_TIMEOUT_S = 600
# Enough of the child's stderr to explain a failure without flooding the status row.
_ERROR_TAIL = 800


class DemoParseError(Exception):
    """The worker failed, timed out, or produced unreadable output."""


def demo_python(explicit: Optional[str] = None) -> str:
    """The interpreter that runs the worker."""
    return explicit or os.environ.get("DEMO_PYTHON") or sys.executable


def run_worker(
    demo_path: Path,
    out_path: Path,
    *,
    timeout_s: float = DEFAULT_TIMEOUT_S,
    python: Optional[str] = None,
) -> dict:
    """Parse `demo_path` in a child process; returns the worker's result dict."""
    command = [demo_python(python), "-I", str(WORKER), str(demo_path), str(out_path)]
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout_s,
        )
    except subprocess.TimeoutExpired as exc:
        raise DemoParseError(f"parser timed out after {timeout_s:.0f}s") from exc
    except OSError as exc:
        raise DemoParseError(f"could not start the parser ({command[0]}): {exc}") from exc

    if completed.returncode != 0:
        tail = (completed.stderr or completed.stdout or "").strip()[-_ERROR_TAIL:]
        raise DemoParseError(f"parser exited with {completed.returncode}: {tail}")

    try:
        with open(out_path, "r", encoding="utf-8") as handle:
            result = json.load(handle)
    except (OSError, ValueError) as exc:
        raise DemoParseError(f"parser output unreadable: {exc}") from exc
    if not isinstance(result, dict) or "series" not in result:
        raise DemoParseError("parser output is missing its series")
    return result
