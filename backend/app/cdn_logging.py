"""Rotating logs for the CDN origin and the site asset synchronizer."""
from __future__ import annotations

import logging
import os
from logging.handlers import RotatingFileHandler
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def configure_cdn_logging(logger: logging.Logger, filename: str) -> None:
    log_dir = Path(os.getenv('LOG_DIR') or PROJECT_ROOT / 'logs').resolve()
    log_dir.mkdir(parents=True, exist_ok=True)
    target = log_dir / filename
    handlers = [handler for handler in logger.handlers if getattr(handler, '_cdn_file_handler', False)]
    if len(handlers) == 1 and Path(handlers[0].baseFilename) == target:
        logger.setLevel(logging.INFO)
        return
    for handler in handlers:
        logger.removeHandler(handler)
        handler.close()
    handler = RotatingFileHandler(target, maxBytes=5 * 1024 * 1024, backupCount=5, encoding='utf-8')
    handler._cdn_file_handler = True
    handler.setLevel(logging.INFO)
    handler.setFormatter(logging.Formatter('%(asctime)s [%(levelname)s] %(name)s: %(message)s'))
    logger.addHandler(handler)
    logger.setLevel(logging.INFO)
