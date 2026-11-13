"""Run the main website and, when enabled, its CDN asset synchronizer."""
from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

from dotenv import load_dotenv

PROJECT = Path(__file__).resolve().parents[1]


def main():
    os.chdir(PROJECT)
    load_dotenv(PROJECT / '.env')
    enabled = bool(os.getenv('CDN_PUBLIC_BASE_URL', '').strip())
    manifest_enabled = bool(os.getenv('CDN_MANIFEST_BASE_URL', '').strip())
    if enabled != manifest_enabled:
        raise RuntimeError('Set both CDN_PUBLIC_BASE_URL and CDN_MANIFEST_BASE_URL, or leave both empty')
    processes = []
    try:
        if enabled:
            subprocess.run([sys.executable, '-m', 'scripts.sync_cdn_assets'], check=True)
            processes.append(subprocess.Popen([sys.executable, '-m', 'scripts.sync_cdn_assets', '--watch']))
        processes.append(subprocess.Popen([
            sys.executable, '-m', 'waitress', '--listen=127.0.0.1:5050',
            '--threads=12', '--channel-timeout=180', 'wsgi:app',
        ]))
        while True:
            for process in processes:
                status = process.poll()
                if status is not None:
                    if process is not processes[-1] and status == 0:
                        status = 1
                    print(f'Process {process.pid} exited with status {status}', file=sys.stderr, flush=True)
                    return status
            time.sleep(0.5)
    except KeyboardInterrupt:
        return 0
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
        for process in processes:
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()


if __name__ == '__main__':
    sys.exit(main())
