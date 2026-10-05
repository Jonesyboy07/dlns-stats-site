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
from typing import Any, Dict, List, Optional, Set, Tuple

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


def _ingested(match_ids: List[int]) -> Dict[int, Dict[str, Any]]:
    """Ingested matches from the DB: {match_id: {result, duration_s, start_time}}.

    ``result`` is the winning slot (team_a / team_b), or None if sides are unknown.
    """
    if not match_ids:
        return {}
    conn = db_connect(_db_path())
    try:
        db_init(conn)
        placeholders = ','.join('?' * len(match_ids))
        rows = conn.execute(
            f'SELECT match_id, winning_team, event_team_a_ingame_side, duration_s, start_time '
            f'FROM matches WHERE match_id IN ({placeholders})',
            tuple(match_ids),
        ).fetchall()
    finally:
        conn.close()
    found: Dict[int, Dict[str, Any]] = {}
    for mid, winning_team, side, duration_s, start_time in rows:
        result = None
        if winning_team is not None and side is not None:
            result = 'team_a' if int(winning_team) == int(side) else 'team_b'
        found[int(mid)] = {'result': result, 'duration_s': duration_s, 'start_time': start_time}
    return found


def _computed(event: Dict[str, Any]) -> Dict[str, Any]:
    found = _ingested(bk.match_ids(event))
    out = bk.compute(event, {mid: m['result'] for mid, m in found.items() if m['result']})
    out['ban_pattern'] = bk.ban_pattern(event)
    for s in out.get('series') or []:
        for g in s.get('games') or []:
            row = found.get(bk.stats_id(g))
            g['ingested'] = row is not None
            if row:
                g.update({k: v for k, v in row.items() if v is not None})
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
    """Fetch one match and guess which side each team was on from known rosters.

    Only used to pre-fill the winner pick in the editor; saving never depends on it.
    """
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


def _remove_from_matches_json(matches_path: Path, match_ids: Set[int],
                              keep: Optional[Tuple[str, Any]] = None) -> None:
    """Remove these IDs from matches.json, except inside the ``keep`` (series title, week)."""
    with admin_mod._matches_json_lock:
        data = admin_mod._load_matches_json(matches_path)
        def hit(m: Dict[str, Any]) -> bool:
            return isinstance(m.get('match_id'), int) and m['match_id'] in match_ids

        for series in data.get('series') or []:
            emptied = []
            for week in series.get('weeks') or []:
                if keep is not None and (series.get('title'), week.get('week')) == keep:
                    continue
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
                if week.get('games') and not kept:
                    emptied.append(id(week))  # every set here was removed: drop the week too
                week['games'] = kept
            series['weeks'] = [w for w in series.get('weeks') or [] if id(w) not in emptied]
        admin_mod._write_matches_json(matches_path, data)


def _write_bans(db_path: Path, series: Dict[str, Any], games: List[Tuple[int, List[Dict[str, Any]]]]) -> int:
    """Replace the match_bans rows of each (stats ID, bans) pair; return games skipped.

    A game is skipped when it has no row in matches (an N/A game saved under a real,
    unfetchable ID has none), since bans hang off that row.
    """
    skipped = 0
    conn = db_connect(db_path)
    try:
        db_init(conn)
        for mid, bans in games:
            conn.execute('DELETE FROM match_bans WHERE match_id = ?', (mid,))
            if not bans:
                continue
            if not conn.execute('SELECT 1 FROM matches WHERE match_id = ?', (mid,)).fetchone():
                skipped += 1
                continue
            conn.executemany(
                'INSERT INTO match_bans(match_id, ban_order, team, team_name, hero_id) VALUES (?, ?, ?, ?, ?)',
                [(mid, b['order'], b['team'], series.get(b['team']), b['hero_id']) for b in bans],
            )
        conn.commit()
    finally:
        conn.close()
    return skipped


