from __future__ import annotations

from flask_caching import Cache

# Shared Cache instance
# Initialize with app in the create_app factory
cache = Cache()