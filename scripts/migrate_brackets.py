"""Build bracket events (brackets.json) from the weeks already in matches.json.

Each week + region of a series becomes one gauntlet event. The rounds are
worked out from the results, not from file order: a set's winner must appear in
the next round's set, and titles (Qualifiers / Challenger / Finals) must agree.
Untitled sets next to titled ones are the Finals. Games keep their match IDs and
get the winner from the database as their pick.

Only brackets.json is ever written. matches.json is read as-is and the database
is opened read-only, so stats are never touched.

    python scripts/migrate_brackets.py                    # dry run on data/sandbox: report only
    python scripts/migrate_brackets.py --week 58          # dry run, one week in full detail
    python scripts/migrate_brackets.py --write            # write data/sandbox/brackets.json
    python scripts/migrate_brackets.py --target data --write   # write the real data/brackets.json

Re-running replaces the events it made before (marked "source": "matches.json")
and keeps events created in the bracket editor. The previous brackets.json is
backed up next to it before every write.
"""

from __future__ import annotations

import argparse
import collections
import itertools
import json
import re
import shutil
import sqlite3
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

ROOT = Path(__file__).resolve().parents[1]
SOURCE = 'matches.json'

# Round kinds in ladder order, with the best-of each normally uses.
ROUND_NAMES = {0: 'Qualifiers', 1: 'Challenger', 2: 'Finals'}
DEFAULT_BO = {0: 3, 1: 1, 2: 3}


def norm(name: Any) -> str:
    return str(name or '').strip().upper()


def slug(text: str) -> str:
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-') or 'event'


def title_kind(title: Any) -> Optional[int]:
    t = norm(title)
    if 'QUALIF' in t:
        return 0
    if 'CHALLENGER' in t:
        return 1
    if 'FINAL' in t:
        return 2
    return None


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------

def load_results(db_path: Path) -> Dict[int, int]:
    """{match_id: winning in-game side}, read with a read-only connection."""
    uri = f'file:{db_path.resolve().as_posix()}?mode=ro'
    conn = sqlite3.connect(uri, uri=True)
    try:
        rows = conn.execute('SELECT match_id, winning_team FROM matches WHERE winning_team IS NOT NULL').fetchall()
    finally:
        conn.close()
    return {int(mid): int(wt) for mid, wt in rows}


def load_empty_ids(db_path: Path) -> Set[int]:
    """Real match IDs that are in the DB without any players: imported while the API
    couldn't return the match (e.g. a private lobby), so only the result is known."""
    uri = f'file:{db_path.resolve().as_posix()}?mode=ro'
    conn = sqlite3.connect(uri, uri=True)
    try:
        rows = conn.execute(
            'SELECT m.match_id FROM matches m WHERE m.match_id > 0 '
            'AND NOT EXISTS (SELECT 1 FROM players p WHERE p.match_id = m.match_id)'
        ).fetchall()
    finally:
        conn.close()
    return {int(r[0]) for r in rows}


def game_winner(match: Dict[str, Any], results: Dict[int, int]) -> Optional[str]:
    """Winning slot of one game: a winner fix, else the DB result and the set's stored side."""
    if match.get('_winner_slot'):
        return match['_winner_slot']
    mid = match.get('match_id')
    side = match.get('team_a_side')
    if not isinstance(mid, int) or mid not in results or side not in (0, 1):
        return None
    return 'team_a' if results[mid] == side else 'team_b'


def game_order(s: Dict[str, Any]) -> List[Dict[str, Any]]:
    """A set's games sorted by their "Game N" label; file order breaks ties."""
    def key(item: Tuple[int, Dict[str, Any]]) -> Tuple[int, int]:
        found = re.search(r'\d+', str(item[1].get('game') or ''))
        return (int(found.group()) if found else item[0] + 1, item[0])
    return [m for _, m in sorted(enumerate(s.get('matches') or []), key=key)]


def set_winner(s: Dict[str, Any], results: Dict[int, int]) -> Tuple[Optional[str], int, int]:
    """(winning slot or None, team_a wins, team_b wins) for one set."""
    wins = collections.Counter(game_winner(m, results) for m in s.get('matches') or [])
    a, b = wins['team_a'], wins['team_b']
    if s.get('_dq'):
        # A disqualified team loses the set whatever the score, so the other team moves on.
        return ('team_b' if s['_dq']['team'] == 'team_a' else 'team_a'), a, b
    return ('team_a' if a > b else 'team_b' if b > a else None), a, b


