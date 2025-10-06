from functools import wraps
from flask import session, flash, redirect, url_for
import os

def is_logged_in():
    """Check if user is logged in"""
    return 'discord_user' in session

def get_current_user():
    """Get current user from session"""
    return session.get('discord_user')

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

def require_owner(f):
    """Decorator to require owner privileges"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))
        
        if not is_owner():
            flash('Owner privileges required.', 'error')
            return redirect(url_for('index'))
        
        return f(*args, **kwargs)
    return decorated_function

def require_admin(f):
    """Decorator to require admin privileges"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if not is_logged_in():
            flash('Please log in to access this page.', 'warning')
            return redirect(url_for('auth.login'))
        
        if not is_admin():
            flash('Admin privileges required.', 'error')
            return redirect(url_for('index'))
        
        return f(*args, **kwargs)
    return decorated_function

def get_all_privileged_users():
    """Get all users with special privileges for admin display"""
    return {
        'owner': get_owner_id(),
        'admins': get_admin_ids()
    }