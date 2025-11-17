#!/usr/bin/env python3
"""
Deadlock Mod Installer (GUI, dark, modern)

Features
--------
- PySide6 dark, tabbed UI (Mods / Installed / Patch GameInfo / Settings / About)
- Fetches mods list from your server JSON API
- Installs mods as pakXX_dir.vpk (minimum pak01_dir.vpk) into:
    <Deadlock root>\\game\\citadel\\addons
- Patches gameinfo.gi SearchPaths block to include citadel/addons, etc.
- Stores installed mod metadata in a real SQLite database:
    %APPDATA%\\Mod Installer\\mods.db
- Logs errors to:
    %APPDATA%\\Mod Installer\\installer.log   (wiped on each launch)
- Checks installer version vs server /api/version (non-forced update)
- No “uploaded by” shown in the UI
"""


import os
import sys
import json
import re
import sqlite3
import logging
import traceback
from pathlib import Path
from datetime import datetime

import requests
from PySide6.QtWidgets import (
    QApplication,
    QWidget,
    QVBoxLayout,
    QHBoxLayout,
    QLabel,
    QPushButton,
    QListWidget,
    QListWidgetItem,
    QTextEdit,
    QTabWidget,
    QFileDialog,
    QMessageBox,
    QSpacerItem,
    QSizePolicy,
)
from PySide6.QtGui import QPalette, QColor, QFont
from PySide6.QtCore import Qt

# ---------------------------------------------------------------------------
# Constants & Paths
# ---------------------------------------------------------------------------

SERVER_BASE = "https://dlns-stats.co.uk/gluten"
API_MODS = f"{SERVER_BASE}/api/mods"
API_VERSION = f"{SERVER_BASE}/api/version"

INSTALLER_VERSION = "1.0.0"

APPDATA_ROOT = Path(os.getenv("APPDATA", Path.home() / "AppData" / "Roaming"))
APP_DIR = APPDATA_ROOT / "Mod Installer"
APP_DIR.mkdir(parents=True, exist_ok=True)

LOG_FILE = APP_DIR / "installer.log"
DB_FILENAME = "mods.db"
DB_PATH = APP_DIR / DB_FILENAME

# Deadlock paths (relative to Deadlock root)
GAMEINFO_REL = Path("game") / "citadel" / "gameinfo.gi"
ADDONS_REL = Path("game") / "citadel" / "addons"

# SearchPaths block we want to enforce in gameinfo.gi
PATCHED_SEARCHPATHS = r"""
        SearchPaths
        {
            // These are optional language paths. They must be mounted first, which is why there are first in the list.
            // *LANGUAGE* will be replaced with the actual language name. If not running a specific language, these paths will not be mounted
            Game_Language        citadel_*LANGUAGE*
            Game                citadel/addons
            Mod                 citadel
            Write               citadel
            Game                citadel
            Write               core
            Mod                 core
            Game                core
        }
""".rstrip()


# ---------------------------------------------------------------------------
# Logging & Error Handling
# ---------------------------------------------------------------------------

def setup_logging() -> None:
    """Configure logging to file and wipe on each launch."""
    try:
        # Wipe previous log
        LOG_FILE.write_text("", encoding="utf-8")
    except Exception:
        # If this fails, we still try to log to the same file
        pass

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s [%(levelname)s] %(message)s",
        handlers=[logging.FileHandler(LOG_FILE, encoding="utf-8")],
    )
    logging.info("=== Deadlock Mod Installer started ===")


def install_excepthook():
    """Capture uncaught exceptions, log them, and show a dialog."""
    def _hook(exctype, value, tb):
        logging.error("Uncaught exception", exc_info=(exctype, value, tb))
        msg = "An unexpected error occurred.\n\n"
        msg += f"{exctype.__name__}: {value}\n\n"
        msg += f"Details have been written to:\n{LOG_FILE}"
        try:
            QMessageBox.critical(None, "Unexpected Error", msg)
        except Exception:
            # If QMessageBox fails (e.g. no GUI yet), just print.
            print(msg, file=sys.stderr)

    sys.excepthook = _hook


