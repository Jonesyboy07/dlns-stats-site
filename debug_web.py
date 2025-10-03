from __future__ import annotations
from pathlib import Path




"""

This file is intended to be a copy-paste friendly version of main_web.py, for
people who want to run the web server in a debug environment. It is not intended
to be a complete or fully functional application.

If you dont copy anything in, it will not run and error out. 
Please paste in the entirety of main_web.py (including imports) to make it work.
Use the gap below this to paste in the code.

"""




if __name__ == "__main__":
    app = create_app()

    # Build a list of files for the reloader to watch. The default Flask
    # reloader only watches the main module; passing extra_files ensures the
    # development server restarts when any project file changes.
    def _gather_watch_files(root: Path | str = '.') -> list[str]:
        root_path = Path(root)
        ignore_dirs = {'.git', '__pycache__', '.venv', 'venv', 'env'}
        files: list[str] = []
        for p in root_path.rglob('*'):
            try:
                if not p.is_file():
                    continue
                # Skip files that live inside ignored directories
                if any(part in ignore_dirs for part in p.parts):
                    continue
                files.append(str(p.resolve()))
            except Exception:
                # Ignore unreadable files
                continue
        return files

    try:
        extra_watch = _gather_watch_files(Path.cwd())
    except Exception:
        extra_watch = []

    # Start the dev server with debug and pass extra_files so any change in
    # the repo causes a restart.
    app.run(port=5050, debug=True, extra_files=extra_watch)
