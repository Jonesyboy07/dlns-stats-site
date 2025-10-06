from flask import Blueprint, render_template, current_app
from utils.auth import require_admin, get_current_user, get_all_privileged_users

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

@admin_bp.route('/')
@require_admin
def admin_panel():
    """Main admin panel"""
    user = get_current_user()
    privileged_users = get_all_privileged_users()
    
    # Get some basic stats
    from blueprints.db_api import get_ro_conn
    
    stats = {}
    try:
        with get_ro_conn() as conn:
            # Check what tables exist first
            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            table_names = [t[0] for t in tables]
            
            # Total matches
            if 'matches' in table_names:
                stats['total_matches'] = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
            else:
                stats['total_matches'] = 0
            
            # Total unique players - check if match_players exists, otherwise use users table
            if 'match_players' in table_names:
                stats['total_players'] = conn.execute("SELECT COUNT(DISTINCT account_id) FROM match_players").fetchone()[0]
            elif 'users' in table_names:
                stats['total_players'] = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
            else:
                stats['total_players'] = 0
            
            # Recent matches (last 7 days)
            if 'matches' in table_names:
                stats['recent_matches'] = conn.execute(
                    "SELECT COUNT(*) FROM matches WHERE created_at > datetime('now', '-7 days')"
                ).fetchone()[0]
            else:
                stats['recent_matches'] = 0
            
    except Exception as e:
        current_app.logger.error(f"Error getting admin stats: {e}")
        stats = {'total_matches': 0, 'total_players': 0, 'recent_matches': 0}
    
    return render_template(
        'admin/panel.html',
        privileged_users=privileged_users,
        user=user,
        stats=stats
    )

@admin_bp.route('/users')
@require_admin
def manage_users():
    """View privileged users (read-only since they're managed via environment)"""
    privileged_users = get_all_privileged_users()
    
    return render_template('admin/users.html', privileged_users=privileged_users)

@admin_bp.route('/logs')
@require_admin
def view_logs():
    """View system logs"""
    # You can implement log viewing here
    # For now, just return a placeholder
    return render_template('admin/logs.html')