# ---------------------------------------------------------------------------
# SQLite DB (installed mods)
# ---------------------------------------------------------------------------

def init_db() -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        """
        CREATE TABLE IF NOT EXISTS installed_mods (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL,
            filename TEXT NOT NULL,
            installed_at TEXT NOT NULL
        )
        """
    )
    conn.commit()
    conn.close()
    logging.info("Database ready at %s", DB_PATH)


def db_add_mod(mod_id: str, title: str, filename: str) -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute(
        "INSERT OR REPLACE INTO installed_mods (id, title, filename, installed_at) VALUES (?, ?, ?, ?)",
        (mod_id, title, filename, datetime.utcnow().isoformat() + "Z"),
    )
    conn.commit()
    conn.close()
    logging.info("Recorded installed mod id=%s title=%s filename=%s", mod_id, title, filename)


def db_remove_mod(mod_id: str) -> None:
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM installed_mods WHERE id = ?", (mod_id,))
    conn.commit()
    conn.close()
    logging.info("Removed mod id=%s from DB", mod_id)


def db_list_mods():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id, title, filename, installed_at FROM installed_mods ORDER BY installed_at DESC")
    rows = cur.fetchall()
    conn.close()
    return rows


# ---------------------------------------------------------------------------
# Deadlock path detection
# ---------------------------------------------------------------------------

def detect_deadlock_root() -> Path | None:
    """
    Try to auto-detect Deadlock root using Windows registry (Steam).
    Returns the Deadlock root folder, e.g.:
      C:\\Program Files (x86)\\Steam\\steamapps\\common\\Deadlock
    """
    logging.info("Attempting to auto-detect Deadlock root via registry...")
    try:
        import winreg
    except ImportError:
        logging.warning("winreg not available - auto-detect skipped")
        return None

    keys = [
        r"SOFTWARE\WOW6432Node\Valve\Steam",
        r"SOFTWARE\Valve\Steam",
    ]
    for key_path in keys:
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, key_path) as key:
                install_path, _ = winreg.QueryValueEx(key, "InstallPath")
                steam_path = Path(install_path)
                candidate = steam_path / "steamapps" / "common" / "Deadlock"
                if candidate.exists():
                    logging.info("Detected Deadlock root at %s", candidate)
                    return candidate
        except FileNotFoundError:
            continue
        except Exception as e:
            logging.warning("Error reading Steam registry key %s: %s", key_path, e)

    logging.info("Deadlock root auto-detection failed.")
    return None


# ---------------------------------------------------------------------------
# GameInfo patching
# ---------------------------------------------------------------------------

def patch_gameinfo(deadlock_root: Path) -> str:
    """
    Patch the SearchPaths block in gameinfo.gi under:
        <deadlock_root>/game/citadel/gameinfo.gi

    Keeps everything else exactly as-is.
    """
    gameinfo_path = deadlock_root / GAMEINFO_REL
    logging.info("Patching gameinfo.gi at %s", gameinfo_path)

    if not gameinfo_path.exists():
        raise FileNotFoundError(f"gameinfo.gi not found at {gameinfo_path}")

    text = gameinfo_path.read_text(encoding="utf-8", errors="ignore")

    # If our desired block already exists, do nothing
    if PATCHED_SEARCHPATHS.strip() in text:
        logging.info("SearchPaths already patched; no changes made.")
        return "GameInfo is already patched."

    # Replace SearchPaths block inside FileSystem
    pattern = r"SearchPaths\s*\{[\s\S]*?\}"
    new_text, count = re.subn(pattern, PATCHED_SEARCHPATHS, text, count=1, flags=re.MULTILINE)

    if count == 0:
        logging.error("Could not find SearchPaths block to patch.")
        raise RuntimeError("Could not find SearchPaths block in gameinfo.gi")

    gameinfo_path.write_text(new_text, encoding="utf-8")
    logging.info("SearchPaths patched successfully (replacements=%s).", count)
    return "GameInfo SearchPaths patched successfully."