# ---------------------------------------------------------------------------
# Fixes (scripts/migrate_fixes.json)
# ---------------------------------------------------------------------------

def teams_key(teams: Any) -> frozenset:
    return frozenset(norm(t) for t in teams or [])


def slot_of(s: Dict[str, Any], team: Any) -> Optional[str]:
    if norm(team) == norm(s.get('team_a')):
        return 'team_a'
    if norm(team) == norm(s.get('team_b')):
        return 'team_b'
    return None


def describe_fix(fix: Dict[str, Any]) -> str:
    where = f"week {fix.get('week')}" + (f" {fix['region']}" if fix.get('region') else '')
    teams = ' vs '.join(fix.get('teams') or [])
    kind = fix.get('type')
    if kind == 'region':
        return f"{where}: move {teams} to {fix.get('to')}"
    if kind == 'dq':
        return f"{where}: {fix.get('team')} disqualified in {teams} after game {fix.get('after_game', 0)}"
    if kind == 'winner':
        return f"match {fix.get('match_id')}: {fix.get('winner')} won"
    if kind == 'order':
        return f"{where}: order " + ' -> '.join(' vs '.join(p) for p in fix.get('sets') or [])
    return json.dumps(fix)


def apply_fixes(data: Dict[str, Any], series_title: str, fixes: List[Dict[str, Any]]
                ) -> Tuple[Dict[str, Any], Dict[Tuple[Any, str], List[frozenset]], List[Tuple[str, str]]]:
    """Return a fixed copy of matches.json, order fixes by (week, region), and a status per fix.

    Fixes only change this in-memory copy, never matches.json itself. Each status is
    ('applied' | 'disabled' | 'not matched', description), so the report shows a fix
    that no longer finds its set (e.g. after a team name was corrected).
    """
    data = json.loads(json.dumps(data))  # deep copy
    series_obj = next((x for x in data.get('series') or [] if x.get('title') == series_title), None)
    weeks = {w.get('week'): w for w in (series_obj or {}).get('weeks') or []}
    orders: Dict[Tuple[Any, str], List[frozenset]] = {}
    status: List[Tuple[str, str]] = []

    def find_set(fix: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        key = teams_key(fix.get('teams'))
        found = [x for x in (weeks.get(fix.get('week')) or {}).get('games') or []
                 if 'matches' in x and teams_key([x.get('team_a'), x.get('team_b')]) == key]
        return found[0] if len(found) == 1 else None

    for fix in fixes:
        text = describe_fix(fix)
        if fix.get('disabled'):
            status.append(('disabled', text))
            continue
        kind, ok = fix.get('type'), False
        if kind == 'region':
            target = find_set(fix)
            if target is not None and fix.get('to'):
                target['_region'] = norm(fix['to'])
                ok = True
        elif kind == 'dq':
            target = find_set(fix)
            slot = slot_of(target, fix.get('team')) if target is not None else None
            if slot:
                target['_dq'] = {
                    'type': 'dq',
                    'team': slot,
                    'after_game': int(fix.get('after_game') or 0),
                    'reason': (fix.get('reason') or '').strip(),
                    'played_games': 'void' if fix.get('played_games') == 'void' else 'keep',
                }
                ok = True
        elif kind == 'winner':
            for w in weeks.values():
                for x in w.get('games') or []:
                    for m in x.get('matches') or []:
                        if m.get('match_id') == fix.get('match_id') and slot_of(x, fix.get('winner')):
                            m['_winner_slot'] = slot_of(x, fix.get('winner'))
                            ok = True
        elif kind == 'order':
            if fix.get('week') in weeks and fix.get('region') and fix.get('sets'):
                orders[(fix['week'], norm(fix['region']))] = [teams_key(p) for p in fix['sets']]
                ok = True
        status.append(('applied' if ok else 'not matched', text))
    return data, orders, status


# ---------------------------------------------------------------------------
# Working out the ladder
# ---------------------------------------------------------------------------

def team_regions(weeks: List[Dict[str, Any]]) -> Dict[str, str]:
    """Most common region each team has played in, for sets with no region."""
    seen: Dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for w in weeks:
        for s in w.get('games') or []:
            region = norm(s.get('region'))
            if region:
                seen[norm(s.get('team_a'))][region] += 1
                seen[norm(s.get('team_b'))][region] += 1
    return {team: c.most_common(1)[0][0] for team, c in seen.items()}


def kinds_for(order: List[Dict[str, Any]]) -> List[int]:
    """Round kind per set in ladder order; untitled sets take the slot their position implies."""
    n = len(order)
    positional = {1: [2], 2: [1, 2], 3: [0, 1, 2]}.get(n, list(range(n)))
    return [title_kind(s.get('title')) if title_kind(s.get('title')) is not None else positional[i] for i, s in enumerate(order)]


def find_ladder(sets: List[Dict[str, Any]], results: Dict[int, int]) -> List[List[Dict[str, Any]]]:
    """Every ordering where each set's winner plays in the next set and titles agree."""
    if len(sets) == 1:
        return [sets]
    fits = []
    for order in itertools.permutations(sets):
        chained = True
        for a, b in zip(order, order[1:]):
            slot, _, _ = set_winner(a, results)
            if not slot or norm(a[slot]) not in (norm(b.get('team_a')), norm(b.get('team_b'))):
                chained = False
                break
        if not chained:
            continue
        kinds = kinds_for(list(order))
        if kinds == sorted(kinds) and len(set(kinds)) == len(kinds):
            fits.append(list(order))
    return fits


def build_event(series_title: str, week: Any, region: str, order: List[Dict[str, Any]],
                results: Dict[int, int], now: int,
                empty_ids: Set[int] = frozenset()) -> Tuple[Dict[str, Any], List[str]]:
    """One gauntlet event for an ordered ladder, plus any notes for the report."""
    notes: List[str] = []
    kinds = kinds_for(order)
    if len(order) == 1 and title_kind(order[0].get('title')) is None:
        # A lone untitled set: one game is a Challenger, more is a Finals.
        kinds = [1 if len(order[0].get('matches') or []) == 1 else 2]
        notes.append(f'lone untitled set, guessed {ROUND_NAMES[kinds[0]]}')

    rounds = [{'round': r, 'name': ROUND_NAMES[k], 'best_of': DEFAULT_BO[k]} for r, k in enumerate(kinds, start=1)]
    series = []
    for r, (s, kind) in enumerate(zip(order, kinds), start=1):
        slot, a_wins, b_wins = set_winner(s, results)
        games = []
        for i, m in enumerate(game_order(s), start=1):
            mid = m.get('match_id')
            real = isinstance(mid, int) and mid > 0
            game: Dict[str, Any] = {'game': i}
            if m.get('forfeit'):
                # Forfeits keep no match ID; stats keep using the stored placeholder.
                game.update(match_id=None, forfeit=True)
            elif not real or m.get('unavailable') or mid in empty_ids:
                # N/A: a negative placeholder (no ID could be fetched), an entry flagged
                # unavailable, or a real ID the DB only holds without player data.
                game.update(match_id=mid if real else None, unavailable=True)
                if real:
                    notes.append(f'{ROUND_NAMES[kind]} game {i} ({mid}): no player data, marked N/A')
            else:
                game['match_id'] = mid
            if isinstance(mid, int) and (game.get('forfeit') or game.get('unavailable')):
                game['placeholder_id'] = mid  # the ID stats already hold this game under
            winner = game_winner(m, results)
            if m.get('_winner_slot'):
                notes.append(f"fix: {ROUND_NAMES[kind]} game {i} ({mid}) won by {s.get(winner)}")
            if winner:
                game['winner'] = winner
            else:
                notes.append(f"{ROUND_NAMES[kind]} game {i} ({mid}): no result in DB, pick the winner by hand")
            games.append(game)
        entry: Dict[str, Any] = {
            'id': f'R{r}M1',
            'round': r,
            'team_a': s.get('team_a'),
            'team_b': s.get('team_b'),
            'winner_to': {'series': f'R{r + 1}M1', 'slot': 'team_b'} if r < len(order) else None,
            'loser_to': None,
            'vod': (s.get('match_vod') or s.get('vod_link') or '').strip(),
            'games': games,
            'outcome': s.get('_dq'),
        }
        # Played more games than the usual best-of allows: widen it for this series.
        need_bo = 2 * max(a_wins, b_wins) - 1
        if need_bo > DEFAULT_BO[kind]:
            entry['best_of'] = need_bo
        if s.get('_dq'):
            notes.append(f"fix: {s.get(s['_dq']['team'])} disqualified in the {ROUND_NAMES[kind]}")
        elif not slot:
            notes.append(f'{ROUND_NAMES[kind]} has no winner ({a_wins}-{b_wins})')
        series.append(entry)

    event = {
        'id': slug(f'{series_title}-w{week}-{region}'),
        'title': series_title,
        'week': week,
        'region': region,
        'created_at': now,
        'format': 'gauntlet',
        'rounds': rounds,
        'series': series,
        'source': SOURCE,
    }
    return event, notes


def migrate(data: Dict[str, Any], results: Dict[int, int], series_title: str,
            only_week: Optional[int] = None, empty_ids: Set[int] = frozenset(),
            fixes: Optional[List[Dict[str, Any]]] = None) -> Dict[str, Any]:
    """Return {'events', 'report', 'review', 'fixes'} for one series of matches.json."""
    data, orders, fix_status = apply_fixes(data, series_title, fixes or [])
    series_obj = next((s for s in data.get('series') or [] if s.get('title') == series_title), None)
    if series_obj is None:
        raise SystemExit(f'No series titled {series_title!r} in matches.json.')
    weeks = series_obj.get('weeks') or []
    regions_by_team = team_regions(weeks)
    now = int(time.time())

    events, report, review = [], [], []
    for w in weeks:
        week = w.get('week')
        if only_week is not None and week != only_week:
            continue
        groups: Dict[str, List[Dict[str, Any]]] = collections.defaultdict(list)
        inferred: List[str] = []
        for s in w.get('games') or []:
            if 'matches' not in s:
                review.append({'week': week, 'region': '?', 'why': 'old flat game entry, not a set', 'sets': [s]})
                continue
            region = s.get('_region') or norm(s.get('region'))
            if not region:
                ra = regions_by_team.get(norm(s.get('team_a')))
                rb = regions_by_team.get(norm(s.get('team_b')))
                region = ra if ra and (ra == rb or not rb) else (rb if not ra else '')
                if region:
                    inferred.append(f"{s.get('team_a')} vs {s.get('team_b')} -> {region}")
            groups[region or '?'].append(s)

        for region, sets in sorted(groups.items()):
            fits = find_ladder(sets, results) if region != '?' else []
            forced = orders.get((week, region))
            if forced is not None:
                # An order fix names every set of the ladder, first round first.
                by_key = {teams_key([x.get('team_a'), x.get('team_b')]): x for x in sets}
                exact = len(forced) == len(sets) and set(forced) == set(by_key)
                fits = [[by_key[k] for k in forced]] if exact else []
            if len(fits) != 1:
                why = 'no region and teams have none either' if region == '?' else (
                    "the order fix doesn't list exactly this week's sets" if forced is not None else
                    'no ordering fits the results' if not fits else f'{len(fits)} orderings fit the results')
                review.append({'week': week, 'region': region, 'why': why, 'sets': sets})
                continue
            event, notes = build_event(series_title, week, region, fits[0], results, now, empty_ids)
            notes = [f'region inferred: {x}' for x in inferred if x.endswith(region)] + notes
            events.append(event)
            report.append({'event': event, 'notes': notes})
    return {'events': events, 'report': report, 'review': review, 'fixes': fix_status}


# ---------------------------------------------------------------------------
# Output
# ---------------------------------------------------------------------------

def describe_set(s: Dict[str, Any], results: Dict[int, int]) -> str:
    slot, a, b = set_winner(s, results)
    ids = ' '.join(str(m.get('match_id')) for m in s.get('matches') or [])
    won = s[slot] if slot else 'no winner'
    return f"[{s.get('title') or 'untitled'}] {s.get('team_a')} vs {s.get('team_b')} {a}-{b} ({won}) ids: {ids}"


def print_report(result: Dict[str, Any], results: Dict[int, int], detail: bool) -> None:
    if result.get('fixes'):
        print('Fixes from the fixes file:')
        for state, text in result['fixes']:
            print(f'  [{state}] {text}')
        print()
    for item in result['report']:
        ev = item['event']
        names = {r['round']: r['name'] for r in ev['rounds']}
        line = ' -> '.join(f"{names[s['round']]}: {s['team_a']} vs {s['team_b']}" for s in ev['series'])
        print(f"Week {ev['week']:>3} {ev['region']:<3} {line}")
        if detail:
            for s in ev['series']:
                bo = s.get('best_of') or next(r['best_of'] for r in ev['rounds'] if r['round'] == s['round'])
                print(f"    {s['id']} {names[s['round']]} Bo{bo}  vod: {s['vod'] or '-'}")
                for g in s['games']:
                    who = s.get(g.get('winner')) if g.get('winner') else 'NO WINNER'
                    tag = ' forfeit' if g.get('forfeit') else ' N/A' if g.get('unavailable') else ''
                    print(f"        game {g['game']}: {g['match_id']}{tag} -> {who}")
        for note in item['notes']:
            print(f'    note: {note}')

    if result['review']:
        print(f"\nNeeds review ({len(result['review'])}), not migrated:")
        for r in result['review']:
            print(f"  Week {r['week']} {r['region']}: {r['why']}")
            for s in r['sets']:
                print(f"      {describe_set(s, results) if 'matches' in s else json.dumps(s)[:120]}")

    noted = sum(1 for i in result['report'] if i['notes'])
    unmatched = sum(1 for state, _ in result.get('fixes') or [] if state == 'not matched')
    print(f"\n{len(result['events'])} events ready ({noted} with notes), {len(result['review'])} need review"
          + (f", {unmatched} fix(es) didn't match anything." if unmatched else '.'))


def write_events(path: Path, new_events: List[Dict[str, Any]]) -> None:
    existing: Dict[str, Any] = {'events': []}
    if path.exists():
        existing = json.loads(path.read_text(encoding='utf-8'))
        backup = path.with_name(f'brackets.json.bak-{time.strftime("%Y%m%d-%H%M%S")}')
        shutil.copy2(path, backup)
        print(f'Backed up the current file to {backup}')

    # Keep events made in the editor; replace ones from an earlier migration run.
    kept = [e for e in existing.get('events') or [] if e.get('source') != SOURCE]
    taken = {e.get('id') for e in kept}
    added = [e for e in new_events if e['id'] not in taken]
    for e in new_events:
        if e['id'] in taken:
            print(f"Skipped {e['id']}: an event with that ID was made in the editor.")

    out = {**existing, 'events': kept + added}
    tmp = path.with_suffix('.json.tmp')
    tmp.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding='utf-8')
    tmp.replace(path)
    print(f'Wrote {len(added)} migrated events to {path} (kept {len(kept)} editor events).')


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description='Build brackets.json events from matches.json. Dry run unless --write.')
    parser.add_argument('--target', default=str(ROOT / 'data' / 'sandbox'),
                        help='Data folder to read matches.json + dlns.sqlite3 from and write brackets.json to (default: data/sandbox).')
    parser.add_argument('--series', default='Night Shift', help='Series title in matches.json (default: Night Shift).')
    parser.add_argument('--fixes', default=str(ROOT / 'scripts' / 'migrate_fixes.json'),
                        help="Hand fixes for weeks the script can't work out (default: scripts/migrate_fixes.json).")
    parser.add_argument('--week', type=int, help='Only this week; also prints every game.')
    parser.add_argument('--detail', action='store_true', help='Print every series and game, not just one line per event.')
    parser.add_argument('--write', action='store_true', help='Write brackets.json. Without it nothing is written.')
    args = parser.parse_args(argv)

    target = Path(args.target)
    matches_path, db_path = target / 'matches.json', target / 'dlns.sqlite3'
    for p in (matches_path, db_path):
        if not p.exists():
            hint = ' Run "python run_debug.py --sandbox" once to create the sandbox.' if 'sandbox' in str(target) else ''
            print(f'Missing {p}.{hint}')
            return 1

    data = json.loads(matches_path.read_text(encoding='utf-8-sig'))
    results = load_results(db_path)
    fixes_path = Path(args.fixes)
    fixes = json.loads(fixes_path.read_text(encoding='utf-8')).get('fixes', []) if fixes_path.exists() else []
    result = migrate(data, results, args.series, args.week, load_empty_ids(db_path), fixes)

    print(f'Reading {matches_path} and {db_path} (read-only)\n')
    print_report(result, results, detail=args.detail or args.week is not None)

    if args.write:
        if args.week is not None:
            print('\n--write is ignored with --week, so a partial run never replaces the full set.')
            return 0
        write_events(target / 'brackets.json', result['events'])
    else:
        print('\nDry run: nothing was written. Add --write to save brackets.json.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
