"""
WSGI application entry point for production servers (Waitress, Gunicorn, etc.)
"""
import sys
from pathlib import Path

# Add project root to path so backend stays a real package
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.app.main_web import create_app

app = create_app()
