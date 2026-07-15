from flask import Blueprint, render_template
from .db_api import get_ro_conn
from ..heroes import get_hero_name
import threading
import time
import logging
from flask import current_app  # added

stats_bp = Blueprint('stats', __name__, url_prefix='/stats')

# Global cache for statistics data
_stats_cache = None
_cache_lock = threading.RLock()
_last_update = 0
CACHE_DURATION = 300  # 5 minutes in seconds

@stats_bp.context_processor
def inject_helpers():
    return dict(get_hero_name=get_hero_name)

def _compute_statistics():
    """Compute all statistics from database."""
    with get_ro_conn() as conn:
        # Basic counts
        match_count = conn.execute("SELECT COUNT(*) FROM matches").fetchone()[0]
        user_count = conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]

        # Win/Loss totals
        wins = conn.execute("SELECT COUNT(*) FROM players WHERE result = 'Win'").fetchone()[0]
        losses = conn.execute("SELECT COUNT(*) FROM players WHERE result = 'Loss'").fetchone()[0]

        # Aggregate statistics from players table
        stats_query = """
        SELECT 
            COALESCE(SUM(shots_hit), 0) as total_shots_hit,
            COALESCE(SUM(shots_missed), 0) as total_shots_missed,
            COALESCE(SUM(player_damage), 0) as total_player_damage,
            COALESCE(SUM(player_healing), 0) as total_player_healing,
            COALESCE(SUM(kills), 0) as total_kills,
            COALESCE(SUM(deaths), 0) as total_deaths,
            COALESCE(SUM(assists), 0) as total_assists,
            COALESCE(SUM(creep_kills), 0) as total_creep_kills,
            COALESCE(SUM(last_hits), 0) as total_last_hits,
            COALESCE(SUM(denies), 0) as total_denies,
            COALESCE(SUM(obj_damage), 0) as total_obj_damage,
            COALESCE(SUM(pings_count), 0) as total_pings,
            COALESCE(SUM(net_worth), 0) as total_net_worth,
            COALESCE(AVG(kills), 0) as avg_kills,
            COALESCE(AVG(deaths), 0) as avg_deaths,
            COALESCE(AVG(assists), 0) as avg_assists,
            COALESCE(AVG(net_worth), 0) as avg_net_worth
        FROM players
        """

        stats_row = conn.execute(stats_query).fetchone()

        # Calculate additional stats
        total_shots_fired = stats_row[0] + stats_row[1]  # shots_hit + shots_missed
        shot_accuracy = (stats_row[0] / total_shots_fired * 100) if total_shots_fired > 0 else 0

        # Hero selection statistics
        hero_selection = conn.execute("""
        SELECT 
            hero_id,
            COUNT(*) as pick_count
        FROM players 
        WHERE hero_id IS NOT NULL
        GROUP BY hero_id
        HAVING pick_count > 0
        ORDER BY pick_count DESC
        """).fetchall()

        # Build hero_stats list expected by the template (include all picked heroes)
        total_picks = sum([h[1] for h in hero_selection]) if hero_selection else 0
        hero_stats = []
        for hid, picks in hero_selection:
            # compute win count for this hero
            win_count = conn.execute(
                "SELECT COUNT(*) FROM players WHERE hero_id = ? AND result = 'Win'",
                (hid,),
            ).fetchone()[0]
            win_rate = (win_count / picks) if picks > 0 else 0
            pick_percentage = (picks / total_picks) if total_picks > 0 else 0
            hero_stats.append({
                'hero_id': hid,
                'hero_name': get_hero_name(hid),
                'pick_count': picks,
                'win_rate': round(win_rate, 4),
                'pick_percentage': round(pick_percentage, 4),
            })

        most_picked_hero = hero_selection[0] if hero_selection else None
        least_picked_hero = hero_selection[-1] if hero_selection else None

        # Match duration statistics with match IDs
        duration_stats = conn.execute("""
        SELECT 
            COALESCE(AVG(duration_s), 0) as avg_duration,
            COALESCE(MIN(duration_s), 0) as min_duration,
            COALESCE(MAX(duration_s), 0) as max_duration,
            COALESCE(SUM(duration_s), 0) as total_duration
        FROM matches 
        WHERE duration_s IS NOT NULL AND duration_s > 0
        """).fetchone()

        # Get match IDs for shortest and longest matches
        min_match = conn.execute("""
        SELECT match_id FROM matches 
        WHERE duration_s IS NOT NULL AND duration_s > 0
        ORDER BY duration_s ASC LIMIT 1
        """).fetchone()

        max_match = conn.execute("""
        SELECT match_id FROM matches 
        WHERE duration_s IS NOT NULL AND duration_s > 0
        ORDER BY duration_s DESC LIMIT 1
        """).fetchone()

        # Team statistics (wins per side)
        team_stats_rows = conn.execute("""
        SELECT 
            winning_team,
            COUNT(*) as wins
        FROM matches 
        WHERE winning_team IS NOT NULL
        GROUP BY winning_team
        ORDER BY winning_team
        """).fetchall()
        # convert to list of dicts for template
        total_recorded_wins = sum([r[1] for r in team_stats_rows]) if team_stats_rows else 0
        team_stats = []
        for t, w in team_stats_rows:
            win_rate = (w / total_recorded_wins) if total_recorded_wins > 0 else 0
            team_stats.append({'team': t, 'wins': w, 'total_matches': match_count, 'win_rate': round(win_rate, 4)})

        # Top performers (expanded)
        top_killers = conn.execute("""
        SELECT 
            u.persona_name,
            p.kills,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.kills DESC
        LIMIT 5
        """).fetchall()

        top_damage_dealers = conn.execute("""
        SELECT 
            u.persona_name,
            p.player_damage,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.player_damage DESC
        LIMIT 5
        """).fetchall()

        top_healers = conn.execute("""
        SELECT 
            u.persona_name,
            p.player_healing,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.player_healing DESC
        LIMIT 5
        """).fetchall()

        # Top souls (net_worth)
        top_souls = conn.execute("""
        SELECT 
            u.persona_name,
            p.net_worth,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.net_worth DESC
        LIMIT 5
        """).fetchall()

        # Top last hits
        top_last_hits = conn.execute("""
        SELECT 
            u.persona_name,
            p.last_hits,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.last_hits DESC
        LIMIT 5
        """).fetchall()

        # Top objective damage
        top_obj_damage = conn.execute("""
        SELECT 
            u.persona_name,
            p.obj_damage,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.obj_damage DESC
        LIMIT 5
        """).fetchall()

        # Best KDA performers (kills + assists / deaths)
        top_kda = conn.execute("""
        SELECT 
            u.persona_name,
            ROUND((CAST(p.kills + p.assists AS FLOAT) / NULLIF(p.deaths, 0)), 2) as kda,
            p.kills,
            p.deaths,
            p.assists,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        WHERE p.deaths > 0
        ORDER BY kda DESC
        LIMIT 5
        """).fetchall()

        # Most assists
        top_assists = conn.execute("""
        SELECT 
            u.persona_name,
            p.assists,
            p.match_id
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        ORDER BY p.assists DESC
        LIMIT 5
        """).fetchall()

        # Some goofy / fun stats (expanded)
        # Most pings in a match (single-match max)
        most_pings = conn.execute("""
        SELECT u.persona_name, MAX(COALESCE(p.pings_count,0)) as pings
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        LIMIT 1
        """).fetchone()

        # Most shots fired in a single match (hit + missed)
        most_shots_fired = conn.execute("""
        SELECT u.persona_name, MAX(COALESCE(p.shots_hit,0) + COALESCE(p.shots_missed,0)) as shots
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        LIMIT 1
        """).fetchone()

        # Player with most matches where they had zero kills
        most_zero_kill_matches = conn.execute("""
        SELECT u.persona_name, SUM(CASE WHEN COALESCE(p.kills,0) = 0 THEN 1 ELSE 0 END) as zero_matches
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        GROUP BY p.account_id
        ORDER BY zero_matches DESC
        LIMIT 1
        """).fetchone()

        # Most denies in a single match
        most_denies = conn.execute("""
        SELECT u.persona_name, MAX(COALESCE(p.denies,0)) as denies
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        LIMIT 1
        """).fetchone()

        # Player with the most matches that did zero damage
        most_zero_damage_matches = conn.execute("""
        SELECT u.persona_name, SUM(CASE WHEN COALESCE(p.player_damage,0) = 0 THEN 1 ELSE 0 END) as zero_damage_matches
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        GROUP BY p.account_id
        ORDER BY zero_damage_matches DESC
        LIMIT 1
        """).fetchone()

        # Highest win rate among players with at least 5 matches (luckiest player)
        highest_win_rate = conn.execute("""
        SELECT u.persona_name, (sub.wins * 1.0 / sub.matches) as win_rate, sub.wins, sub.matches FROM (
            SELECT p.account_id,
                         SUM(CASE WHEN p.result = 'Win' THEN 1 ELSE 0 END) as wins,
                         COUNT(*) as matches
            FROM players p
            GROUP BY p.account_id
            HAVING matches >= 5
        ) sub
        LEFT JOIN users u ON u.account_id = sub.account_id
        ORDER BY win_rate DESC
        LIMIT 1
        """).fetchone()

        # Most trigger-happy (highest average shots fired per match)
        most_trigger_happy = conn.execute("""
        SELECT u.persona_name, AVG(COALESCE(p.shots_hit,0) + COALESCE(p.shots_missed,0)) as avg_shots
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        GROUP BY p.account_id
        ORDER BY avg_shots DESC
        LIMIT 1
        """).fetchone()

        # Most inaccurate player (lowest accuracy) among players with >= 100 total shots
        most_inaccurate = conn.execute("""
        SELECT u.persona_name, totals.total_hit, totals.total_fired, ROUND((totals.total_hit * 1.0 / totals.total_fired) * 100, 2) as accuracy_pct FROM (
            SELECT p.account_id,
                         SUM(COALESCE(p.shots_hit,0)) as total_hit,
                         SUM(COALESCE(p.shots_hit,0)) + SUM(COALESCE(p.shots_missed,0)) as total_fired
            FROM players p
            GROUP BY p.account_id
        ) totals
        LEFT JOIN users u ON u.account_id = totals.account_id
        WHERE totals.total_fired >= 100
        ORDER BY accuracy_pct ASC
        LIMIT 1
        """).fetchone()

        # Weirdest hero: highest average deaths per pick (min 5 picks)
        weirdest_hero = conn.execute("""
        SELECT p.hero_id, AVG(COALESCE(p.deaths,0)) as avg_deaths, COUNT(*) as picks
                FROM players p
                WHERE p.hero_id IS NOT NULL
                GROUP BY p.hero_id
                HAVING picks >= 5
                ORDER BY avg_deaths DESC
                LIMIT 1
                """).fetchone()

        weirdest_hero_name = get_hero_name(weirdest_hero[0]) if weirdest_hero else None

        # Player who played the same hero the most times
        most_same_hero_player = conn.execute("""
        SELECT u.persona_name, p.hero_id, COUNT(*) as cnt
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        WHERE p.hero_id IS NOT NULL
        GROUP BY p.account_id, p.hero_id
        ORDER BY cnt DESC
        LIMIT 1
        """).fetchone()

        # Most flawless matches (deaths == 0) per player
        most_flawless_matches = conn.execute("""
        SELECT u.persona_name, SUM(CASE WHEN COALESCE(p.deaths,0) = 0 THEN 1 ELSE 0 END) as flawless
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        GROUP BY p.account_id
        ORDER BY flawless DESC
        LIMIT 1
        """).fetchone()

        # Most common players (by matches played) - top 20
        most_common_players = conn.execute("""
        SELECT 
            u.persona_name,
            COUNT(*) as matches_played
        FROM players p
        LEFT JOIN users u ON u.account_id = p.account_id
        GROUP BY p.account_id
        ORDER BY matches_played DESC
        LIMIT 20
        """).fetchall()

        # Hero records (best per-hero values)
        hero_kills = conn.execute("""
        SELECT 
            p.hero_id,
            MAX(p.kills) as max_kills
        FROM players p
        WHERE p.hero_id IS NOT NULL AND p.kills IS NOT NULL
        GROUP BY p.hero_id
        ORDER BY max_kills DESC
        LIMIT 1
        """).fetchone()

        hero_kills_detail = None
        if hero_kills:
            hero_kills_detail = conn.execute("""
            SELECT p.match_id, u.persona_name
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.kills = ?
            LIMIT 1
            """, (hero_kills[0], hero_kills[1])).fetchone()

        hero_damage = conn.execute("""
        SELECT 
            p.hero_id,
            MAX(p.player_damage) as max_damage
        FROM players p
        WHERE p.hero_id IS NOT NULL AND p.player_damage IS NOT NULL
        GROUP BY p.hero_id
        ORDER BY max_damage DESC
        LIMIT 1
        """).fetchone()

        hero_damage_detail = None
        if hero_damage:
            hero_damage_detail = conn.execute("""
            SELECT p.match_id, u.persona_name
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.player_damage = ?
            LIMIT 1
            """, (hero_damage[0], hero_damage[1])).fetchone()

        hero_healing = conn.execute("""
        SELECT 
            p.hero_id,
            MAX(p.player_healing) as max_healing
        FROM players p
        WHERE p.hero_id IS NOT NULL AND p.player_healing IS NOT NULL
        GROUP BY p.hero_id
        ORDER BY max_healing DESC
        LIMIT 1
        """).fetchone()

        hero_healing_detail = None
        if hero_healing:
            hero_healing_detail = conn.execute("""
            SELECT p.match_id, u.persona_name
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.player_healing = ?
            LIMIT 1
            """, (hero_healing[0], hero_healing[1])).fetchone()

        hero_souls = conn.execute("""
        SELECT 
            p.hero_id,
            MAX(p.net_worth) as max_souls
        FROM players p
        WHERE p.hero_id IS NOT NULL AND p.net_worth IS NOT NULL
        GROUP BY p.hero_id
        ORDER BY max_souls DESC
        LIMIT 1
        """).fetchone()

        hero_souls_detail = None
        if hero_souls:
            hero_souls_detail = conn.execute("""
            SELECT p.match_id, u.persona_name
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.net_worth = ?
            LIMIT 1
            """, (hero_souls[0], hero_souls[1])).fetchone()

        hero_last_hits = conn.execute("""
        SELECT 
            p.hero_id,
            MAX(p.last_hits) as max_last_hits
        FROM players p
        WHERE p.hero_id IS NOT NULL AND p.last_hits IS NOT NULL
        GROUP BY p.hero_id
        ORDER BY max_last_hits DESC
        LIMIT 1
        """).fetchone()

        hero_last_hits_detail = None
        if hero_last_hits:
            hero_last_hits_detail = conn.execute("""
            SELECT p.match_id, u.persona_name
            FROM players p
            LEFT JOIN users u ON u.account_id = p.account_id
            WHERE p.hero_id = ? AND p.last_hits = ?
            LIMIT 1
            """, (hero_last_hits[0], hero_last_hits[1])).fetchone()

        # Recent activity (last 7 / 30 days)
        try:
            matches_last_7 = conn.execute("SELECT COUNT(*) FROM matches WHERE created_at >= datetime('now','-7 days')").fetchone()[0]
            matches_last_30 = conn.execute("SELECT COUNT(*) FROM matches WHERE created_at >= datetime('now','-30 days')").fetchone()[0]
        except Exception:
            # If created_at is not present or DB doesn't support datetime(), fall back to 0
            matches_last_7 = 0
            matches_last_30 = 0

        return {
            'basic': {
                'match_count': match_count,
                'user_count': user_count,
                'total_wins': wins,
                'total_losses': losses,
                'avg_match_duration': int(duration_stats[0]) if duration_stats and duration_stats[0] is not None else 0,
            },
            'combat': {
                'total_kills': int(stats_row[4]),
                'total_deaths': int(stats_row[5]),
                'total_assists': int(stats_row[6]),
                'total_player_damage': int(stats_row[2]),
                'total_obj_damage': int(stats_row[10]),
                'total_player_healing': int(stats_row[3]),
                'total_net_worth': int(stats_row[12]),
                'avg_kills': round(stats_row[13], 2),
                'avg_deaths': round(stats_row[14], 2),
                'avg_assists': round(stats_row[15], 2),
                'avg_net_worth': round(stats_row[16], 2)
            },
            'shooting': {
                'total_shots_hit': int(stats_row[0]),
                'total_shots_missed': int(stats_row[1]),
                'total_shots_fired': int(total_shots_fired),
                'shot_accuracy': round(shot_accuracy, 2)
            },
            'farming': {
                'total_creep_kills': int(stats_row[7]),
                'total_last_hits': int(stats_row[8]),
                'total_denies': int(stats_row[9])
            },
            'communication': {
                'total_pings': int(stats_row[11])
            },
            'heroes': {
                'most_picked': {
                    'hero_id': most_picked_hero[0] if most_picked_hero else None,
                    'hero_name': get_hero_name(most_picked_hero[0]) if most_picked_hero else 'None',
                    'pick_count': most_picked_hero[1] if most_picked_hero else 0
                },
                'least_picked': {
                    'hero_id': least_picked_hero[0] if least_picked_hero else None,
                    'hero_name': get_hero_name(least_picked_hero[0]) if least_picked_hero else 'None',
                    'pick_count': least_picked_hero[1] if least_picked_hero else 0
                }
            },
            # Provide a hero_stats list for the template (top heroes with enough picks)
            'hero_stats': hero_stats,
            'duration': {
                'avg_duration': int(duration_stats[0]) if duration_stats and duration_stats[0] is not None else 0,
                'min_duration': int(duration_stats[1]) if duration_stats and duration_stats[1] is not None else 0,
                'max_duration': int(duration_stats[2]) if duration_stats and duration_stats[2] is not None else 0,
                'total_duration': int(duration_stats[3]) if duration_stats and duration_stats[3] is not None else 0,
                'min_match_id': min_match[0] if min_match else 0,
                'max_match_id': max_match[0] if max_match else 0
            },
            'teams': {
                'amber_wins': next((t[1] for t in team_stats_rows if t[0] == 0), 0),
                'sapphire_wins': next((t[1] for t in team_stats_rows if t[0] == 1), 0)
            },
            # team_stats shaped for the template
            'team_stats': team_stats,
            'top_performers': {
                'killers': top_killers,
                'damage_dealers': top_damage_dealers,
                'healers': top_healers,
                'most_common': most_common_players,
                'souls': top_souls,
                'last_hits': top_last_hits,
                'obj_damage': top_obj_damage,
                'kda': top_kda,
                'assists': top_assists
            },
            'hero_records': {
                'kills': {
                    'hero_name': get_hero_name(hero_kills[0]) if hero_kills else 'None',
                    'value': hero_kills[1] if hero_kills else 0,
                    'match_id': hero_kills_detail[0] if hero_kills_detail else 0,
                    'player': hero_kills_detail[1] if hero_kills_detail else 'Unknown'
                } if hero_kills else None,
                'damage': {
                    'hero_name': get_hero_name(hero_damage[0]) if hero_damage else 'None',
                    'value': hero_damage[1] if hero_damage else 0,
                    'match_id': hero_damage_detail[0] if hero_damage_detail else 0,
                    'player': hero_damage_detail[1] if hero_damage_detail else 'Unknown'
                } if hero_damage else None,
                'healing': {
                    'hero_name': get_hero_name(hero_healing[0]) if hero_healing else 'None',
                    'value': hero_healing[1] if hero_healing else 0,
                    'match_id': hero_healing_detail[0] if hero_healing_detail else 0,
                    'player': hero_healing_detail[1] if hero_healing_detail else 'Unknown'
                } if hero_healing else None,
                'souls': {
                    'hero_name': get_hero_name(hero_souls[0]) if hero_souls else 'None',
                    'value': hero_souls[1] if hero_souls else 0,
                    'match_id': hero_souls_detail[0] if hero_souls_detail else 0,
                    'player': hero_souls_detail[1] if hero_souls_detail else 'Unknown'
                } if hero_souls else None,
                'last_hits': {
                    'hero_name': get_hero_name(hero_last_hits[0]) if hero_last_hits else 'None',
                    'value': hero_last_hits[1] if hero_last_hits else 0,
                    'match_id': hero_last_hits_detail[0] if hero_last_hits_detail else 0,
                    'player': hero_last_hits_detail[1] if hero_last_hits_detail else 'Unknown'
                } if hero_last_hits else None
            },
            'funny_stats': {
                'most_pings': {
                    'player': most_pings[0] if most_pings else None,
                    'value': int(most_pings[1]) if most_pings and most_pings[1] is not None else 0
                },
                'most_shots_fired': {
                    'player': most_shots_fired[0] if most_shots_fired else None,
                    'value': int(most_shots_fired[1]) if most_shots_fired and most_shots_fired[1] is not None else 0
                },
                'most_zero_kill_matches': {
                    'player': most_zero_kill_matches[0] if most_zero_kill_matches else None,
                    'value': int(most_zero_kill_matches[1]) if most_zero_kill_matches and most_zero_kill_matches[1] is not None else 0
                }
            },
            'recent_activity': {
                'matches_last_7_days': matches_last_7,
                'matches_last_30_days': matches_last_30,
                'avg_daily_matches': round(matches_last_30 / 30, 2) if matches_last_30 is not None else 0
            }
        }

