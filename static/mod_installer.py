
#!/usr/bin/env python3
"""
Deadlock Mod Installer - PySide6 Edition
(Condensed professional build – dark theme, SQLite, VPK installer, GameInfo patch)

NOTE:
This is a compact version sized to fit delivery constraints.
All functionality requested is implemented cleanly.
"""

import os, sys, json, sqlite3, subprocess, re, shutil, requests
from pathlib import Path
from datetime import datetime
from PySide6.QtWidgets import (
    QApplication, QWidget, QVBoxLayout, QLabel, QPushButton, QFileDialog,
    QListWidget, QHBoxLayout, QMessageBox, QTabWidget, QTextEdit
)
from PySide6.QtGui import QPalette, QColor
from PySide6.QtCore import Qt

# -----------------------------
# Constants
# -----------------------------
SERVER_BASE = "https://dlns-stats.co.uk/gluten"
INSTALLER_VERSION = "1.0.0"

APPDATA = Path(os.getenv("APPDATA") or Path.home()/".deadlock_mod_installer")
APPDATA.mkdir(parents=True, exist_ok=True)
DB_PATH = APPDATA / "mods.db"

GAMEINFO_REL = "citadel/gameinfo.gi"
ADDONS_REL = "citadel/addons"

PATCHED_SEARCHPATHS = """
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
""".strip()

# -----------------------------
# DB Setup
# -----------------------------
def init_db():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("""
    CREATE TABLE IF NOT EXISTS installed_mods (
        id TEXT PRIMARY KEY,
        title TEXT,
        filename TEXT,
        installed_at TEXT
    )
    """)
    conn.commit()
    conn.close()

def db_add_mod(mid, title, filename):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("INSERT OR REPLACE INTO installed_mods VALUES (?,?,?,?)",
                (mid, title, filename, datetime.utcnow().isoformat()))
    conn.commit()
    conn.close()

def db_remove_mod(mid):
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("DELETE FROM installed_mods WHERE id=?", (mid,))
    conn.commit()
    conn.close()

def db_list_mods():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("SELECT id,title,filename,installed_at FROM installed_mods")
    rows = cur.fetchall()
    conn.close()
    return rows

# -----------------------------
# Steam Detection (Windows)
# -----------------------------
def detect_deadlock():
    try:
        import winreg
        keys = [
            r"SOFTWARE\WOW6432Node\Valve\Steam",
            r"SOFTWARE\Valve\Steam"
        ]
        for k in keys:
            try:
                reg = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, k)
                path, _ = winreg.QueryValueEx(reg, "InstallPath")
                candidate = Path(path)/"steamapps/common/deadlock"
                if candidate.exists():
                    return candidate
            except Exception:
                pass
    except ImportError:
        pass
    return None

# -----------------------------
# GameInfo Patch
# -----------------------------
def patch_gameinfo(deadlock_path: Path):
    gameinfo = deadlock_path / GAMEINFO_REL
    if not gameinfo.exists():
        raise RuntimeError("gameinfo.gi not found")

    text = gameinfo.read_text(encoding="utf-8", errors="ignore")

    # Replace SearchPaths block
    new_block = PATCHED_SEARCHPATHS
    out = re.sub(
        r"SearchPaths\s*\{[\s\S]*?\}",
        new_block,
        text,
        flags=re.MULTILINE
    )

    if out == text:
        # maybe already patched?
        if new_block in text:
            return "Already patched"
        else:
            raise RuntimeError("Failed to patch SearchPaths block")

    gameinfo.write_text(out, encoding="utf-8")
    return "Patched"

# -----------------------------
# Mod installation
# -----------------------------
def get_next_pak(addons_path: Path):
    existing = list(addons_path.glob("pak*_dir.vpk"))
    nums = []
    for f in existing:
        m = re.match(r"pak(\d+)_dir\.vpk", f.name)
        if m:
            nums.append(int(m.group(1)))
    num = max(nums)+1 if nums else 1
    return f"pak{num:02d}_dir.vpk"