def _series_set(event: Dict[str, Any], series: Dict[str, Any]) -> Tuple[Optional[Dict[str, Any]], List[Tuple[int, List[Dict[str, Any]]]]]:
    """The MatchAdmin bulk-submit set for one series, plus its (stats ID, bans) pairs.

    Games voided or played after a DQ are left out. Fetched games: the job reads the
    API's winning_team and uses the pick to place team A's side. Forfeits and N/A
    games: the job records a placeholder under the stats ID with the pick as result.
    """
    outcome = series.get('outcome') or {}
    matches_payload = []
    ban_rows: List[Tuple[int, List[Dict[str, Any]]]] = []
    for idx, game in enumerate(series.get('games') or [], start=1):
        mid = bk.stats_id(game)
        if mid is None:
            continue
        if outcome.get('type') == 'dq' and (
            outcome.get('played_games') == 'void' or idx > int(outcome.get('after_game') or 0)
        ):
            continue
        ban_rows.append((mid, game.get('bans') or []))
        matches_payload.append({
            'match_id': mid,
            'winner': game.get('winner'),
            'game': f'Game {idx}',
            'skip': bool(game.get('unavailable')),
            'forfeit': bool(game.get('forfeit')),
        })
    if not matches_payload:
        return None, []
    round_name = next(
        (r.get('name') for r in event.get('rounds') or [] if r.get('round') == series.get('round')),
        '',
    )
    return {
        'set_title': round_name,
        'team_a': series['team_a'],
        'team_b': series['team_b'],
        'vod_link': series.get('vod') or '',
        'region': event.get('region') or '',
        'matches': matches_payload,
    }, ban_rows


def _run_ingest_job(job_id: str, event: Dict[str, Any], series_list: List[Dict[str, Any]], removed: Set[int],
                    app_obj: Any, relocate: bool = False) -> None:
    """Drop replaced IDs, ingest the series' games via MatchAdmin's job, then write bans.

    ``series_list`` holds series with their teams already resolved. With ``relocate``
    (the event's title or week changed), copies of these games left under any other
    title/week in matches.json are removed once the new ones are in.
    """
    try:
        with app_obj.app_context():
            admin_mod._set_job(job_id, status='running', message='Saving games')
            db_path = Path(current_app.config.get('DB_PATH', './data/dlns.sqlite3'))

            if removed:
                conn = db_connect(db_path)
                try:
                    db_init(conn)
                    affected: List[int] = []
                    for mid in removed:
                        affected.extend(_remove_match(conn, mid))
                    if affected:
                        recompute_user_stats_bulk(conn, sorted(set(affected)))
                    conn.commit()
                finally:
                    conn.close()
                _remove_from_matches_json(db_path.parent / 'matches.json', removed)

            sets, bans_by_series = [], []
            for series in series_list:
                set_obj, ban_rows = _series_set(event, series)
                if set_obj:
                    sets.append(set_obj)
                    bans_by_series.append((series, ban_rows))

            if not sets:
                admin_mod._set_job(job_id, status='done', message='Saved. No games to ingest.')
                return
            payload = {
                'title': event.get('title') or 'Night Shift',
                'week': event.get('week'),
                'vod_links': [],
                'sets': sets,
            }
        admin_mod._run_bulk_submit_job(job_id, payload, app_obj)

        with admin_mod._jobs_lock:
            job = dict(admin_mod._jobs.get(job_id) or {})
        if job.get('status') != 'done':
            return  # games failed: leave bans and old copies untouched
        note = ''
        if relocate:
            ids = {mid for _, rows in bans_by_series for mid, _ in rows}
            _remove_from_matches_json(db_path.parent / 'matches.json', ids,
                                      keep=(payload['title'], payload['week']))
            note += ' Moved to the new title/week in matches.json.'
        # Bans hang off the match rows, so they go in only after the games did.
        banned = skipped = 0
        for series, ban_rows in bans_by_series:
            missed = _write_bans(db_path, series, ban_rows)
            skipped += missed
            banned += sum(1 for _, bans in ban_rows if bans) - missed
        if banned:
            note += f' Bans saved for {banned} game(s).'
        if skipped:
            note += f' {skipped} game(s) had no match row, so their bans are only in the bracket.'
        if note:
            admin_mod._set_job(job_id, message=(job.get('message') or 'Done') + note)
    except Exception as e:
        app_obj.logger.exception('Bracket save failed')
        admin_mod._set_job(job_id, status='error', message=str(e))


