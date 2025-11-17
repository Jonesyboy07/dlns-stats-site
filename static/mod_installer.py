#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Deadlock Mod Installer
Fully GUI-based mod installer with:
- PySide6 interface
- SQLite installed-mod tracking
- Error logging (wiped on launch)
- Version check with server
- Auto-detect Deadlock folder
- GameInfo.gi patch
- Safe pakXX_dir.vpk naming
- Dark UI theme
"""

import os
import sys
import json
import uuid
import shutil
import sqlite3
import logging
import traceback
from pathlib import Path
from datetime import datetime

import requests
from PySide6.QtCore import Qt
from PySide6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QLabel,
    QPushButton, QFileDialog, QMessageBox, QListWidget,
    QListWidgetItem, QHBoxLayout, QProgressBar
)
from PySide6.QtGui import QPalette, QColor

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SERVER_URL = "https://dlns-stats.co.uk"
API_MODS = f"{SERVER_URL}/gluten/api/mods"
API_VERSION = f"{SERVER_URL}/gluten/api/version"

APP_NAME = "Mod Installer"
APPDATA_DIR = Path(os.getenv("APPDATA")) / APP_NAME
DB_PATH = APPDATA_DIR / "mods.db"
LOG_PATH = APPDATA_DIR / "installer.log"

LOCAL_VERSION = "1.0.0"  # Update before building EXE


# ---------------------------------------------------------------------------
# Logging Setup (wipe each launch)
# ---------------------------------------------------------------------------

def setup_logging():
    APPDATA_DIR.mkdir(parents=True, exist_ok=True)
    if LOG_PATH.exists():
        LOG_PATH.unlink()

    logging.basicConfig(
        filename=str(LOG_PATH),
        level=logging.DEBUG,
        format="[%(asctime)s] %(levelname)s: %(message)s"
    )
    logging.info("Log initialized; starting installer.")


setup_logging()


# ---------------------------------------------------------------------------
# SQLite Setup
# ---------------------------------------------------------------------------

def init_db():
    logging.info("Initializing SQLite DB...")
    APPDATA_DIR.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        CREATE TABLE IF NOT EXISTS installed_mods (
            id TEXT PRIMARY KEY,
            title TEXT,
            original_filename TEXT,
            stored_filename TEXT,
            installed_at TEXT
        )
    """)
    conn.commit()
    conn.close()


