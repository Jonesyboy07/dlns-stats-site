#!/usr/bin/env python3
"""
OneLane Mod Installer for Deadlock
Automatically downloads and installs the OneLane mod from DLNS Stats.

Usage: python onelane_installer.py
"""

import os
import sys
import winreg
import zipfile
import tempfile
import urllib.request
import urllib.error
from pathlib import Path
import shutil
import time

# Configuration
DOWNLOAD_URL = "https://dlns-stats.co.uk/onelane/download/zip"
MOD_NAME = "ARAM-OneLane"
TEMP_DIR_NAME = "aram_onelane_mod_temp"

def safe_input(prompt="Press Enter to exit..."):
    """Safe input that handles missing stdin (like in executables)."""
    try:
        return input(prompt)
    except (EOFError, RuntimeError):
        # If stdin is not available (like in a PyInstaller exe), just wait a bit
        print(prompt)
        time.sleep(3)
        return ""

def find_steam_path():
    """Find Steam installation path from Windows registry."""
    try:
        # Try HKEY_LOCAL_MACHINE first (system-wide install)
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Valve\Steam") as key:
                steam_path, _ = winreg.QueryValueEx(key, "InstallPath")
                return Path(steam_path)
        except FileNotFoundError:
            pass
        
        # Try HKEY_LOCAL_MACHINE without WOW6432Node (64-bit)
        try:
            with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Valve\Steam") as key:
                steam_path, _ = winreg.QueryValueEx(key, "InstallPath")
                return Path(steam_path)
        except FileNotFoundError:
            pass
        
        # Try HKEY_CURRENT_USER (user install)
        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"SOFTWARE\Valve\Steam") as key:
                steam_path, _ = winreg.QueryValueEx(key, "InstallPath")
                return Path(steam_path)
        except FileNotFoundError:
            pass
        
    except Exception as e:
        print(f"Error accessing registry: {e}")
    
    return None

def find_deadlock_path(steam_path):
    """Find Deadlock installation path."""
    if not steam_path:
        return None
    
    deadlock_path = steam_path / "steamapps" / "common" / "Deadlock"
    if deadlock_path.exists():
        return deadlock_path
    
    return None

def download_mod(url, temp_dir):
    """Download the mod zip file."""
    print(f"Downloading {MOD_NAME} mod from {url}...")
    
    zip_path = temp_dir / "ARAM-OneLane.zip"
    
    try:
        with urllib.request.urlopen(url) as response:
            if response.status != 200:
                raise urllib.error.HTTPError(url, response.status, "Download failed", None, None)
            
            with open(zip_path, 'wb') as f:
                shutil.copyfileobj(response, f)
        
        print("✓ Download completed successfully!")
        return zip_path
    
    except urllib.error.URLError as e:
        print(f"✗ Failed to download mod: {e}")
        return None
    except Exception as e:
        print(f"✗ Unexpected error during download: {e}")
        return None

def extract_mod(zip_path, temp_dir):
    """Extract the mod zip file."""
    print("Extracting mod files...")
    
    try:
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(temp_dir)
        
        print("✓ Extraction completed successfully!")
        return True
    
    except zipfile.BadZipFile:
        print("✗ Downloaded file is not a valid zip file")
        return False
    except Exception as e:
        print(f"✗ Failed to extract mod: {e}")
        return False

def install_files(temp_dir, deadlock_path):
    """Install mod files to Deadlock/game directory."""
    print("Installing mod files...")
    
    conflicts = []
    installed = []
    
    # Look for the extracted game folder
    game_source = temp_dir / "game"
    if not game_source.exists():
        print("✗ Invalid mod structure: 'game' folder not found")
        return False, conflicts, installed
    
    # Target the game subfolder within Deadlock directory
    deadlock_game_path = deadlock_path / "game"
    if not deadlock_game_path.exists():
        print("✗ Deadlock game folder not found at expected location")
        return False, conflicts, installed
    
    try:
        # Walk through all files in the game directory
        for root, dirs, files in os.walk(game_source):
            for file in files:
                source_file = Path(root) / file
                # Get relative path from game folder
                rel_path = source_file.relative_to(game_source)
                dest_file = deadlock_game_path / rel_path
                
                # Create destination directory if it doesn't exist
                dest_file.parent.mkdir(parents=True, exist_ok=True)
                
                # Check if file already exists
                if dest_file.exists():
                    conflicts.append(str(rel_path))
                    print(f"⚠ File already exists: {rel_path}")
                else:
                    # Copy the file
                    shutil.copy2(source_file, dest_file)
                    installed.append(str(rel_path))
                    print(f"✓ Installed: {rel_path}")
        
        # Also copy README if it exists (place in main Deadlock folder for visibility)
        readme_source = temp_dir / "README.txt"
        if readme_source.exists():
            readme_dest = deadlock_path / f"{MOD_NAME}_README.txt"
            if not readme_dest.exists():
                shutil.copy2(readme_source, readme_dest)
                installed.append(f"{MOD_NAME}_README.txt")
                print(f"✓ Installed: {MOD_NAME}_README.txt")
        
        print()
        print(f"  - {len(installed)} files installed")
        if conflicts:
            print(f"  - {len(conflicts)} files skipped (already exist)")
        
        return True, conflicts, installed
    
    except Exception as e:
        print(f"✗ Failed to install files: {e}")
        return False, conflicts, installed

