"""Admin bracket builder: create an event from a format, then enter match IDs per series.

Bracket structure lives in ``data/brackets.json`` (next to the database). Saving
a series ingests its games through the same job MatchAdmin uses, so stats pages
and ``matches.json`` stay the source of truth for game data; scores and
advancement are computed from those results on every read.
"""

from __future__ import annotations

import json
import re
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from flask import Blueprint, current_app, jsonify, render_template, request

from ..utils import brackets as bk
from ..utils.auth import require_admin
from . import admin as admin_mod
from ...main import (
    SkipMatchSilent,
    db_connect,
    db_init,
    fetch_match_metadata,
    parse_time_to_iso,
    recompute_user_stats_bulk,
    team_from_slot,
)

brackets_bp = Blueprint('brackets', __name__, url_prefix='/admin/brackets')

_brackets_lock = threading.Lock()


def _db_path() -> Path:
    return Path(current_app.config.get('DB_PATH', './data/dlns.sqlite3'))


def _brackets_path() -> Path:
    return _db_path().parent / 'brackets.json'


def _load() -> Dict[str, Any]:
    path = _brackets_path()
    try:
        with path.open('r', encoding='utf-8') as f:
            data = json.load(f)
    except FileNotFoundError:
        return {'events': []}
    if not isinstance(data, dict) or not isinstance(data.get('events'), list):
        return {'events': []}
    return data


