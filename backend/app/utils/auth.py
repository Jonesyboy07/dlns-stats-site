from functools import wraps
from flask import request, flash, redirect, url_for, current_app, jsonify
import os
import sqlite3

SESSION_TABLE = 'user_sessions'


def is_logged_in():
    """Check if user is logged in via session cookie"""
    return get_current_user() is not None


def get_current_user():
    """Get current user from secure session cookie"""
    session_token = request.cookies.get('session_token')
    if not session_token:
        return None
    
    try:
        db_path = current_app.config.get('DB_PATH', './data/dlns.sqlite3')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'SELECT discord_id, username, avatar FROM {SESSION_TABLE} WHERE session_token = ?', (session_token,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        discord_id, username, avatar = row
        return {
            'id': discord_id,
            'username': username,
            'avatar': avatar,
        }
    except Exception:
        return None

def require_login(f):
    """Decorator to require login for a route"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))
        return f(*args, **kwargs)
    return decorated_function

def get_owner_id():
    """Get the owner Discord ID from environment"""
    return os.getenv('DISCORD_OWNER_ID', '')

def get_admin_ids():
    """Get admin Discord IDs from environment"""
    admin_ids = os.getenv('DISCORD_ADMIN_IDS', '')
    if admin_ids:
        return [admin_id.strip() for admin_id in admin_ids.split(',') if admin_id.strip()]
    return []

def get_match_submitter_ids():
    """Get Discord IDs allowed to submit matches from environment"""
    submitter_ids = os.getenv('MATCH_SUBMITTERS', '')
    if submitter_ids:
        return [submitter_id.strip() for submitter_id in submitter_ids.split(',') if submitter_id.strip()]
    return []

def is_owner(user_id=None):
    """Check if user is the owner"""
    if user_id is None:
        user = get_current_user()
        if not user:
            return False
        user_id = user['id']
    
    owner_id = get_owner_id()
    return str(user_id) == str(owner_id)

def is_admin(user_id=None):
    """Check if user is admin (includes owner)"""
    if user_id is None:
        user = get_current_user()
        if not user:
            return False
        user_id = user['id']
    
    # Owner is always admin
    if is_owner(user_id):
        return True
    
    admin_ids = get_admin_ids()
    return str(user_id) in [str(admin_id) for admin_id in admin_ids]

def has_submit_perms(user_id=None):
    """Check if user can submit matches (owner/admin or in MATCH_SUBMITTERS)"""
    if user_id is None:
        user = get_current_user()
        if not user:
            return False
        user_id = user['id']

    if is_admin(user_id):
        return True

    submitter_ids = get_match_submitter_ids()
    return str(user_id) in [str(submitter_id) for submitter_id in submitter_ids]

def _is_api_request():
    """Return True if the request expects a JSON response (API call)."""
    return request.is_json or 'application/json' in request.accept_mimetypes


def require_owner(f):
    """Decorator to require owner privileges"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Not authenticated'}), 401
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))
        
        if not is_owner():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Owner privileges required'}), 403
            flash('Owner privileges required.', 'error')
            return redirect(url_for('index'))
        
        return f(*args, **kwargs)
    return decorated_function

def require_admin(f):
    """Decorator to require admin privileges"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Not authenticated'}), 401
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))
        
        if not is_admin():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Admin privileges required'}), 403
            flash('Admin privileges required.', 'error')
            return redirect(url_for('index'))
        
        return f(*args, **kwargs)
    return decorated_function

def require_submit_perms(f):
    """Decorator to require match submit privileges"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Not authenticated'}), 401
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))

        if not has_submit_perms():
            if _is_api_request():
                return jsonify({'ok': False, 'error': 'Match submit privileges required'}), 403
            flash('Match submit privileges required.', 'error')
            return redirect(url_for('index'))

        return f(*args, **kwargs)
    return decorated_function

def get_all_privileged_users():
    """Get all users with special privileges for admin display"""
    return {
        'owner': get_owner_id(),
        'admins': get_admin_ids()
    }