def _start_job(event: Dict[str, Any], series_list: List[Dict[str, Any]], removed: Set[int], relocate: bool = False) -> str:
    job_id = str(uuid.uuid4())
    admin_mod._set_job(job_id, status='queued', message='Queued')
    threading.Thread(
        target=_run_ingest_job,
        args=(job_id, event, series_list, removed, current_app._get_current_object(), relocate),
        daemon=True,
    ).start()
    return job_id


def _mark_edited(event: Dict[str, Any]) -> None:
    """An event changed in the editor is no longer replaced by re-running the migration."""
    event.pop('source', None)
    event['edited_at'] = int(time.time())


@brackets_bp.route('/')
@require_admin
def brackets_page():
    return render_template('react.html', page='bracket_admin')


@brackets_bp.route('/view')
@require_admin
def brackets_view_page():
    return render_template('react.html', page='bracket_view')


@brackets_bp.route('/api/events')
@require_admin
def list_events():
    with _brackets_lock:
        data = _load()
    events = [
        {k: e.get(k) for k in ('id', 'title', 'week', 'region', 'format', 'created_at')}
        | {'ban_pattern': bk.ban_pattern(e)}
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
    pattern = str(payload.get('ban_pattern') or '').upper()
    if pattern and pattern not in bk.BAN_PATTERNS:
        return jsonify({'ok': False, 'error': f"Ban order must be one of {', '.join(bk.BAN_PATTERNS)}."}), 400
    base_id = _slug('-'.join(str(p) for p in (title, f'w{week}' if week is not None else '', region) if p))
    with _brackets_lock:
        data = _load()
        event_id, n = base_id, 2
        while _find_event(data, event_id):
            event_id, n = f'{base_id}-{n}', n + 1
        if not pattern:
            # Carry the latest event's ban order forward, so a mid-season change sticks.
            # Ties (same second, or a migration batch) go to the one added last.
            latest = max(enumerate(data['events']), key=lambda ie: (ie[1].get('created_at') or 0, ie[0]), default=(0, None))[1]
            pattern = bk.ban_pattern(latest) if latest else bk.DEFAULT_BAN_PATTERN
        event = {
            'id': event_id,
            'title': title,
            'week': week,
            'region': region,
            'ban_pattern': pattern,
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
        return jsonify({
            'ok': False,
            'error': f"Match {match_id} can't be fetched from the API. If the lobby was private, mark the game N/A and pick the winner.",
        }), 404
    except Exception as e:
        return jsonify({'ok': False, 'error': str(e)}), 502
    finally:
        conn.close()
    return jsonify({'ok': True, 'check': result})


def _new_placeholder_id(used: Set[int]) -> int:
    """A negative ID for a forfeit or N/A game, in the same style MatchAdmin uses."""
    pid = -(int(time.time() * 1000) % (10 ** 12))
    while pid in used or pid == 0:
        pid -= 1
    return pid


MAX_BANS_PER_TEAM = 2
BAN_SLOTS = 4


def _clean_bans(raw: Any, game_no: int) -> List[Dict[str, Any]]:
    """Ban draft for one game, in ban order: [{order, team, hero_id}].

    Bans happen outside the game (a third-party tool), so they're entered by hand.
    ``order`` is the ban slot (1-4), so a skipped slot keeps the later bans in place.
    Each team bans up to two heroes and a hero can only be banned once.
    """
    bans: List[Dict[str, Any]] = []
    for pos, b in enumerate(raw or [], start=1):
        if not isinstance(b, dict) or b.get('hero_id') in (None, ''):
            continue  # empty slot
        try:
            order = int(b.get('order') or pos)
        except (TypeError, ValueError):
            order = pos
        if not 1 <= order <= BAN_SLOTS:
            raise ValueError(f'Game {game_no}: ban order must be 1 to {BAN_SLOTS}.')
        if b.get('team') not in bk.SLOTS:
            raise ValueError(f'Game {game_no}, ban {order}: pick which team banned.')
        try:
            hero_id = int(b['hero_id'])
        except (TypeError, ValueError):
            raise ValueError(f'Game {game_no}, ban {order}: unknown hero.')
        bans.append({'order': order, 'team': b['team'], 'hero_id': hero_id})
    bans.sort(key=lambda b: b['order'])
    if len({b['order'] for b in bans}) != len(bans):
        raise ValueError(f'Game {game_no}: two bans share the same slot.')
    for slot in bk.SLOTS:
        if sum(1 for b in bans if b['team'] == slot) > MAX_BANS_PER_TEAM:
            raise ValueError(f'Game {game_no}: each team can ban at most {MAX_BANS_PER_TEAM} heroes.')
    heroes = [b['hero_id'] for b in bans]
    if len(set(heroes)) != len(heroes):
        raise ValueError(f'Game {game_no}: the same hero is banned twice.')
    return bans


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
            entry['match_id'] = None  # a forfeit was never played
        elif g.get('unavailable'):
            entry['unavailable'] = True  # the real ID, if known, stays for reference
        elif entry['match_id'] is None:
            continue  # empty row
        if bk.is_placeholder(entry):
            try:
                entry['placeholder_id'] = int(g['placeholder_id'])
            except (KeyError, TypeError, ValueError):
                pass  # assigned on save
        if g.get('winner') not in bk.SLOTS:
            raise ValueError(f'Game {len(games) + 1}: pick who won.')
        entry['winner'] = g['winner']
        bans = _clean_bans(g.get('bans'), len(games) + 1)
        if bans:
            entry['bans'] = bans
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

        old_ids = {bk.stats_id(g) for g in series.get('games') or []} - {None}
        for slot in bk.SLOTS:
            if slot in payload:
                series[slot] = (payload.get(slot) or '').strip() or None
        series['vod'] = (payload.get('vod') or '').strip()
        # Forfeits and N/A games without a placeholder yet get a fresh negative ID, kept
        # in the bracket so later saves update the same placeholder instead of adding one.
        used = set(bk.match_ids(event))
        for g in games:
            if bk.is_placeholder(g) and 'placeholder_id' not in g:
                g['placeholder_id'] = _new_placeholder_id(used)
                used.add(g['placeholder_id'])
        series['games'] = games
        series['outcome'] = outcome
        _mark_edited(event)
        new_ids = {bk.stats_id(g) for g in games} - {None}
        # Games voided or played after a DQ are kept in the bracket but not in stats.
        kept_ids = {
            bk.stats_id(g) for i, g in enumerate(games, start=1)
            if bk.stats_id(g) is not None and not (
                outcome and (outcome['played_games'] == 'void' or i > outcome['after_game'])
            )
        }

        # Teams fed from earlier series are only known after computing the bracket.
        resolved = next(s for s in _computed(event)['series'] if s['id'] == series_id)
        if new_ids and not (resolved.get('team_a') and resolved.get('team_b')):
            return jsonify({'ok': False, 'error': 'Both teams must be decided before adding games.'}), 400
        _save(data)

    job_series = dict(series, team_a=resolved.get('team_a'), team_b=resolved.get('team_b'))
    return jsonify({'ok': True, 'job_id': _start_job(event, [job_series], old_ids - kept_ids)})


@brackets_bp.route('/api/events/<event_id>', methods=['PUT'])
@require_admin
def edit_event(event_id: str):
    """Edit an event's details, round names/best-ofs and seeded teams, then re-ingest it.

    Every series with games is re-ingested so the DB and matches.json pick up new team
    names, round titles, region, title and week. Teams fed from an earlier round
    aren't stored, so they can't be set here.
    """
    payload = request.get_json(silent=True) or {}
    title = (payload.get('title') or '').strip()
    if not title:
        return jsonify({'ok': False, 'error': 'Event title is required.'}), 400
    week = payload.get('week')
    try:
        week = int(week) if week not in (None, '') else None
    except (TypeError, ValueError):
        return jsonify({'ok': False, 'error': 'Week must be a number.'}), 400

    with _brackets_lock:
        data = _load()
        event = _find_event(data, event_id)
        if not event:
            return jsonify({'ok': False, 'error': 'Event not found.'}), 404
        relocate = (event.get('title'), event.get('week')) != (title, week)
        event['title'], event['week'] = title, week
        event['region'] = (payload.get('region') or '').strip()
        if 'ban_pattern' in payload:
            pattern = str(payload.get('ban_pattern') or '').upper()
            if pattern not in bk.BAN_PATTERNS:
                return jsonify({'ok': False, 'error': f"Ban order must be one of {', '.join(bk.BAN_PATTERNS)}."}), 400
            event['ban_pattern'] = pattern

        for r in payload.get('rounds') or []:
            stored = next((x for x in event.get('rounds') or [] if x.get('round') == r.get('round')), None)
            if stored is None:
                continue
            name = (r.get('name') or '').strip()
            if not name:
                return jsonify({'ok': False, 'error': f"Round {r.get('round')} needs a name."}), 400
            try:
                best_of = int(r.get('best_of') or 1)
            except (TypeError, ValueError):
                return jsonify({'ok': False, 'error': f'Round {name}: best-of must be a number.'}), 400
            if best_of < 1 or best_of % 2 == 0:
                return jsonify({'ok': False, 'error': f'Round {name}: best-of must be odd (1, 3, 5...).'}), 400
            stored['name'], stored['best_of'] = name, best_of

        teams = payload.get('teams') or {}
        for series in event.get('series') or []:
            for slot in bk.SLOTS:
                if slot in (teams.get(series['id']) or {}):
                    series[slot] = (teams[series['id']][slot] or '').strip() or None

        _mark_edited(event)
        computed = _computed(event)
        _save(data)

    series_list = [
        s for s in computed['series']
        if s.get('team_a') and s.get('team_b') and any(bk.stats_id(g) is not None for g in s.get('games') or [])
    ]
    job_id = _start_job(event, series_list, set(), relocate=relocate) if series_list else None
    return jsonify({'ok': True, 'event': computed, 'job_id': job_id})


@brackets_bp.route('/api/events/<event_id>/rounds', methods=['POST'])
@require_admin
def add_round(event_id: str):
    """Add an opening round to a gauntlet. Nothing is played in it yet, so no ingest."""
    payload = request.get_json(silent=True) or {}
    with _brackets_lock:
        data = _load()
        event = _find_event(data, event_id)
        if not event:
            return jsonify({'ok': False, 'error': 'Event not found.'}), 404
        try:
            updated = bk.add_first_round(event, payload.get('name'), payload.get('best_of') or 1,
                                         payload.get('team_a'), payload.get('team_b'))
        except ValueError as e:
            return jsonify({'ok': False, 'error': str(e)}), 400
        _mark_edited(updated)
        data['events'] = [updated if e.get('id') == event_id else e for e in data['events']]
        _save(data)
    return jsonify({'ok': True, 'event': _computed(updated)})


@brackets_bp.route('/api/events/<event_id>/rounds/first', methods=['DELETE'])
@require_admin
def remove_round(event_id: str):
    with _brackets_lock:
        data = _load()
        event = _find_event(data, event_id)
        if not event:
            return jsonify({'ok': False, 'error': 'Event not found.'}), 404
        try:
            updated = bk.remove_first_round(event)
        except ValueError as e:
            return jsonify({'ok': False, 'error': str(e)}), 400
        _mark_edited(updated)
        data['events'] = [updated if e.get('id') == event_id else e for e in data['events']]
        _save(data)
    return jsonify({'ok': True, 'event': _computed(updated)})