def _save(data: Dict[str, Any]) -> None:
    path = _brackets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix('.json.tmp')
    with tmp.open('w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    tmp.replace(path)


def _find_event(data: Dict[str, Any], event_id: str) -> Optional[Dict[str, Any]]:
    return next((e for e in data['events'] if e.get('id') == event_id), None)


def _slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'event'


def _results_for(match_ids: List[int]) -> Dict[int, str]:
    """{match_id: winning slot} for ingested matches, from the DB."""
    if not match_ids:
        return {}
    results: Dict[int, str] = {}
    conn = db_connect(_db_path())
    try:
        db_init(conn)
        placeholders = ','.join('?' * len(match_ids))
        rows = conn.execute(
            f'SELECT match_id, winning_team, event_team_a_ingame_side FROM matches WHERE match_id IN ({placeholders})',
            tuple(match_ids),
        ).fetchall()
    finally:
        conn.close()
    for mid, winning_team, side in rows:
        if winning_team is None or side is None:
            continue
        results[int(mid)] = 'team_a' if int(winning_team) == int(side) else 'team_b'
    return results


def _computed(event: Dict[str, Any]) -> Dict[str, Any]:
    results = _results_for(bk.match_ids(event))
    out = bk.compute(event, results)
    ingested = set(results)
    for s in out.get('series') or []:
        for g in s.get('games') or []:
            try:
                g['ingested'] = int(g.get('match_id')) in ingested
            except (TypeError, ValueError):
                g['ingested'] = False
    return out


def _known_roster(conn: sqlite3.Connection, team: str) -> Set[int]:
    """Account IDs that have played for ``team`` in earlier event matches."""
    if not team:
        return set()
    rows = conn.execute(
        '''
        SELECT DISTINCT p.account_id
        FROM players p
        JOIN matches m ON m.match_id = p.match_id
        WHERE m.event_team_a_ingame_side IS NOT NULL AND p.account_id IS NOT NULL AND (
          (LOWER(m.event_team_a) = LOWER(?) AND p.team = m.event_team_a_ingame_side)
          OR (LOWER(m.event_team_b) = LOWER(?) AND p.team = 1 - m.event_team_a_ingame_side)
        )
        ''',
        (team, team),
    ).fetchall()
    return {int(r[0]) for r in rows}


def _check_match(conn: sqlite3.Connection, match_id: int, team_a: str, team_b: str) -> Dict[str, Any]:
    """Fetch one match and work out which side each team was on from known rosters."""
    mi = fetch_match_metadata(match_id)
    players = mi.get('players') or []
    roster_a = _known_roster(conn, team_a)
    roster_b = _known_roster(conn, team_b)

    # counts[side][team]: how many known players of each team were on that side
    counts = {0: {'team_a': 0, 'team_b': 0}, 1: {'team_a': 0, 'team_b': 0}}
    for p in players:
        side = team_from_slot(p.get('player_slot'))
        try:
            aid = int(p.get('account_id'))
        except (TypeError, ValueError):
            continue
        if side not in (0, 1):
            continue
        if aid in roster_a:
            counts[side]['team_a'] += 1
        if aid in roster_b:
            counts[side]['team_b'] += 1

    # Team A on Amber if that arrangement matches more known players than the swap.
    straight = counts[0]['team_a'] + counts[1]['team_b']
    swapped = counts[1]['team_a'] + counts[0]['team_b']
    team_a_side: Optional[int] = None
    if straight != swapped and max(straight, swapped) >= 2:
        team_a_side = 0 if straight > swapped else 1

    winning_team = mi.get('winning_team')
    winner: Optional[str] = None
    if team_a_side is not None and winning_team in (0, 1):
        winner = 'team_a' if int(winning_team) == team_a_side else 'team_b'

    start_iso = parse_time_to_iso(mi.get('start_time') or mi.get('started_at') or mi.get('start'))
    return {
        'match_id': match_id,
        'start_time': start_iso,
        'duration_s': mi.get('duration_s'),
        'winning_team': winning_team,
        'player_count': len(players),
        'known': {
            'team_a': counts[0]['team_a'] + counts[1]['team_a'],
            'team_b': counts[0]['team_b'] + counts[1]['team_b'],
            'roster_a': len(roster_a),
            'roster_b': len(roster_b),
        },
        'team_a_side': team_a_side,
        'winner': winner,
    }


def _remove_match(conn: sqlite3.Connection, match_id: int) -> List[int]:
    """Delete one match (child rows cascade) and return the affected account IDs."""
    rows = conn.execute('SELECT DISTINCT account_id FROM players WHERE match_id = ?', (match_id,)).fetchall()
    conn.execute('DELETE FROM matches WHERE match_id = ?', (match_id,))
    return [int(r[0]) for r in rows if r[0] is not None]


def _remove_from_matches_json(matches_path: Path, match_ids: Set[int]) -> None:
    with admin_mod._matches_json_lock:
        data = admin_mod._load_matches_json(matches_path)
        def hit(m: Dict[str, Any]) -> bool:
            return isinstance(m.get('match_id'), int) and m['match_id'] in match_ids

        for series in data.get('series') or []:
            for week in series.get('weeks') or []:
                kept = []
                for game in week.get('games') or []:
                    if 'matches' in game:
                        before = len(game['matches'])
                        game['matches'] = [m for m in game['matches'] if not hit(m)]
                        if before and not game['matches']:
                            continue  # the set only held removed IDs
                    elif hit(game):
                        continue
                    kept.append(game)
                week['games'] = kept
        admin_mod._write_matches_json(matches_path, data)


def _run_series_job(job_id: str, event: Dict[str, Any], series: Dict[str, Any], removed: Set[int], app_obj: Any) -> None:
    """Drop replaced IDs, work out each game's sides, then ingest via MatchAdmin's job."""
    try:
        with app_obj.app_context():
            admin_mod._set_job(job_id, status='running', message='Checking games')
            db_path = Path(current_app.config.get('DB_PATH', './data/dlns.sqlite3'))

            conn = db_connect(db_path)
            try:
                db_init(conn)
                if removed:
                    affected: List[int] = []
                    for mid in removed:
                        affected.extend(_remove_match(conn, mid))
                    if affected:
                        recompute_user_stats_bulk(conn, sorted(set(affected)))
                    conn.commit()

                outcome = series.get('outcome') or {}
                matches_payload = []
                for idx, game in enumerate(series.get('games') or [], start=1):
                    try:
                        mid = int(game.get('match_id'))
                    except (TypeError, ValueError):
                        continue
                    if mid <= 0:
                        continue
                    if outcome.get('type') == 'dq' and (
                        outcome.get('played_games') == 'void' or idx > int(outcome.get('after_game') or 0)
                    ):
                        continue
                    try:
                        check = _check_match(conn, mid, series['team_a'], series['team_b'])
                    except SkipMatchSilent:
                        raise ValueError(f'Match {mid} is not indexed by the API yet.')
                    side = game.get('team_a_side')
                    if side not in (0, 1):
                        side = check['team_a_side']
                    if side not in (0, 1):
                        raise ValueError(
                            f"Game {idx} ({mid}): couldn't tell which side {series['team_a']} played on. "
                            'Pick it in the game row and save again.'
                        )
                    # MatchAdmin's job wants the winner as a team; convert from the side.
                    wt = check['winning_team']
                    winner_hint = ('team_a' if int(wt) == int(side) else 'team_b') if wt in (0, 1) else None
                    matches_payload.append({
                        'match_id': mid,
                        'winner': winner_hint,
                        'game': f'Game {idx}',
                        'skip': False,
                        'forfeit': False,
                    })
            finally:
                conn.close()

            if removed:
                _remove_from_matches_json(db_path.parent / 'matches.json', removed)

            if not matches_payload:
                admin_mod._set_job(job_id, status='done', message='Saved. No games to ingest.')
                return

            round_name = next(
                (r.get('name') for r in event.get('rounds') or [] if r.get('round') == series.get('round')),
                '',
            )
            payload = {
                'title': event.get('title') or 'Night Shift',
                'week': event.get('week'),
                'vod_links': [],
                'sets': [{
                    'set_title': round_name,
                    'team_a': series['team_a'],
                    'team_b': series['team_b'],
                    'vod_link': series.get('vod') or '',
                    'region': event.get('region') or '',
                    'matches': matches_payload,
                }],
            }
        admin_mod._run_bulk_submit_job(job_id, payload, app_obj)
    except Exception as e:
        app_obj.logger.exception('Bracket series save failed')
        admin_mod._set_job(job_id, status='error', message=str(e))


@brackets_bp.route('/')
@require_admin
def brackets_page():
    return render_template('react.html', page='bracket_admin')


@brackets_bp.route('/api/events')
@require_admin
def list_events():
    with _brackets_lock:
        data = _load()
    events = [
        {k: e.get(k) for k in ('id', 'title', 'week', 'region', 'format', 'created_at')}
        | {'series_count': len(e.get('series') or [])}
        for e in data['events']
    ]
    events.sort(key=lambda e: e.get('created_at') or 0, reverse=True)
    return jsonify({'ok': True, 'events': events})


@brackets_bp.route('/api/events', methods=['POST'])
@require_admin
def create_event():
    payload = request.get_json(silent=True) or {}
    title = (payload.get('title') or '').strip()
    if not title:
        return jsonify({'ok': False, 'error': 'Event title is required.'}), 400
    week = payload.get('week')
    try:
        week = int(week) if week not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'Week must be a number.'}), 400

    try:
        structure = bk.generate(
            payload.get('format') or '',
            payload.get('teams') or [],
            payload.get('round_names') or [],
            payload.get('best_of') or [1],
        )
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

    region = (payload.get('region') or '').strip()
    base_id = _slug('-'.join(str(p) for p in (title, f'w{week}' if week is not None else '', region) if p))
    with _brackets_lock:
        data = _load()
        event_id, n = base_id, 2
        while _find_event(data, event_id):
            event_id, n = f'{base_id}-{n}', n + 1
        event = {
            'id': event_id,
            'title': title,
            'week': week,
            'region': region,
            'created_at': int(time.time()),
            **structure,
        }
        data['events'].append(event)
        _save(data)
    return jsonify({'ok': True, 'event': _computed(event)})