# ---------------------------------------------------------------------------
# Mod installation helpers
# ---------------------------------------------------------------------------

def ensure_addons_dir(deadlock_root: Path) -> Path:
    addons_dir = deadlock_root / ADDONS_REL
    addons_dir.mkdir(parents=True, exist_ok=True)
    return addons_dir


def get_next_pak_filename(addons_dir: Path) -> str:
    """
    Determine next pakXX_dir.vpk filename.
    Must start at pak01_dir.vpk (i.e. 01 is minimum).
    """
    existing_nums = []
    for f in addons_dir.glob("pak*_dir.vpk"):
        m = re.match(r"pak(\d+)_dir\.vpk$", f.name, re.IGNORECASE)
        if m:
            try:
                existing_nums.append(int(m.group(1)))
            except ValueError:
                continue

    if existing_nums:
        next_num = max(existing_nums) + 1
    else:
        next_num = 1  # minimum pak01

    if next_num < 1:
        next_num = 1

    filename = f"pak{next_num:02d}_dir.vpk"
    logging.info("Next pak filename resolved as %s", filename)
    return filename


def download_to_file(url: str, dest: Path) -> None:
    logging.info("Downloading %s -> %s", url, dest)
    with requests.get(url, stream=True, timeout=30) as r:
        r.raise_for_status()
        with open(dest, "wb") as f:
            for chunk in r.iter_content(chunk_size=8192):
                if chunk:
                    f.write(chunk)
    logging.info("Download complete: %s", dest)


def install_mod(deadlock_root: Path, mod: dict) -> str:
    """
    Install a mod from server into Deadlock's citadel/addons as the next pakXX_dir.vpk.
    Returns the installed filename.
    """
    addons_dir = ensure_addons_dir(deadlock_root)
    filename = get_next_pak_filename(addons_dir)
    dest_path = addons_dir / filename

    download_url = mod.get("download_url")
    if not download_url:
        raise ValueError("Mod missing download_url")

    download_to_file(download_url, dest_path)
    db_add_mod(mod["id"], mod["title"], filename)

    return filename


def uninstall_mod(deadlock_root: Path, mod_id: str) -> bool:
    rows = db_list_mods()
    for (mid, title, filename, installed_at) in rows:
        if mid == mod_id:
            addons_dir = ensure_addons_dir(deadlock_root)
            file_path = addons_dir / filename
            if file_path.exists():
                try:
                    file_path.unlink()
                    logging.info("Deleted file %s for mod %s", file_path, mid)
                except Exception as e:
                    logging.warning("Failed to delete %s: %s", file_path, e)
            db_remove_mod(mid)
            return True
    return False


# ---------------------------------------------------------------------------
# Network helpers
# ---------------------------------------------------------------------------

def fetch_mods_list() -> list[dict]:
    logging.info("Fetching mods list from %s", API_MODS)
    r = requests.get(API_MODS, timeout=20)
    r.raise_for_status()
    data = r.json()
    mods = data.get("mods", [])
    if not isinstance(mods, list):
        raise ValueError("Unexpected mods payload")
    logging.info("Received %d mods from server", len(mods))
    return mods


def fetch_server_version() -> str | None:
    try:
        logging.info("Fetching server version from %s", API_VERSION)
        r = requests.get(API_VERSION, timeout=10)
        r.raise_for_status()
        data = r.json()
        version = data.get("version")
        logging.info("Server installer version is %s", version)
        return version
    except Exception as e:
        logging.warning("Failed to fetch server version: %s", e)
        return None


# ---------------------------------------------------------------------------
# UI helpers
# ---------------------------------------------------------------------------

