from __future__ import annotations
import json
import os
from pathlib import Path
from typing import Dict, Optional
from threading import RLock

# Allow override via env; default to ./data/hero_names.json
_HERO_NAMES_PATH = Path(os.getenv("HERO_NAMES_PATH", str(Path.cwd() / "data" / "hero_names.json")))

_lock = RLock()
_names: Dict[str, str] = {}
_mtime: Optional[float] = None

def _load_if_needed() -> None:
    """Load hero names from JSON file if needed."""
    global _mtime, _names
    try:
        if not _HERO_NAMES_PATH.exists():
            print(f"Warning: Hero names file not found at {_HERO_NAMES_PATH}")
            return
            
        current_mtime = _HERO_NAMES_PATH.stat().st_mtime
        if _mtime is None or current_mtime != _mtime:
            print(f"Loading hero names from {_HERO_NAMES_PATH}")
            with open(_HERO_NAMES_PATH, 'r', encoding='utf-8') as f:
                data = json.load(f)
                
                # Handle nested structure - extract the "heroes" key
                heroes_data = data.get("heroes", data)  # Fall back to root if no "heroes" key
                
                # Convert keys to strings to match what the API expects
                _names.clear()
                for k, v in heroes_data.items():
                    _names[str(k)] = str(v)
            _mtime = current_mtime
            print(f"Loaded {len(_names)} hero names")
    except Exception as e:
        print(f"Error loading hero names: {e}")

def get_hero_name(hero_id: int | None) -> str:
    """Get hero name by ID, with fallback."""
    if hero_id is None:
        return "Unknown"
    
    with _lock:
        _load_if_needed()
        return _names.get(str(hero_id), f"Hero {hero_id}")

# Load on import
with _lock:
    _load_if_needed()