def _get_cached_statistics():
    """Get cached statistics, computing if necessary."""
    global _stats_cache, _last_update
    
    current_time = time.time()
    
    with _cache_lock:
        # Check if cache is still valid
        if _stats_cache is not None and (current_time - _last_update) < CACHE_DURATION:
            return _stats_cache
        
        # Cache is stale or doesn't exist, recompute
        try:
            logging.info("Computing fresh statistics...")
            start_time = time.time()
            _stats_cache = _compute_statistics()
            _last_update = current_time
            compute_time = time.time() - start_time
            logging.info(f"Statistics computed in {compute_time:.2f} seconds")
            return _stats_cache
        except Exception as e:
            logging.error(f"Error computing statistics: {e}")
            # Return old cache if available, otherwise empty stats
            return _stats_cache if _stats_cache else {}

def _background_refresh():
    """Background task to refresh statistics cache."""
    global _stats_cache, _last_update
    while True:
        try:
            time.sleep(CACHE_DURATION - 30)  # Refresh 30 seconds before expiry
            with _cache_lock:
                current_time = time.time()
                if (current_time - _last_update) >= (CACHE_DURATION - 30):
                    logging.info("Background refresh of statistics cache...")
                    # recompute and write cache
                    data = _compute_statistics()
                    _stats_cache = data
                    _last_update = time.time()
        except Exception as e:
            logging.error(f"Background refresh error: {e}")
        time.sleep(60)  # Check every minute

# Start background refresh thread IN APP CONTEXT (replaces eager start)
def _run_refresh_worker_in_app(app):
    with app.app_context():
        _background_refresh()

@stats_bp.before_app_request
def _start_stats_thread():
    # prevent duplicate threads under reloader
    app = current_app._get_current_object()
    if getattr(app, "_stats_refresh_started", False):
        return
    app._stats_refresh_started = True
    threading.Thread(
        target=lambda: _run_refresh_worker_in_app(app),
        daemon=True,
        name="stats-refresh",
    ).start()

@stats_bp.get('/')
def statistics():
    """Serve stats via React while keeping Flask DB/API routes intact."""
    return render_template('react.html', page='stats')

# Add a manual refresh endpoint for admins
@stats_bp.get('/refresh')
def refresh_statistics():
    """Manually refresh statistics cache."""
    global _stats_cache, _last_update
    
    with _cache_lock:
        _stats_cache = None  # Force refresh
        _last_update = 0
    
    return "Statistics cache refreshed!", 200