from __future__ import annotations

from flask_caching import Cache

# Shared Cache instance. Initialized in app factory via cache.init_app(app, config=...).
cache: Cache = Cache()