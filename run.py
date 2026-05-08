#!/usr/bin/env python3
"""
DLNS Stats - Entry Point
Run the Flask web application
"""
import sys
from pathlib import Path

# Add project root to path so backend stays a real package
project_root = Path(__file__).parent
sys.path.insert(0, str(project_root))

from backend.app.main_web import create_app

if __name__ == '__main__':
    app = create_app()
    app.run(debug=False, host='127.0.0.1', port=5050)