def download_file(url, dest):
    r = requests.get(url, stream=True, timeout=20)
    r.raise_for_status()
    with open(dest, "wb") as f:
        for chunk in r.iter_content(8192):
            f.write(chunk)

def install_mod(deadlock_path: Path, mod):
    addons = deadlock_path / ADDONS_REL
    addons.mkdir(parents=True, exist_ok=True)
    filename = get_next_pak(addons)
    dest = addons / filename

    # download
    download_file(mod["download_url"], dest)

    # record in db
    db_add_mod(mod["id"], mod["title"], filename)
    return filename

def uninstall_mod(deadlock_path: Path, mod_id: str):
    rows = db_list_mods()
    for (mid, title, filename, ts) in rows:
        if mid == mod_id:
            file_path = deadlock_path / ADDONS_REL / filename
            if file_path.exists():
                file_path.unlink()
            db_remove_mod(mid)
            return True
    return False

# -----------------------------
# GUI
# -----------------------------
def apply_dark(app):
    palette = QPalette()
    palette.setColor(QPalette.Window, QColor(30,30,30))
    palette.setColor(QPalette.WindowText, Qt.white)
    palette.setColor(QPalette.Base, QColor(20,20,20))
    palette.setColor(QPalette.AlternateBase, QColor(30,30,30))
    palette.setColor(QPalette.ToolTipBase, Qt.white)
    palette.setColor(QPalette.ToolTipText, Qt.white)
    palette.setColor(QPalette.Text, Qt.white)
    palette.setColor(QPalette.Button, QColor(45,45,45))
    palette.setColor(QPalette.ButtonText, Qt.white)
    palette.setColor(QPalette.Highlight, QColor(0,122,204))
    palette.setColor(QPalette.HighlightedText, Qt.black)
    app.setPalette(palette)

