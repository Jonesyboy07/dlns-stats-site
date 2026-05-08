from flask import Blueprint, render_template

react_stats_bp = Blueprint('react_stats', __name__)


@react_stats_bp.get('/matchlist')
def matchlist():
    """Serve the React match list page."""
    return render_template('react.html', page='matchlist')


@react_stats_bp.get('/match/<int:match_id>')
def match_detail(match_id):
    """Serve the React match detail page."""
    return render_template('react.html', page='match_detail')


@react_stats_bp.get('/series/<int:match_id>')
def series_detail(match_id):
    """Serve the React series detail page."""
    return render_template('react.html', page='match_detail')


@react_stats_bp.get('/players')
def players_list():
    """Serve the React players list page."""
    return render_template('react.html', page='players')


@react_stats_bp.get('/player/<int:account_id>')
def player_detail(account_id):
    """Serve the React player detail page."""
    return render_template('react.html', page='player_detail')


@react_stats_bp.get('/heroes')
def heroes_list():
    """Serve the React heroes list page."""
    return render_template('react.html', page='heroes')


@react_stats_bp.get('/hero/<int:hero_id>')
def hero_detail(hero_id):
    """Serve the React hero detail page."""
    return render_template('react.html', page='hero_detail')


@react_stats_bp.get('/items')
def items_page():
    """Serve the React items page."""
    return render_template('react.html', page='items')


@react_stats_bp.get('/teams')
def teams_list():
    """Serve the React teams list page."""
    return render_template('react.html', page='matchlist')


@react_stats_bp.get('/team/<path:team_name>')
def team_detail(team_name):
    """Serve the React team detail page."""
    return render_template('react.html', page='matchlist')


@react_stats_bp.get('/week')
def week_index():
    """Serve the React Week Detail index (redirects to latest week)."""
    return render_template('react.html', page='matchlist')


@react_stats_bp.get('/week/<int:week>')
def week_detail(week):
    """Serve the React Week Detail page."""
    return render_template('react.html', page='matchlist')


@react_stats_bp.get('/react-admin')
def react_admin_hub():
    """Serve the React Admin Hub page."""
    return render_template('react.html', page='match_admin')
