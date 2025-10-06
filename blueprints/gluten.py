from __future__ import annotations

import os
import shutil
from datetime import datetime
from pathlib import Path
from flask import Blueprint, render_template, send_file, jsonify, current_app, abort, request, flash, redirect, url_for
from utils.auth import require_login, get_current_user

gluten_bp = Blueprint('gluten', __name__, url_prefix='/gluten')

def is_gluten_uploader() -> bool:
    """Check if current user can upload Gluten files."""
    user = get_current_user()
    current_app.logger.info(f"Checking gluten upload permission for user: {user}")
    
    if not user:
        current_app.logger.info("No user found - access denied")
        return False
    
    # Handle both dict and object formats for user
    user_id = user.get('id') if isinstance(user, dict) else getattr(user, 'id', None)
    if not user_id:
        current_app.logger.info("No user ID found - access denied")
        return False
    
    owner_id = current_app.config.get('DISCORD_OWNER_ID')
    gluten_id = current_app.config.get('DISCORD_GLUTEN_UPLOADER_ID')
    
    current_app.logger.info(f"User ID: {user_id}, Owner ID: {owner_id}, Gluten ID: {gluten_id}")
    
    # Convert to strings for comparison in case they're different types
    user_id_str = str(user_id)
    owner_id_str = str(owner_id) if owner_id else None
    gluten_id_str = str(gluten_id) if gluten_id else None
    
    is_owner = owner_id_str and user_id_str == owner_id_str
    is_gluten_uploader = gluten_id_str and user_id_str == gluten_id_str
    
    current_app.logger.info(f"Is owner: {is_owner}, Is gluten uploader: {is_gluten_uploader}")
    
    result = is_owner or is_gluten_uploader
    current_app.logger.info(f"Final permission result: {result}")
    
    return result

def require_gluten_upload_permission(f):
    """Decorator to require Gluten upload permission."""
    def decorated_function(*args, **kwargs):
        if not is_gluten_uploader():
            current_app.logger.warning("Gluten upload permission denied - returning 403")
            current_app.logger.warning(f"User ID was {get_current_user().get('id') if get_current_user() else 'None'}")
            abort(403, "You don't have permission to upload Gluten files")
        return f(*args, **kwargs)
    decorated_function.__name__ = f.__name__
    return decorated_function

@gluten_bp.route('/')
def index():
    """Main Gluten mod download page."""
    user = get_current_user()
    can_upload = is_gluten_uploader()
    current_app.logger.info(f"Gluten index - user: {user}, can_upload: {can_upload}")
    return render_template('gluten/index.html', can_upload=can_upload, user=user)

@gluten_bp.route('/upload')
@require_login
@require_gluten_upload_permission
def upload_page():
    """Upload page for Gluten mod files."""
    current_app.logger.info("Serving gluten upload page")
    return render_template('gluten/upload.html')

@gluten_bp.route('/upload', methods=['POST'])
@require_login
@require_gluten_upload_permission
def handle_upload():
    """Handle file upload for Gluten mod."""
    current_app.logger.info("Handling gluten file upload")
    
    if 'zip_file' not in request.files:
        flash('No file selected', 'error')
        return redirect(url_for('gluten.upload_page'))
    
    file = request.files['zip_file']
    if file.filename == '':
        flash('No file selected', 'error')
        return redirect(url_for('gluten.upload_page'))
    
    if not file.filename.lower().endswith('.zip'):
        flash('Only ZIP files are allowed', 'error')
        return redirect(url_for('gluten.upload_page'))
    
    # Check file size (limit to 50MB)
    file.seek(0, os.SEEK_END)
    file_size = file.tell()
    file.seek(0)
    
    if file_size > 50 * 1024 * 1024:  # 50MB limit
        flash('File too large. Maximum size is 50MB.', 'error')
        return redirect(url_for('gluten.upload_page'))
    
    try:
        static_folder = Path(current_app.static_folder)
        zip_path = static_folder / 'Gluten_Zip.zip'
        
        # Create backup of existing file if it exists
        if zip_path.exists():
            backup_name = f"Gluten_Zip_backup_{datetime.now().strftime('%Y%m%d_%H%M%S')}.zip"
            backup_path = static_folder / backup_name
            shutil.copy2(zip_path, backup_path)
            current_app.logger.info(f"Backed up existing file to {backup_name}")
        
        # Save the new file
        file.save(zip_path)
        
        user = get_current_user()
        # Handle both dict and object formats for logging
        username = user.get('username') if isinstance(user, dict) else getattr(user, 'username', 'Unknown')
        user_id = user.get('id') if isinstance(user, dict) else getattr(user, 'id', 'Unknown')
        
        current_app.logger.info(f"Gluten zip file uploaded by {username} ({user_id})")
        
        flash('Gluten mod file uploaded successfully!', 'success')
        
    except Exception as e:
        current_app.logger.error(f"Error uploading Gluten file: {e}")
        flash('Error uploading file. Please try again.', 'error')
    
    return redirect(url_for('gluten.upload_page'))

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
    
    file_info = {}
    if zip_path.exists():
        stat = zip_path.stat()
        file_info['zip_size'] = stat.st_size
        file_info['zip_modified'] = datetime.fromtimestamp(stat.st_mtime).isoformat()
    
    return jsonify({
        'zip_available': zip_path.exists(),
        'installer_available': installer_path.exists(),
        'exe_available': exe_path.exists(),
        'file_info': file_info
    })