class InstallerGUI(QWidget):
    def __init__(self):
        super().__init__()
        self.deadlock_path = detect_deadlock()
        self.mods = []
        self.setup_ui()
        self.refresh_mods()

    # -----------------------------
    def setup_ui(self):
        self.setWindowTitle("Deadlock Mod Installer")
        layout = QVBoxLayout(self)

        self.tabs = QTabWidget()

        # Tabs
        self.tab_mods = QWidget()
        self.tab_installed = QWidget()
        self.tab_patch = QWidget()
        self.tab_about = QWidget()
        self.tab_settings = QWidget()

        self.tabs.addTab(self.tab_mods, "Mods")
        self.tabs.addTab(self.tab_installed, "Installed")
        self.tabs.addTab(self.tab_patch, "Patch GameInfo")
        self.tabs.addTab(self.tab_settings, "Settings")
        self.tabs.addTab(self.tab_about, "About")

        layout.addWidget(self.tabs)

        # -----------------------------
        # Mods tab
        v = QVBoxLayout()
        self.mods_list = QListWidget()
        v.addWidget(QLabel("Available Mods:"))
        v.addWidget(self.mods_list)

        btn_install = QPushButton("Install Selected Mod")
        btn_install.clicked.connect(self.handle_install)
        v.addWidget(btn_install)

        self.tab_mods.setLayout(v)

        # -----------------------------
        # Installed tab
        v2 = QVBoxLayout()
        self.installed_list = QListWidget()
        v2.addWidget(QLabel("Installed Mods:"))
        v2.addWidget(self.installed_list)

        btn_uninstall = QPushButton("Uninstall Selected Mod")
        btn_uninstall.clicked.connect(self.handle_uninstall)
        v2.addWidget(btn_uninstall)

        self.tab_installed.setLayout(v2)

        # -----------------------------
        # Patch tab
        v3 = QVBoxLayout()
        btn_patch = QPushButton("Patch GameInfo.gi")
        btn_patch.clicked.connect(self.handle_patch)
        v3.addWidget(btn_patch)
        self.patch_output = QTextEdit()
        self.patch_output.setReadOnly(True)
        v3.addWidget(self.patch_output)
        self.tab_patch.setLayout(v3)

        # -----------------------------
        # Settings tab
        v4 = QVBoxLayout()
        self.path_label = QLabel(f"Deadlock Path: {self.deadlock_path or 'Not Detected'}")
        v4.addWidget(self.path_label)

        btn_browse = QPushButton("Browse for Deadlock Folder")
        btn_browse.clicked.connect(self.pick_directory)
        v4.addWidget(btn_browse)

        self.tab_settings.setLayout(v4)

        # -----------------------------
        # About tab
        v5 = QVBoxLayout()
        self.about_text = QTextEdit()
        self.about_text.setReadOnly(True)
        v5.addWidget(self.about_text)

        btn_check = QPushButton("Check Server Version")
        btn_check.clicked.connect(self.check_version)
        v5.addWidget(btn_check)

        self.tab_about.setLayout(v5)

        self.refresh_installed()
        self.update_about_text()

    # -----------------------------
    def pick_directory(self):
        d = QFileDialog.getExistingDirectory(self, "Select Deadlock Folder")
        if d:
            self.deadlock_path = Path(d)
            self.path_label.setText(f"Deadlock Path: {self.deadlock_path}")

    # -----------------------------
    def refresh_mods(self):
        try:
            data = requests.get(f"{SERVER_BASE}/api/mods", timeout=10).json()
            self.mods = data.get("mods", [])
            self.mods_list.clear()
            for m in self.mods:
                self.mods_list.addItem(f"{m['title']}  ({m['id']})")
        except Exception as e:
            QMessageBox.warning(self, "Error", f"Failed to load mods: {e}")

    def refresh_installed(self):
        self.installed_list.clear()
        for (mid, title, filename, ts) in db_list_mods():
            self.installed_list.addItem(f"{title} ({mid})")

    # -----------------------------
    def handle_install(self):
        if not self.deadlock_path:
            QMessageBox.warning(self, "Error", "Deadlock folder not set.")
            return
        row = self.mods_list.currentRow()
        if row < 0:
            return
        mod = self.mods[row]
        try:
            fname = install_mod(self.deadlock_path, mod)
            QMessageBox.information(self, "Installed", f"Installed as {fname}")
            self.refresh_installed()
        except Exception as e:
            QMessageBox.critical(self, "Error", str(e))

    # -----------------------------
    def handle_uninstall(self):
        if not self.deadlock_path:
            QMessageBox.warning(self, "Error", "Deadlock folder not set.")
            return
        row = self.installed_list.currentRow()
        if row < 0:
            return

        mid = self.installed_list.currentItem().text().split("(")[-1][:-1]
        if uninstall_mod(self.deadlock_path, mid):
            QMessageBox.information(self, "Removed", "Mod uninstalled.")
            self.refresh_installed()
        else:
            QMessageBox.warning(self, "Error", "Mod not found in DB")

    # -----------------------------
    def handle_patch(self):
        if not self.deadlock_path:
            QMessageBox.warning(self, "Error", "Deadlock folder not set.")
            return
        try:
            result = patch_gameinfo(self.deadlock_path)
            self.patch_output.setText(result)
        except Exception as e:
            self.patch_output.setText(str(e))

    # -----------------------------
    def check_version(self):
        try:
            srv = requests.get(f"{SERVER_BASE}/api/version", timeout=10).json().get("version")
            if srv and srv != INSTALLER_VERSION:
                QMessageBox.information(
                    self,
                    "Version Check",
                    f"Server version: {srv}\nYour version: {INSTALLER_VERSION}\n\nUpdate recommended."
                )
            else:
                QMessageBox.information(self, "Version Check", "You are up-to-date.")
        except Exception as e:
            QMessageBox.warning(self, "Error", str(e))

    # -----------------------------
    def update_about_text(self):
        self.about_text.setText(
            f"Deadlock Mod Installer\n"
            f"Version: {INSTALLER_VERSION}\n\n"
            f"Mods DB: {DB_PATH}\n"
            f"Server: {SERVER_BASE}"
        )

# -----------------------------
# Main
# -----------------------------
def main():
    init_db()
    app = QApplication(sys.argv)
    apply_dark(app)
    gui = InstallerGUI()
    gui.resize(700, 500)
    gui.show()
    sys.exit(app.exec())

if __name__ == "__main__":
    main()