def apply_dark_theme(app: QApplication) -> None:
    app.setStyle("Fusion")
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(24, 24, 24))
    palette.setColor(QPalette.WindowText, Qt.white)
    palette.setColor(QPalette.Base, QColor(18, 18, 18))
    palette.setColor(QPalette.AlternateBase, QColor(30, 30, 30))
    palette.setColor(QPalette.ToolTipBase, Qt.white)
    palette.setColor(QPalette.ToolTipText, Qt.white)
    palette.setColor(QPalette.Text, Qt.white)
    palette.setColor(QPalette.Button, QColor(36, 36, 36))
    palette.setColor(QPalette.ButtonText, Qt.white)
    palette.setColor(QPalette.BrightText, Qt.red)
    palette.setColor(QPalette.Highlight, QColor(0, 120, 215))
    palette.setColor(QPalette.HighlightedText, Qt.black)
    app.setPalette(palette)

    font = QFont("Segoe UI", 9)
    app.setFont(font)


def human_time(iso_str: str | None) -> str:
    if not iso_str:
        return "Unknown"
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        # "Option A" style: 16 November 2025 21:34 (UTC)
        return dt.strftime("%d %B %Y %H:%M") + " (UTC)"
    except Exception:
        return iso_str


# ---------------------------------------------------------------------------
# Main Window / "Old" UI (tabbed, dark, modern)
# ---------------------------------------------------------------------------