@brackets_bp.route('/api/events/<event_id>')
@require_admin
def get_event(event_id: str):
    with _brackets_lock:
        event = _find_event(_load(), event_id)
    if not event:
        return jsonify({'ok': False, 'error': 'Event not found.'}), 404
    return jsonify({'ok': True, 'event': _computed(event)})


@brackets_bp.route('/api/events/<event_id>', methods=['DELETE'])
@require_admin
def delete_event(event_id: str):
    """Removes the bracket only. Ingested games stay in stats and matches.json."""
    with _brackets_lock:
        data = _load()
        before = len(data['events'])
        data['events'] = [e for e in data['events'] if e.get('id') != event_id]
        if len(data['events']) == before:
            return jsonify({'ok': False, 'error': 'Event not found.'}), 404
        _save(data)
    return jsonify({'ok': True})


@brackets_bp.route('/api/check', methods=['POST'])
@require_admin
def check_match():
    payload = request.get_json(silent=True) or {}
    try:
        match_id = int(payload.get('match_id'))
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'Match ID must be a number.'}), 400
    conn = db_connect(_db_path())
    try:
        db_init(conn)
        result = _check_match(conn, match_id, (payload.get('team_a') or '').strip(), (payload.get('team_b') or '').strip())
    except SkipMatchSilent:
        return jsonify({'ok': False, 'error': f'Match {match_id} is not indexed by the API yet.'}), 404
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502
    finally:
        conn.close()
    return jsonify({'ok': True, 'check': result})