def main():
    """Main installer function."""
    print(f"=== {MOD_NAME} Mod Installer ===\n")
    
    # Find Steam path
    print("Locating Steam installation...")
    steam_path = find_steam_path()
    
    if not steam_path:
        print("✗ Could not find Steam installation")
        print("Please ensure Steam is installed and try again.")
        safe_input("\nPress Enter to exit...")
        sys.exit(1)
    
    print(f"✓ Found Steam at: {steam_path}")
    
    # Find Deadlock path
    print("Locating Deadlock installation...")
    deadlock_path = find_deadlock_path(steam_path)
    
    if not deadlock_path:
        print("✗ Could not find Deadlock installation automatically")
        print("Please provide the path to your Deadlock installation folder.")
        print("This should be the main Deadlock folder (not the 'game' subfolder).")
        print("Example: C:\\Steam\\steamapps\\common\\Deadlock")
        print()
        
        while True:
            try:
                user_path = input("Enter Deadlock path (or 'exit' to quit): ").strip()
                if user_path.lower() == 'exit':
                    print("Installation cancelled.")
                    sys.exit(0)
                
                if not user_path:
                    print("Please enter a valid path.")
                    continue
                
                deadlock_path = Path(user_path)
                if deadlock_path.exists() and deadlock_path.is_dir():
                    # Check if this looks like a Deadlock installation
                    game_folder = deadlock_path / "game"
                    if game_folder.exists():
                        print(f"✓ Valid Deadlock installation found at: {deadlock_path}")
                        break
                    else:
                        print("⚠ This doesn't appear to be a Deadlock installation (no 'game' folder found).")
                        print("Please ensure you're pointing to the main Deadlock folder.")
                        continue
                else:
                    print("✗ Path does not exist or is not a directory.")
                    continue
                    
            except (EOFError, KeyboardInterrupt):
                print("\nInstallation cancelled by user.")
                sys.exit(0)
            except Exception as e:
                print(f"Error: {e}")
                continue
    
    print(f"✓ Found Deadlock at: {deadlock_path}")
    
    # Create temporary directory
    temp_base = Path(os.environ.get('APPDATA', '')) / TEMP_DIR_NAME
    temp_base.mkdir(exist_ok=True)
    
    with tempfile.TemporaryDirectory(dir=temp_base) as temp_dir:
        temp_path = Path(temp_dir)
        
        # Download mod
        zip_path = download_mod(DOWNLOAD_URL, temp_path)
        if not zip_path:
            safe_input("\nPress Enter to exit...")
            sys.exit(1)
        
        # Extract mod
        if not extract_mod(zip_path, temp_path):
            safe_input("\nPress Enter to exit...")
            sys.exit(1)
        
        # Install files
        success, conflicts, installed = install_files(temp_path, deadlock_path)
        
        if not success:
            safe_input("\nPress Enter to exit...")
            sys.exit(1)
        
        # Show results
        if conflicts:
            print("\n⚠ The following files already exist and were NOT replaced:")
            for conflict in conflicts:
                print(f"   - {conflict}")
            print("\nIf you want to update these files, please remove them manually first.")
        
        print(f"\n🎉 {MOD_NAME} mod installation completed!")
        print("You can now launch Deadlock and enjoy the mod.")
    
    safe_input("\nPress Enter to exit...")

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        print("\n\nInstallation cancelled by user.")
        sys.exit(0)
    except Exception as e:
        print(f"\n\nUnexpected error: {e}")
        print("Please report this issue to the mod developers.")
        safe_input("Press Enter to exit...")
        sys.exit(1)