class InstallerWindow(QWidget):
    def __init__(self):
        super().__init__()
        self.deadlock_root: Path | None = detect_deadlock_root()
        self.mods: list[dict] = []

        self.setWindowTitle("Deadlock Mod Installer")
        self.resize(900, 580)

        self._build_ui()
        self.refresh_mods_list()
        self.refresh_installed_list()
        self.update_about_text()

    # ---------------- UI layout ----------------

    def _build_ui(self):
        root_layout = QVBoxLayout(self)

        header = QLabel("Deadlock Mod Installer")
        header.setAlignment(Qt.AlignLeft | Qt.AlignVCenter)
        header.setStyleSheet(
            "font-size: 18px; font-weight: 600; color: #FFFFFF; padding-bottom: 4px;"
        )

        sub = QLabel("Manage community Deadlock mods with a safe, modern installer.")
        sub.setStyleSheet("color: #AAAAAA;")

        root_layout.addWidget(header)
        root_layout.addWidget(sub)

        self.status_label = QLabel("")
        self.status_label.setStyleSheet("color: #888888; font-size: 11px;")
        root_layout.addWidget(self.status_label)

        tabs = QTabWidget()
        tabs.setStyleSheet("QTabWidget::pane { border: 1px solid #333333; }")
        root_layout.addWidget(tabs, 1)

        # MODS TAB
        self.tab_mods = QWidget()
        tabs.addTab(self.tab_mods, "Mods")

        mods_layout = QVBoxLayout(self.tab_mods)

        mods_header = QLabel("Available Mods")
        mods_header.setStyleSheet("font-size: 14px; font-weight: 600; color: #ffffff;")
        mods_layout.addWidget(mods_header)

        self.mods_list = QListWidget()
        self.mods_list.setStyleSheet(
            "QListWidget { background-color: #181818; border: 1px solid #333333; }"
            "QListWidget::item { padding: 6px; }"
        )
        mods_layout.addWidget(self.mods_list, 1)

        btn_row = QHBoxLayout()
        self.btn_refresh_mods = QPushButton("Refresh List")
        self.btn_install_selected = QPushButton("Install Selected")

        self.btn_refresh_mods.clicked.connect(self.refresh_mods_list)
        self.btn_install_selected.clicked.connect(self.install_selected_mod)

        btn_row.addWidget(self.btn_refresh_mods)
        btn_row.addWidget(self.btn_install_selected)
        btn_row.addStretch(1)

        mods_layout.addLayout(btn_row)

        self.mod_details = QTextEdit()
        self.mod_details.setReadOnly(True)
        self.mod_details.setStyleSheet(
            "QTextEdit { background-color: #141414; border: 1px solid #333333; }"
        )
        mods_layout.addWidget(self.mod_details, 1)

        self.mods_list.currentRowChanged.connect(self.update_mod_details)

        # INSTALLED TAB
        self.tab_installed = QWidget()
        tabs.addTab(self.tab_installed, "Installed")

        inst_layout = QVBoxLayout(self.tab_installed)

        inst_header = QLabel("Installed Mods")
        inst_header.setStyleSheet("font-size: 14px; font-weight: 600; color: #ffffff;")
        inst_layout.addWidget(inst_header)

        self.installed_list = QListWidget()
        self.installed_list.setStyleSheet(
            "QListWidget { background-color: #181818; border: 1px solid #333333; }"
            "QListWidget::item { padding: 6px; }"
        )
        inst_layout.addWidget(self.installed_list, 1)

        inst_btn_row = QHBoxLayout()
        self.btn_uninstall = QPushButton("Uninstall Selected")
        self.btn_uninstall.clicked.connect(self.uninstall_selected_mod)
        inst_btn_row.addWidget(self.btn_uninstall)
        inst_btn_row.addStretch(1)
        inst_layout.addLayout(inst_btn_row)

        # PATCH TAB
        self.tab_patch = QWidget()
        tabs.addTab(self.tab_patch, "Patch GameInfo")

        patch_layout = QVBoxLayout(self.tab_patch)

        desc = QLabel(
            "Patch the Deadlock gameinfo.gi SearchPaths to load mods from citadel/addons.\n"
            "This keeps the rest of the file unchanged."
        )
        desc.setWordWrap(True)
        desc.setStyleSheet("color: #CCCCCC;")
        patch_layout.addWidget(desc)

        self.btn_patch_gameinfo = QPushButton("Patch gameinfo.gi")
        self.btn_patch_gameinfo.clicked.connect(self.patch_gameinfo_clicked)
        patch_layout.addWidget(self.btn_patch_gameinfo)

        self.patch_output = QTextEdit()
        self.patch_output.setReadOnly(True)
        self.patch_output.setStyleSheet(
            "QTextEdit { background-color: #141414; border: 1px solid #333333; }"
        )
        patch_layout.addWidget(self.patch_output, 1)

        # SETTINGS TAB
        self.tab_settings = QWidget()
        tabs.addTab(self.tab_settings, "Settings")

        sett_layout = QVBoxLayout(self.tab_settings)

        sett_header = QLabel("Deadlock Installation")
        sett_header.setStyleSheet("font-size: 14px; font-weight: 600; color: #ffffff;")
        sett_layout.addWidget(sett_header)

        self.deadlock_label = QLabel("")
        self.deadlock_label.setStyleSheet("color: #CCCCCC;")
        sett_layout.addWidget(self.deadlock_label)

        path_btn_row = QHBoxLayout()
        self.btn_auto_detect = QPushButton("Auto-detect Deadlock")
        self.btn_browse_deadlock = QPushButton("Browse...")
        self.btn_auto_detect.clicked.connect(self.auto_detect_deadlock)
        self.btn_browse_deadlock.clicked.connect(self.browse_deadlock)
        path_btn_row.addWidget(self.btn_auto_detect)
        path_btn_row.addWidget(self.btn_browse_deadlock)
        path_btn_row.addStretch(1)

        sett_layout.addLayout(path_btn_row)
        sett_layout.addItem(QSpacerItem(0, 0, QSizePolicy.Minimum, QSizePolicy.Expanding))

        # ABOUT TAB
        self.tab_about = QWidget()
        tabs.addTab(self.tab_about, "About")

        about_layout = QVBoxLayout(self.tab_about)

        self.about_text = QTextEdit()
        self.about_text.setReadOnly(True)
        self.about_text.setStyleSheet(
            "QTextEdit { background-color: #141414; border: 1px solid #333333; }"
        )
        about_layout.addWidget(self.about_text, 1)

        self.btn_check_version = QPushButton("Check Server Version")
        self.btn_check_version.clicked.connect(self.check_server_version)
        about_layout.addWidget(self.btn_check_version)

        # Status init
        self.update_deadlock_label()
        self.update_status_bar()

    # ---------------- helpers ----------------

    def update_status_bar(self):
        if self.deadlock_root:
            text = f"Deadlock root: {self.deadlock_root}"
        else:
            text = "Deadlock root not set. Use Settings → Browse or Auto-detect."
        self.status_label.setText(text)

    def update_deadlock_label(self):
        if self.deadlock_root:
            self.deadlock_label.setText(str(self.deadlock_root))
        else:
            self.deadlock_label.setText("Not set")

    def refresh_mods_list(self):
        try:
            mods = fetch_mods_list()
        except Exception as e:
            logging.error("Failed to fetch mods: %s", e)
            QMessageBox.warning(self, "Error", f"Failed to fetch mods:\n{e}")
            return

        self.mods = mods
        self.mods_list.clear()

        for m in mods:
            title = m.get("title", "Untitled")
            uploaded_at = human_time(m.get("uploaded_at"))
            item_text = f"{title}  •  Uploaded: {uploaded_at}"
            item = QListWidgetItem(item_text)
            self.mods_list.addItem(item)

        if mods:
            self.mods_list.setCurrentRow(0)
        self.update_mod_details()

    def refresh_installed_list(self):
        self.installed_list.clear()
        rows = db_list_mods()
        for mid, title, filename, installed_at in rows:
            text = f"{title}  •  {filename}  •  Installed: {human_time(installed_at)}"
            item = QListWidgetItem(text)
            # store id in data
            item.setData(Qt.UserRole, mid)
            self.installed_list.addItem(item)

    def current_selected_mod(self) -> dict | None:
        row = self.mods_list.currentRow()
        if row < 0 or row >= len(self.mods):
            return None
        return self.mods[row]

    def update_mod_details(self):
        mod = self.current_selected_mod()
        if not mod:
            self.mod_details.clear()
            return

        title = mod.get("title", "Untitled")
        orig_name = mod.get("original_filename", "N/A")
        uploaded_at = human_time(mod.get("uploaded_at"))
        size_bytes = mod.get("size")
        size_str = f"{size_bytes/1024/1024:.2f} MB" if isinstance(size_bytes, (int, float)) else "Unknown size"

        text = []
        text.append(f"Title: {title}")
        text.append(f"Original filename: {orig_name}")
        text.append(f"Uploaded: {uploaded_at}")
        text.append(f"Size: {size_str}")
        text.append("")
        text.append("This mod will be installed as the next available pakXX_dir.vpk in:")
        text.append("  game/citadel/addons")
        text.append("")
        text.append("Note: Installer never overwrites existing pak files. It always picks the next number.")
        self.mod_details.setPlainText("\n".join(text))

    # ---------------- actions ----------------

    def ensure_deadlock_root(self) -> bool:
        if self.deadlock_root and self.deadlock_root.exists():
            return True

        QMessageBox.warning(
            self,
            "Deadlock not set",
            "Please set the Deadlock folder in Settings before installing or patching.",
        )
        return False

    def install_selected_mod(self):
        if not self.ensure_deadlock_root():
            return

        mod = self.current_selected_mod()
        if not mod:
            QMessageBox.information(self, "No mod selected", "Please select a mod to install.")
            return

        try:
            filename = install_mod(self.deadlock_root, mod)
        except Exception as e:
            logging.error("Error installing mod: %s", e, exc_info=True)
            QMessageBox.critical(self, "Install failed", f"Installing mod failed:\n{e}")
            return

        QMessageBox.information(
            self,
            "Mod installed",
            f"Mod \"{mod.get('title', 'Untitled')}\" installed as {filename}.",
        )
        self.refresh_installed_list()

    def uninstall_selected_mod(self):
        if not self.ensure_deadlock_root():
            return

        item = self.installed_list.currentItem()
        if not item:
            QMessageBox.information(self, "No mod selected", "Please select an installed mod to uninstall.")
            return

        mod_id = item.data(Qt.UserRole)
        if not mod_id:
            QMessageBox.warning(self, "Error", "Could not determine selected mod ID.")
            return

        confirm = QMessageBox.question(
            self,
            "Confirm uninstall",
            "Are you sure you want to uninstall this mod?",
        )
        if confirm != QMessageBox.Yes:
            return

        try:
            ok = uninstall_mod(self.deadlock_root, mod_id)
        except Exception as e:
            logging.error("Error uninstalling mod: %s", e, exc_info=True)
            QMessageBox.critical(self, "Uninstall failed", f"Uninstalling mod failed:\n{e}")
            return

        if ok:
            QMessageBox.information(self, "Uninstalled", "Mod has been uninstalled.")
            self.refresh_installed_list()
        else:
            QMessageBox.warning(self, "Not found", "Mod not found in local database.")

    def patch_gameinfo_clicked(self):
        if not self.ensure_deadlock_root():
            return

        try:
            result = patch_gameinfo(self.deadlock_root)
        except Exception as e:
            logging.error("Error patching gameinfo: %s", e, exc_info=True)
            self.patch_output.setPlainText(f"Error: {e}")
            QMessageBox.critical(self, "Patch failed", f"Patching gameinfo.gi failed:\n{e}")
            return

        self.patch_output.setPlainText(result)
        QMessageBox.information(self, "GameInfo patched", result)

    def auto_detect_deadlock(self):
        root = detect_deadlock_root()
        if not root:
            QMessageBox.warning(
                self,
                "Auto-detect failed",
                "Could not auto-detect Deadlock. Please use Browse to pick the folder manually.",
            )
            return
        self.deadlock_root = root
        self.update_deadlock_label()
        self.update_status_bar()

    def browse_deadlock(self):
        d = QFileDialog.getExistingDirectory(
            self,
            "Select Deadlock folder (the folder containing 'game')",
            str(self.deadlock_root or Path.home()),
        )
        if not d:
            return
        root = Path(d)
        if not (root / "game").exists():
            QMessageBox.warning(
                self,
                "Invalid folder",
                "Selected folder does not contain a 'game' subfolder. "
                "Please select the Deadlock root (for example: .../steamapps/common/Deadlock).",
            )
            return
        self.deadlock_root = root
        self.update_deadlock_label()
        self.update_status_bar()

    def check_server_version(self):
        server_version = fetch_server_version()
        if not server_version:
            QMessageBox.warning(self, "Version check", "Could not contact server for version info.")
            return

        if server_version != INSTALLER_VERSION:
            QMessageBox.information(
                self,
                "Update available",
                f"Server installer version: {server_version}\n"
                f"Your installer version: {INSTALLER_VERSION}\n\n"
                f"You're not on the latest version. Updating is recommended, but not required.",
            )
        else:
            QMessageBox.information(
                self,
                "Up to date",
                f"You're running the latest installer version: {INSTALLER_VERSION}",
            )

    def update_about_text(self):
        lines = [
            "Deadlock Mod Installer",
            "",
            f"Installer version: {INSTALLER_VERSION}",
            f"Server base URL: {SERVER_BASE}",
            "",
            f"Config & database folder:",
            f"  {APP_DIR}",
            f"  DB file: {DB_PATH.name}",
            f"  Log file: {LOG_FILE.name}",
            "",
            "This installer:",
            "  • Installs mods as pakXX_dir.vpk (starting from pak01)",
            "  • Never overwrites existing pak files",
            "  • Stores installed mods in a local SQLite database",
            "  • Can patch gameinfo.gi to mount citadel/addons cleanly",
            "",
            "If anything goes wrong, check the installer.log file for details.",
        ]
        self.about_text.setPlainText("\n".join(lines))


# ---------------------------------------------------------------------------
# Main entry
# ---------------------------------------------------------------------------

def main():
    setup_logging()
    init_db()

    app = QApplication(sys.argv)
    apply_dark_theme(app)
    install_excepthook()

    window = InstallerWindow()
    window.show()

    sys.exit(app.exec())


if __name__ == "__main__":
    main()
