from __future__ import annotations

from pathlib import Path
from flask import Blueprint, render_template, send_file, jsonify, current_app, abort

gluten_bp = Blueprint('gluten', __name__, url_prefix='/gluten')

@gluten_bp.route('/')
def index():
    """Main Gluten mod download page."""
    return render_template('gluten/index.html')

@gluten_bp.route('/download/zip')
def download_zip():
    """Serve the existing Gluten_Zip.zip file."""
    zip_path = Path(current_app.static_folder) / 'Gluten_Zip.zip'
    if not zip_path.exists():
        abort(404, "Gluten_Zip.zip not found")
    
    return send_file(
        zip_path,
        as_attachment=True,
        download_name='Gluten_Zip.zip',
        mimetype='application/zip'
    )

@gluten_bp.route('/download/installer')
def download_installer():
    """Serve the Python installer script."""
    installer_path = Path(current_app.static_folder) / 'gluten_installer.py'
    if not installer_path.exists():
        abort(404, "Installer script not found")
    
    return send_file(
        installer_path,
        as_attachment=True,
        download_name='gluten_installer.py',
        mimetype='text/x-python'
    )

@gluten_bp.route('/download/exe')
def download_exe():
    """Serve the compiled Python installer executable."""
    exe_path = Path(current_app.static_folder) / 'Gluten_Video.exe'
    if not exe_path.exists():
        abort(404, "Installer executable not found")
    
    return send_file(
        exe_path,
        as_attachment=True,
        download_name='Gluten_Video.exe',
        mimetype='application/octet-stream'
    )

@gluten_bp.route('/source')
def view_source():
    """Display the installer source code for review."""
    installer_path = Path(current_app.static_folder) / 'gluten_installer.py'
    if not installer_path.exists():
        abort(404, "Installer script not found")
    
    try:
        with open(installer_path, 'r', encoding='utf-8') as f:
            source_code = f.read()
        return render_template('gluten/source.html', source_code=source_code)
    except Exception as e:
        current_app.logger.error(f"Error reading source: {e}")
        abort(500)

@gluten_bp.route('/api/check')
def api_check():
    """API endpoint to check if files are available."""
    zip_path = Path(current_app.static_folder) / 'Gluten_Zip.zip'
    installer_path = Path(current_app.static_folder) / 'gluten_installer.py'
    exe_path = Path(current_app.static_folder) / 'Gluten_Video.exe'
    
    return jsonify({
        'zip_available': zip_path.exists(),
        'installer_available': installer_path.exists(),
        'exe_available': exe_path.exists()
    })