def _clean_games(raw: Any) -> List[Dict[str, Any]]:
    games: List[Dict[str, Any]] = []
    for g in raw or []:
        if not isinstance(g, dict):
            continue
        entry: Dict[str, Any] = {'game': len(games) + 1}
        mid = g.get('match_id')
        if mid not in (None, ''):
            try:
                entry['match_id'] = int(mid)
            except (TypeError, ValueError):
                raise ValueError(f'Game {len(games) + 1}: match ID must be a number.')
        else:
            entry['match_id'] = None
        if g.get('forfeit'):
            entry['forfeit'] = True
            if g.get('winner') not in bk.SLOTS:
                raise ValueError(f'Game {len(games) + 1}: pick who won the forfeit.')
            entry['winner'] = g['winner']
        elif entry['match_id'] is None:
            continue  # empty row
        if g.get('team_a_side') in (0, 1):
            entry['team_a_side'] = int(g['team_a_side'])
        vod = (g.get('vod') or '').strip()
        if vod:
            entry['vod'] = vod
        games.append(entry)
    return games


def _clean_outcome(raw: Any, game_count: int) -> Optional[Dict[str, Any]]:
    if not isinstance(raw, dict) or raw.get('type') != 'dq':
        return None
    team = raw.get('team')
    if team not in bk.SLOTS:
        raise ValueError('Pick which team is disqualified.')
    try:
        after = int(raw.get('after_game') or 0)
    except (TypeError, ValueError):
        after = 0
    after = max(0, min(after, game_count))
    return {
        'type': 'dq',
        'team': team,
        'after_game': after,
        'reason': (raw.get('reason') or '').strip(),
        'played_games': 'void' if raw.get('played_games') == 'void' else 'keep',
    }


@brackets_bp.route('/api/events/<event_id>/series/<series_id>', methods=['PUT'])
@require_admin
def save_series(event_id: str, series_id: str):
    payload = request.get_json(silent=True) or {}
    try:
        games = _clean_games(payload.get('games'))
        outcome = _clean_outcome(payload.get('outcome'), len(games))
    except ValueError as e:
        return jsonify({'ok': False, 'error': str(e)}), 400

    with _brackets_lock:
        data = _load()
        event = _find_event(data, event_id)
        if not event:
            return jsonify({'ok': False, 'error': 'Event not found.'}), 404
        series = next((s for s in event.get('series') or [] if s.get('id') == series_id), None)
        if not series:
            return jsonify({'ok': False, 'error': 'Series not found.'}), 404

        old_ids = {g['match_id'] for g in series.get('games') or [] if isinstance(g.get('match_id'), int) and g['match_id'] > 0}
        for slot in bk.SLOTS:
            if slot in payload:
                series[slot] = (payload.get(slot) or '').strip() or None
        series['vod'] = (payload.get('vod') or '').strip()
        series['games'] = games
        series['outcome'] = outcome
        new_ids = {g['match_id'] for g in games if isinstance(g.get('match_id'), int) and g['match_id'] > 0}
        # Games voided or played after a DQ are kept in the bracket but not in stats.
        kept_ids = {
            g['match_id'] for i, g in enumerate(games, start=1)
            if g.get('match_id') in new_ids and not (
                outcome and (outcome['played_games'] == 'void' or i > outcome['after_game'])
            )
        }

        # Teams fed from earlier series are only known after computing the bracket.
        resolved = next(s for s in _computed(event)['series'] if s['id'] == series_id)
        if new_ids and not (resolved.get('team_a') and resolved.get('team_b')):
            return jsonify({'ok': False, 'error': 'Both teams must be decided before adding games.'}), 400
        _save(data)

    job_id = str(uuid.uuid4())
    admin_mod._set_job(job_id, status='queued', message='Queued')
    job_series = dict(series, team_a=resolved.get('team_a'), team_b=resolved.get('team_b'))
    threading.Thread(
        target=_run_series_job,
        args=(job_id, event, job_series, old_ids - kept_ids, current_app._get_current_object()),
        daemon=True,
    ).start()
    return jsonify({'ok': True, 'job_id': job_id})