def record_install(mod):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
        INSERT OR REPLACE INTO installed_mods
        (id, title, original_filename, stored_filename, installed_at)
        VALUES (?, ?, ?, ?, ?)
    """, (
        mod["id"],
        mod["title"],
        mod["original_filename"],
        mod["stored_filename"],
        datetime.utcnow().isoformat() + "Z"
    ))
    conn.commit()
    conn.close()
    logging.info(f"Recorded install: {mod['id']}")


# ---------------------------------------------------------------------------
# Utility Functions
# ---------------------------------------------------------------------------

def msg(title, text, icon=QMessageBox.Information):
    m = QMessageBox()
    m.setIcon(icon)
    m.setWindowTitle(title)
    m.setText(text)
    m.exec()


def detect_deadlock():
    """Try to locate Deadlock in standard Steam installation."""
    logging.info("Attempting Deadlock auto-detection...")

    steam_default = Path("C:/Program Files (x86)/Steam/steamapps/common/Deadlock")
    alt_steam = Path("C:/Program Files/Steam/steamapps/common/Deadlock")

    for path in [steam_default, alt_steam]:
        if path.exists():
            logging.info(f"Detected Deadlock at: {path}")
            return path

    logging.warning("Deadlock not detected.")
    return None


def patch_gameinfo(gameinfo_path: Path):
    """Apply your custom SearchPaths to GameInfo.gi."""
    logging.info(f"Patching GameInfo: {gameinfo_path}")

    new_search = """
        SearchPaths
        {
            Game_Language        citadel_*LANGUAGE*
            Game                citadel/addons
            Mod                 citadel
            Write               citadel          
            Game                citadel
            Write               core
            Mod                 core
            Game                core
        }
    """

    text = gameinfo_path.read_text(errors="ignore")

    # Replace old SearchPaths fully
    import re
    patched = re.sub(
        r"SearchPaths\s*\{.*?\}",
        new_search,
        text,
        flags=re.DOTALL
    )

    gameinfo_path.write_text(patched, encoding="utf-8")
    logging.info("GameInfo patched successfully.")


def safe_copy_mod(vpk_bytes, target_dir: Path):
    """Copy mod as pakXX_dir.vpk and increment the number."""
    logging.info("Saving mod to target folder...")

    target_dir.mkdir(parents=True, exist_ok=True)

    for i in range(99):
        filename = f"pak{str(i).zfill(2)}_dir.vpk"
        fullpath = target_dir / filename
        if not fullpath.exists():
            fullpath.write_bytes(vpk_bytes)
            logging.info(f"Written mod file: {fullpath}")
            return fullpath

    raise RuntimeError("No available pakXX_dir.vpk slot!")


# ---------------------------------------------------------------------------
# Main GUI
# ---------------------------------------------------------------------------

class InstallerUI(QWidget):
    def __init__(self):
        super().__init__()
        self.setWindowTitle(APP_NAME)
        self.resize(600, 500)

        self.deadlock_path = detect_deadlock()

        self.layout = QVBoxLayout(self)

        # Title
        title = QLabel("Deadlock Mod Installer")
        title.setAlignment(Qt.AlignCenter)
        title.setStyleSheet("font-size: 22px; font-weight: bold;")
        self.layout.addWidget(title)

        # Version Check
        self.version_label = QLabel("Checking server version...")
        self.version_label.setAlignment(Qt.AlignCenter)
        self.layout.addWidget(self.version_label)

        # Mod List
        self.mod_list = QListWidget()
        self.layout.addWidget(self.mod_list)

        # Buttons
        row = QHBoxLayout()
        self.btn_refresh = QPushButton("Refresh Mods")
        self.btn_refresh.clicked.connect(self.fetch_mods)
        row.addWidget(self.btn_refresh)

        self.btn_browse = QPushButton("Pick Game Folder")
        self.btn_browse.clicked.connect(self.pick_folder)
        row.addWidget(self.btn_browse)

        self.layout.addLayout(row)

        self.btn_install = QPushButton("Install Selected Mod")
        self.btn_install.clicked.connect(self.install_selected)
        self.layout.addWidget(self.btn_install)

        # Progress
        self.progress = QProgressBar()
        self.progress.setVisible(False)
        self.layout.addWidget(self.progress)

        self.apply_dark_mode()

        # Start
        self.check_version()
        self.fetch_mods()

    # ----------------------------------------------------------------------

    def apply_dark_mode(self):
        palette = QPalette()
        palette.setColor(QPalette.Window, QColor(25, 25, 25))
        palette.setColor(QPalette.WindowText, Qt.white)
        palette.setColor(QPalette.Base, QColor(35, 35, 35))
        palette.setColor(QPalette.Text, Qt.white)
        palette.setColor(QPalette.Button, QColor(45, 45, 45))
        palette.setColor(QPalette.ButtonText, Qt.white)
        palette.setColor(QPalette.Highlight, QColor(70, 130, 180))
        self.setPalette(palette)

    # ----------------------------------------------------------------------

    def check_version(self):
        try:
            r = requests.get(API_VERSION, timeout=5)
            server_version = r.json().get("version", "unknown")

            if server_version != LOCAL_VERSION:
                self.version_label.setText(
                    f"Version: {LOCAL_VERSION} (Update available: {server_version})"
                )
            else:
                self.version_label.setText(f"Version OK: {LOCAL_VERSION}")

        except Exception as e:
            logging.error("Version check failed", exc_info=True)
            self.version_label.setText("Version check failed")

    # ----------------------------------------------------------------------

    def fetch_mods(self):
        self.mod_list.clear()
        try:
            r = requests.get(API_MODS, timeout=5)
            mods = r.json().get("mods", [])

            for mod in mods:
                item = QListWidgetItem(f"{mod['title']} ({mod['original_filename']})")
                item.setData(Qt.UserRole, mod)
                self.mod_list.addItem(item)

        except Exception as e:
            logging.error("Failed fetching mods", exc_info=True)
            msg("Error", "Failed to fetch mods.", QMessageBox.Critical)

    # ----------------------------------------------------------------------

    def pick_folder(self):
        folder = QFileDialog.getExistingDirectory(self, "Select Deadlock Folder")
        if folder:
            self.deadlock_path = Path(folder)

    # ----------------------------------------------------------------------

    def install_selected(self):
        item = self.mod_list.currentItem()
        if not item:
            msg("No Selection", "Pick a mod first.")
            return

        mod = item.data(Qt.UserRole)

        if not self.deadlock_path:
            msg("Missing Game", "Deadlock folder not selected.")
            return

        try:
            self.progress.setVisible(True)
            self.progress.setValue(10)

            # Download mod
            r = requests.get(mod["download_url"], timeout=30)
            if r.status_code != 200:
                raise RuntimeError("Download failed")
            self.progress.setValue(50)

            vpk_bytes = r.content

            # Install mod
            addons_dir = self.deadlock_path / "game" / "citadel" / "addons"
            installed = safe_copy_mod(vpk_bytes, addons_dir)
            self.progress.setValue(75)

            # Patch GameInfo
            gameinfo = self.deadlock_path / "game" / "citadel" / "gameinfo.gi"
            if gameinfo.exists():
                patch_gameinfo(gameinfo)

            record_install(mod)
            self.progress.setValue(100)

            msg("Success", f"Installed mod:\n{mod['title']}")
            logging.info(f"Installed: {mod['title']} -> {installed}")

        except Exception as e:
            logging.error("Install failed", exc_info=True)
            msg("Error", f"Install failed:\n{e}", QMessageBox.Critical)

        finally:
            self.progress.setVisible(False)


# ---------------------------------------------------------------------------
# Entry Point (Crash-Safe)
# ---------------------------------------------------------------------------

def run():
    try:
        init_db()
        app = QApplication(sys.argv)
        ui = InstallerUI()
        ui.show()
        sys.exit(app.exec())
    except Exception as e:
        logging.error("Fatal crash", exc_info=True)
        traceback_text = traceback.format_exc()
        msg("Fatal Error", traceback_text, QMessageBox.Critical)
        raise


if __name__ == "__main__":
    run()
