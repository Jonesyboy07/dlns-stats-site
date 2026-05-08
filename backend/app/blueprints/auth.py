from flask import Blueprint, request, redirect, url_for, flash, current_app, jsonify
import requests
import os
import secrets
import time
import sqlite3

auth_bp = Blueprint('auth', __name__, url_prefix='/auth')

# Discord OAuth2 configuration
DISCORD_API_BASE_URL = 'https://discord.com/api'
DISCORD_OAUTH2_URL = f'{DISCORD_API_BASE_URL}/oauth2/authorize'
DISCORD_TOKEN_URL = f'{DISCORD_API_BASE_URL}/oauth2/token'
DISCORD_USER_URL = f'{DISCORD_API_BASE_URL}/users/@me'

# Session configuration
SESSION_TIMEOUT = 30 * 24 * 3600  # 30 days
SESSION_TABLE = 'user_sessions'


def _init_session_table():
    """Initialize session table if it doesn't exist"""
    try:
        db_path = current_app.config.get('DB_PATH', './data/dlns.sqlite3')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'''
            CREATE TABLE IF NOT EXISTS {SESSION_TABLE} (
                session_token TEXT PRIMARY KEY,
                discord_id TEXT NOT NULL,
                username TEXT NOT NULL,
                avatar TEXT,
                created_at INTEGER NOT NULL,
                last_accessed_at INTEGER NOT NULL
            )
        ''')
        conn.commit()
        conn.close()
    except Exception as e:
        current_app.logger.error(f"Failed to init session table: {e}")


def _create_session(discord_id, username, avatar=None):
    """Create a new secure session and return the token"""
    _init_session_table()
    session_token = secrets.token_urlsafe(32)
    now = int(time.time())
    
    try:
        db_path = current_app.config.get('DB_PATH', './data/dlns.sqlite3')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'''
            INSERT INTO {SESSION_TABLE} 
            (session_token, discord_id, username, avatar, created_at, last_accessed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        ''', (session_token, str(discord_id), username, avatar, now, now))
        conn.commit()
        conn.close()
    except Exception as e:
        current_app.logger.error(f"Failed to create session: {e}")
        return None
    
    return session_token


def _get_session(session_token):
    """Retrieve and validate session"""
    _init_session_table()
    try:
        db_path = current_app.config.get('DB_PATH', './data/dlns.sqlite3')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'SELECT * FROM {SESSION_TABLE} WHERE session_token = ?', (session_token,))
        row = cursor.fetchone()
        conn.close()
        
        if not row:
            return None
        
        session_token, discord_id, username, avatar, created_at, last_accessed_at = row
        now = int(time.time())
        
        # Check if session expired
        if now - created_at > SESSION_TIMEOUT:
            _delete_session(session_token)
            return None
        
        # Update last_accessed_at
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'UPDATE {SESSION_TABLE} SET last_accessed_at = ? WHERE session_token = ?', (now, session_token))
        conn.commit()
        conn.close()
        
        return {
            'id': discord_id,
            'username': username,
            'avatar': avatar,
        }
    except Exception as e:
        current_app.logger.error(f"Failed to get session: {e}")
        return None


def _delete_session(session_token):
    """Delete a session"""
    try:
        db_path = current_app.config.get('DB_PATH', './data/dlns.sqlite3')
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute(f'DELETE FROM {SESSION_TABLE} WHERE session_token = ?', (session_token,))
        conn.commit()
        conn.close()
    except Exception as e:
        current_app.logger.error(f"Failed to delete session: {e}")


def get_discord_config():
    """Get Discord configuration from environment"""
    return {
        'DISCORD_CLIENT_ID': os.getenv('DISCORD_CLIENT_ID'),
        'DISCORD_CLIENT_SECRET': os.getenv('DISCORD_CLIENT_SECRET'),
        'DISCORD_REDIRECT_URI': os.getenv('DISCORD_REDIRECT_URI', 'http://localhost:5050/auth/discord/callback')
    }


@auth_bp.route('/login')
def login():
    """Redirect to Discord OAuth2 authorization with next -> state"""
    config = get_discord_config()
    next_url = request.args.get("next") or url_for("index")

    discord_auth_url = (
        f"{DISCORD_OAUTH2_URL}"
        f"?client_id={config['DISCORD_CLIENT_ID']}"
        f"&redirect_uri={config['DISCORD_REDIRECT_URI']}"
        f"&response_type=code"
        f"&scope=identify"
        f"&state={next_url}"
    )

    return redirect(discord_auth_url)


@auth_bp.route('/discord/callback')
def discord_callback():
    """Handle Discord OAuth2 callback and create secure session"""
    code = request.args.get('code')
    state_redirect = request.args.get('state')

    if not code:
        flash('Authorization failed - no code received.', 'error')
        return redirect(url_for('index'))

    config = get_discord_config()

    token_data = {
        'client_id': config['DISCORD_CLIENT_ID'],
        'client_secret': config['DISCORD_CLIENT_SECRET'],
        'grant_type': 'authorization_code',
        'code': code,
        'redirect_uri': config['DISCORD_REDIRECT_URI'],
        'scope': 'identify'
    }

    headers = {'Content-Type': 'application/x-www-form-urlencoded'}

    try:
        token_response = requests.post(DISCORD_TOKEN_URL, data=token_data, headers=headers)
        token_response.raise_for_status()
        token_json = token_response.json()

        access_token = token_json.get('access_token')
        if not access_token:
            flash('Failed to obtain access token.', 'error')
            return redirect(url_for('index'))

        user_headers = {'Authorization': f'Bearer {access_token}'}
        user_response = requests.get(DISCORD_USER_URL, headers=user_headers)
        user_response.raise_for_status()
        user_data = user_response.json()

        discord_id = user_data.get('id')
        username = user_data.get('username')
        avatar = user_data.get('avatar')

        # Create secure session token
        session_token = _create_session(discord_id, username, avatar)
        if not session_token:
            flash('Failed to create session.', 'error')
            return redirect(url_for('index'))

        # Set HTTP-only secure cookie
        response = redirect(state_redirect if state_redirect else url_for('index'))
        is_production = os.getenv('ENV') == 'production'
        response.set_cookie(
            'session_token',
            session_token,
            max_age=SESSION_TIMEOUT,
            secure=is_production,
            httponly=True,
            samesite='None' if is_production else 'Lax'
        )

        current_app.logger.info(f"User logged in: {username} ({discord_id})")
        flash(f'Welcome, {username}!', 'success')

        return response

    except requests.RequestException as e:
        current_app.logger.error(f"Discord OAuth error: {e}")
        flash('Authentication failed. Please try again.', 'error')
        return redirect(url_for('index'))


@auth_bp.route('/logout')
def logout():
    """Log out the current user"""
    session_token = request.cookies.get('session_token')
    if session_token:
        _delete_session(session_token)
        flash('Goodbye!', 'info')
    
    response = redirect(url_for('index'))
    response.delete_cookie('session_token')
    return response


@auth_bp.route('/api/me')
def api_me():
    """Get current user from secure session cookie"""
    session_token = request.cookies.get('session_token')
    if not session_token:
        return jsonify({'ok': False, 'user': None})
    
    user = _get_session(session_token)
    if user:
        return jsonify({'ok': True, 'user': user})
    return jsonify({'ok': False, 'user': None})
