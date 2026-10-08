import React, { useCallback, useEffect, useMemo, useState } from 'react';
import HeroIcon from '../components/HeroIcon.jsx';

const API = '/admin/brackets/api';

const inputCls = 'w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm';
const labelCls = 'space-y-1 text-sm';
const sectionCls = 'rounded-xl border border-gray-700/60 bg-gray-800/20 p-4 md:p-5 space-y-4';
const btnPrimary = 'px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-semibold disabled:opacity-50';
const btnGhost = 'text-xs px-3 py-2 rounded border border-gray-600 text-gray-200 hover:bg-gray-700/40 disabled:opacity-50';

const readJson = async (res, fallback) => {
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) {
    throw new Error('Request returned HTML (likely a login redirect). Sign in again on this host and retry.');
  }
  const data = await res.json();
  if (!res.ok || !data?.ok) throw new Error(data?.error || fallback);
  return data;
};

export const api = async (path, opts = {}, fallback = 'Request failed') => {
  const res = await fetch(`${API}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    ...opts,
  });
  return readJson(res, fallback);
};

const pollJob = async (jobId, onUpdate) => {
  for (;;) {
    const res = await fetch(`/admin/match/job/${jobId}`, { credentials: 'include', headers: { Accept: 'application/json' } });
    const data = await readJson(res, 'Failed to read job status');
    onUpdate(data);
    if (data.status === 'done' || data.status === 'error') return data;
    await new Promise((r) => setTimeout(r, 1200));
  }
};

export const formatDuration = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
};

export const formatStart = (iso) => {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  } catch {
    return '';
  }
};

// ---------------------------------------------------------------------------
// Create event
// ---------------------------------------------------------------------------

const GAUNTLET_DEFAULT = [
  { name: 'Challenger', best_of: 1 },
  { name: 'Finals', best_of: 3 },
];

function BanPatternSelect({ id, value, onChange }) {
  return (
    <label className={labelCls}>
      <span className="text-gray-300">Ban order</span>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        {Object.entries(BAN_PATTERNS).map(([key, label]) => (
          <option key={key} value={key}>
            {label}
          </option>
        ))}
      </select>
    </label>
  );
}

function CreateEvent({ onCreated, onCancel, defaultBanPattern }) {
  const [title, setTitle] = useState('Night Shift');
  const [banPattern, setBanPattern] = useState(defaultBanPattern || DEFAULT_BAN_PATTERN);
  const [week, setWeek] = useState('');
  const [region, setRegion] = useState('EU');
  const [format, setFormat] = useState('gauntlet');
  const [rounds, setRounds] = useState(GAUNTLET_DEFAULT);
  const [elimBo, setElimBo] = useState(1);
  const [finalBo, setFinalBo] = useState(3);
  const [teamsText, setTeamsText] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const teams = useMemo(() => teamsText.split('\n').map((t) => t.trim()).filter(Boolean), [teamsText]);
  const hasQualifiers = rounds.some((r) => r.name.toLowerCase() === 'qualifiers');

  const elimRounds = teams.length >= 2 ? Math.ceil(Math.log2(teams.length)) : 0;
  const elimSize = elimRounds ? 2 ** elimRounds : 0;

  const toggleQualifiers = () => {
    setRounds((prev) =>
      hasQualifiers
        ? prev.filter((r) => r.name.toLowerCase() !== 'qualifiers')
        : [{ name: 'Qualifiers', best_of: 1 }, ...prev],
    );
  };

  const updateRound = (i, field, value) =>
    setRounds((prev) => prev.map((r, idx) => (idx === i ? { ...r, [field]: value } : r)));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    const body = { title, week, region, format, teams, ban_pattern: banPattern };
    if (format === 'gauntlet') {
      body.round_names = rounds.map((r) => r.name);
      body.best_of = rounds.map((r) => Number(r.best_of) || 1);
    } else {
      const bos = Array.from({ length: elimRounds }, (_, i) => (i === elimRounds - 1 ? Number(finalBo) : Number(elimBo)));
      body.best_of = bos.length ? bos : [Number(elimBo)];
    }
    setSaving(true);
    try {
      const data = await api('/events', { method: 'POST', body: JSON.stringify(body) }, 'Failed to create event');
      onCreated(data.event);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className={sectionCls}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Create event</h2>
        {onCancel && (
          <button type="button" onClick={onCancel} className={btnGhost}>
            Cancel
          </button>
        )}
      </div>
      <div className="grid md:grid-cols-3 gap-3">
        <label className={labelCls}>
          <span className="text-gray-300">Event</span>
          <input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} required />
        </label>
        <label className={labelCls}>
          <span className="text-gray-300">Week</span>
          <input id="ev-week" type="number" value={week} onChange={(e) => setWeek(e.target.value)} className={inputCls} placeholder="58" />
        </label>
        <label className={labelCls}>
          <span className="text-gray-300">Region</span>
          <input id="ev-region" value={region} onChange={(e) => setRegion(e.target.value)} className={inputCls} placeholder="EU" />
        </label>
      </div>
      <div className="max-w-xs">
        <BanPatternSelect id="ev-ban-pattern" value={banPattern} onChange={setBanPattern} />
      </div>

      <div className="space-y-2">
        <span className="text-sm text-gray-300">Format</span>
        <div className="flex flex-wrap gap-2">
          {[
            ['gauntlet', 'Gauntlet (Challenger → Finals)'],
            ['single_elim', 'Single elimination'],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setFormat(key)}
              aria-pressed={format === key}
              className={`text-sm px-3 py-1.5 rounded-full border ${
                format === key ? 'bg-white text-gray-900 border-white' : 'border-gray-600 text-gray-200 hover:bg-gray-700/40'
              }`}
            >
              {label}
            </button>
          ))}
          <span className="text-xs text-gray-500 self-center">Double elim, round robin and swiss come later.</span>
        </div>
      </div>

      {format === 'gauntlet' ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-gray-300">Rounds (each winner moves up to the next)</span>
            <button type="button" onClick={toggleQualifiers} className="text-xs px-2 py-1 rounded border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/20">
              {hasQualifiers ? '− Remove Qualifiers' : '+ Add Qualifiers before Challenger'}
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {rounds.map((r, i) => (
              <React.Fragment key={i}>
                <div className="flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-900/60 px-2 py-1">
                  <input
                    id={`round-name-${i}`}
                    aria-label="Round name"
                    value={r.name}
                    onChange={(e) => updateRound(i, 'name', e.target.value)}
                    className="bg-transparent text-white text-sm w-28 outline-none"
                  />
                  <select
                    id={`round-bo-${i}`}
                    aria-label="Best of"
                    value={r.best_of}
                    onChange={(e) => updateRound(i, 'best_of', Number(e.target.value))}
                    className="bg-gray-800 text-gray-200 text-xs rounded px-1 py-0.5"
                  >
                    {[1, 3, 5, 7].map((n) => (
                      <option key={n} value={n}>
                        Bo{n}
                      </option>
                    ))}
                  </select>
                </div>
                {i < rounds.length - 1 && <span className="text-gray-500">→</span>}
              </React.Fragment>
            ))}
          </div>
          <p className="text-xs text-gray-500">
            Needs {rounds.length + 1} teams. Seed 1 is the defending champion and waits in {rounds[rounds.length - 1]?.name || 'the last round'}; the
            two lowest seeds play {rounds[0]?.name || 'round 1'}.
          </p>
        </div>
      ) : (
        <div className="grid md:grid-cols-3 gap-3">
          <label className={labelCls}>
            <span className="text-gray-300">Best of (all rounds)</span>
            <select id="elim-bo" value={elimBo} onChange={(e) => setElimBo(Number(e.target.value))} className={inputCls}>
              {[1, 3, 5].map((n) => (
                <option key={n} value={n}>
                  Bo{n}
                </option>
              ))}
            </select>
          </label>
          <label className={labelCls}>
            <span className="text-gray-300">Final best of</span>
            <select id="elim-final-bo" value={finalBo} onChange={(e) => setFinalBo(Number(e.target.value))} className={inputCls}>
              {[1, 3, 5, 7].map((n) => (
                <option key={n} value={n}>
                  Bo{n}
                </option>
              ))}
            </select>
          </label>
          <div className="text-xs text-gray-400 self-end pb-2">
            {elimRounds
              ? `${teams.length} teams → ${elimRounds} rounds, ${elimSize - 1} series${elimSize > teams.length ? `, ${elimSize - teams.length} byes` : ''}.`
              : 'Paste at least 2 teams.'}
          </div>
        </div>
      )}

      <label className={`${labelCls} block`}>
        <span className="text-gray-300">Teams in seed order, one per line {format === 'gauntlet' && '(optional, can be filled per series later)'}</span>
        <textarea
          id="ev-teams"
          value={teamsText}
          onChange={(e) => setTeamsText(e.target.value)}
          rows={6}
          className={`${inputCls} font-mono`}
          placeholder={'Leviathan\nBuff Enjoyers\nAbrahams'}
        />
      </label>

      {error && <div className="text-sm text-red-300">{error}</div>}
      <button type="submit" disabled={saving} className={btnPrimary}>
        {saving ? 'Creating…' : 'Create bracket'}
      </button>
    </form>
  );
}

// ---------------------------------------------------------------------------
// Bracket board
// ---------------------------------------------------------------------------

function SeriesCard({ series, selected, onSelect }) {
  const dq = series.status === 'dq' ? series.outcome?.team : null;
  const row = (slot) => {
    const name = series[slot];
    const won = series.winner === slot;
    const fed = slot === 'team_a' ? series.fed_a : series.fed_b;
    const score = slot === 'team_a' ? series.score_a : series.score_b;
    return (
      <div className={`flex justify-between gap-2 px-2 py-1 ${won ? 'font-semibold text-white' : 'text-gray-300'}`}>
        <span className={`truncate ${!name ? 'italic text-gray-500' : ''} ${fed ? 'text-emerald-300' : ''} ${dq === slot ? 'line-through' : ''}`}>
          {name || 'TBD'}
        </span>
        <span className="font-mono tabular-nums">{dq === slot ? 'DQ' : dq ? 'W' : series.status === 'pending' ? '' : score}</span>
      </div>
    );
  };
  return (
    <button
      type="button"
      onClick={() => onSelect(series.id)}
      className={`w-52 text-left text-sm rounded-lg border bg-gray-900/60 hover:border-emerald-400/70 ${
        selected ? 'border-emerald-400 ring-2 ring-emerald-500/30' : 'border-gray-700'
      }`}
    >
      {row('team_a')}
      <div className="border-t border-gray-700/70" />
      {row('team_b')}
      <div className="border-t border-dashed border-gray-700/70 px-2 py-0.5 text-[11px] text-gray-500 font-mono flex justify-between">
        <span>{series.id}</span>
        <span>
          Bo{series.best_of} · {series.status}
        </span>
      </div>
    </button>
  );
}

export function Board({ event, selectedId, onSelect }) {
  const byRound = useMemo(() => {
    const map = new Map();
    for (const r of event.rounds || []) map.set(r.round, []);
    for (const s of event.series || []) {
      if (!map.has(s.round)) map.set(s.round, []);
      map.get(s.round).push(s);
    }
    return map;
  }, [event]);

  return (
    <div className="scroll-thin overflow-x-auto pb-2">
      <div className="flex gap-8 items-center min-w-max">
        {(event.rounds || []).map((r) => (
          <div key={r.round} className="space-y-3">
            <div className="text-xs uppercase tracking-wider text-gray-400 text-center">
              {r.name} <span className="text-gray-600">· Bo{r.best_of}</span>
            </div>
            <div className="flex flex-col gap-3 justify-around">
              {(byRound.get(r.round) || []).map((s) => (
                <SeriesCard key={s.id} series={s} selected={s.id === selectedId} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Series editor
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Ban draft
// ---------------------------------------------------------------------------

// Bans are made outside the game. Each team bans twice; the event's ban order
// determines each slot, or uses one ban per team in each round.
export const BAN_SLOTS = 4;
export const BAN_PATTERNS = {
  ABBA: 'A, B, B, A',
  ABAB: 'A, B, A, B',
  AABB: 'A, A, B, B',
  ROUND: 'Round-based (each team bans once per round)',
};
export const DEFAULT_BAN_PATTERN = 'ABBA';
const otherTeam = (slot) => (slot === 'team_a' ? 'team_b' : 'team_a');
const patternOf = (pattern) => (BAN_PATTERNS[pattern] ? pattern : DEFAULT_BAN_PATTERN);
export const banTeam = (first, i, pattern) => {
  const currentPattern = patternOf(pattern);
  if (currentPattern === 'ROUND') return i % 2 === 0 ? 'team_a' : 'team_b';
  return currentPattern[i] === 'A' ? first : otherTeam(first);
};

export const toBanForm = (bans, pattern) => {
  const saved = bans || [];
  // The first-ban team follows from any saved ban and the slot it sits in.
  const any = saved[0];
  const currentPattern = patternOf(pattern);
  const first = !any || currentPattern === 'ROUND'
    ? 'team_a'
    : currentPattern[any.order - 1] === 'A'
      ? any.team
      : otherTeam(any.team);
  return {
    first,
    heroes: Array.from({ length: BAN_SLOTS }, (_, i) => {
      const b = saved.find((x) => x.order === i + 1);
      return b?.hero_id != null ? String(b.hero_id) : '';
    }),
    teams: Array.from({ length: BAN_SLOTS }, (_, i) => {
      const b = saved.find((x) => x.order === i + 1);
      return b?.team || '';
    }),
  };
};

export const banPayload = (draft, pattern) =>
  draft.heroes
    .map((hero_id, i) => {
      const team =
        patternOf(pattern) === 'ROUND' && draft.teams?.[i]
          ? draft.teams[i]
          : banTeam(draft.first, i, pattern);
      return { order: i + 1, team, hero_id };
    })
    .filter((b) => b.hero_id)
    .map((b) => ({ ...b, hero_id: Number(b.hero_id) }));

// {id: name} from /db/heroes, sorted by name for the pickers.
export function useHeroes() {
  const [heroes, setHeroes] = useState({});
  useEffect(() => {
    fetch('/db/heroes', { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : {}))
      .then((data) => setHeroes(data && typeof data === 'object' ? data : {}))
      .catch(() => setHeroes({}));
  }, []);
  const sorted = useMemo(
    () => Object.entries(heroes).sort((a, b) => String(a[1]).localeCompare(String(b[1]))),
    [heroes],
  );
  return { heroes, sorted };
}

function BanDraft({ gameIndex, draft, pattern, onChange, heroes, sortedHeroes, teamA, teamB }) {
  const [open, setOpen] = useState(() => draft.heroes.some(Boolean));
  const filled = draft.heroes.filter(Boolean).length;
  const taken = new Set(draft.heroes.filter(Boolean));
  const names = { team_a: teamA || 'Team A', team_b: teamB || 'Team B' };
  const setHero = (i, hero) => onChange({ ...draft, heroes: draft.heroes.map((h, idx) => (idx === i ? hero : h)) });

  return (
    <div className="rounded border border-gray-700/60 bg-gray-900/30">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex justify-between px-2 py-1 text-xs text-gray-300"
        aria-expanded={open}
      >
        <span>
          Bans ({filled}/{BAN_SLOTS})
          {patternOf(pattern) === 'ROUND' ? ' · Round-based' : filled > 0 && ` · ${names[draft.first]} first`}
        </span>
        <span className="text-gray-500">{open ? 'Hide' : 'Edit'}</span>
      </button>
      {open && (
        <div className="px-2 pb-2 space-y-1.5">
          {patternOf(pattern) === 'ROUND' ? (
            <div className="text-xs text-gray-400">
              Each team bans once in each round; neither team bans first.
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`Game ${gameIndex + 1} first ban`}>
              <span className="text-xs text-gray-400" title="The ban order is set per event in Edit event">
                Order {BAN_PATTERNS[patternOf(pattern)]} · First ban:
              </span>
              {['team_a', 'team_b'].map((slot) => (
                <button
                  key={slot}
                  id={`game-${gameIndex}-first-ban-${slot}`}
                  type="button"
                  role="radio"
                  aria-checked={draft.first === slot}
                  onClick={() => onChange({ ...draft, first: slot })}
                  className={`text-xs px-2.5 py-1 rounded border ${
                    draft.first === slot
                      ? 'border-sky-400 bg-sky-900/40 text-sky-100'
                      : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                  }`}
                >
                  {names[slot]}
                </button>
              ))}
            </div>
          )}
          {draft.heroes.map((hero, i) => (
            <React.Fragment key={i}>
              {patternOf(pattern) === 'ROUND' && i % 2 === 0 && (
                <div className="pt-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
                  {i === 0 ? 'First round of bans' : 'Second round of bans'}
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-mono text-gray-400 w-12">
                {patternOf(pattern) === 'ROUND' ? `Ban ${(i % 2) + 1}` : `Ban ${i + 1}`}
              </span>
              <span className="text-xs text-gray-300 w-32 truncate">
                {names[patternOf(pattern) === 'ROUND' && draft.teams?.[i] ? draft.teams[i] : banTeam(draft.first, i, pattern)]}
              </span>
              <HeroIcon name={heroes[hero]} size="h-6 w-6" />
              <select
                id={`game-${gameIndex}-ban-${i}-hero`}
                value={hero}
                onChange={(e) => setHero(i, e.target.value)}
                className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 min-w-[9rem]"
              >
                <option value="">No ban</option>
                {sortedHeroes.map(([id, name]) => (
                  <option key={id} value={id} disabled={taken.has(id) && id !== hero}>
                    {name}
                  </option>
                ))}
              </select>
            </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

const toForm = (series, pattern) => ({
  team_a: series.team_a || '',
  team_b: series.team_b || '',
  vod: series.vod || '',
  ban_pattern: series.ban_pattern || '',
  games: (series.games?.length ? series.games : [{}]).map((g) => ({
    match_id: g.match_id != null && g.match_id > 0 ? String(g.match_id) : '',
    forfeit: Boolean(g.forfeit),
    unavailable: Boolean(g.unavailable),
    placeholder_id: g.placeholder_id ?? null,
    // Older games were saved without a pick; fall back to the result already in stats.
    winner: g.winner || g.result || '',
    vod: g.vod || '',
    bans: toBanForm(g.bans, pattern),
    ingested: Boolean(g.ingested),
  })),
  dq: series.outcome?.type === 'dq'
    ? { ...series.outcome }
    : null,
});

function CheckLine({ check, teamA, teamB }) {
  if (!check) return null;
  if (check.error) return <div className="text-xs rounded border-l-2 border-amber-400 bg-amber-900/20 px-2 py-1 text-amber-200">{check.error}</div>;
  const c = check.data;
  const winnerName = c.winner === 'team_a' ? teamA : c.winner === 'team_b' ? teamB : null;
  const sideText =
    c.team_a_side == null ? `Couldn't guess the winner from known players.` : `${teamA || 'Team A'} on ${c.team_a_side === 0 ? 'Amber' : 'Sapphire'}`;
  const weak = c.known.team_a + c.known.team_b < 4;
  return (
    <div
      className={`text-xs rounded border-l-2 px-2 py-1 ${
        weak ? 'border-amber-400 bg-amber-900/20 text-amber-100' : 'border-emerald-400 bg-emerald-900/20 text-emerald-100'
      }`}
    >
      Known players: {teamA || 'Team A'} {c.known.team_a}, {teamB || 'Team B'} {c.known.team_b} of {c.player_count} · {sideText}
      {winnerName && (
        <>
          {' '}
          · Looks like <b>{winnerName} won</b>
        </>
      )}
      {formatDuration(c.duration_s) && ` · ${formatDuration(c.duration_s)}`}
      {formatStart(c.start_time) && ` · ${formatStart(c.start_time)}`}
    </div>
  );
}

function SeriesEditor({ event, series, onSaved }) {
  const [form, setForm] = useState(() => toForm(series, event.ban_pattern));
  const [checks, setChecks] = useState({});
  const { heroes, sorted: sortedHeroes } = useHeroes();
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(toForm(series, event.ban_pattern));
    setChecks({});
    setJob(null);
    setError('');
  }, [series.id, event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamA = form.team_a || series.team_a;
  const teamB = form.team_b || series.team_b;
  const banPattern = form.ban_pattern || event.ban_pattern;

  const setGame = (i, patch) =>
    setForm((f) => ({ ...f, games: f.games.map((g, idx) => (idx === i ? { ...g, ...patch } : g)) }));

  const runCheck = useCallback(
    async (i, matchId) => {
      if (!/^\d+$/.test(matchId)) {
        setChecks((c) => ({ ...c, [i]: matchId ? { error: 'Match ID must be a number.' } : null }));
        return;
      }
      setChecks((c) => ({ ...c, [i]: { loading: true } }));
      try {
        const data = await api('/check', { method: 'POST', body: JSON.stringify({ match_id: matchId, team_a: teamA, team_b: teamB }) }, 'Check failed');
        setChecks((c) => ({ ...c, [i]: { data: data.check } }));
        if (data.check.winner) {
          setForm((f) => ({
            ...f,
            games: f.games.map((g, idx) => (idx === i && !g.winner ? { ...g, winner: data.check.winner } : g)),
          }));
        }
      } catch (err) {
        setChecks((c) => ({ ...c, [i]: { error: err.message } }));
      }
    },
    [teamA, teamB],
  );

  const save = async () => {
    setError('');
    setJob(null);
    setSaving(true);
    try {
      const body = {
        vod: form.vod,
        ban_pattern: form.ban_pattern,
        games: form.games.map((g) => ({
          match_id: g.forfeit ? null : g.match_id,
          forfeit: g.forfeit,
          unavailable: g.unavailable,
          placeholder_id: g.placeholder_id,
          winner: g.winner,
          vod: g.vod,
          bans: banPayload(g.bans, banPattern),
        })),
        outcome: form.dq ? { type: 'dq', ...form.dq } : null,
      };
      if (!series.fed_a) body.team_a = form.team_a;
      if (!series.fed_b) body.team_b = form.team_b;
      const data = await api(
        `/events/${encodeURIComponent(event.id)}/series/${encodeURIComponent(series.id)}`,
        { method: 'PUT', body: JSON.stringify(body) },
        'Failed to save series',
      );
      const final = await pollJob(data.job_id, setJob);
      if (final.status === 'error') setError(final.message);
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const roundName = event.rounds?.find((r) => r.round === series.round)?.name || `Round ${series.round}`;
  const dq = form.dq;

  return (
    <section className={sectionCls}>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-white">
          {roundName} · <span className="font-mono text-gray-400">{series.id}</span>
        </h2>
        <span className="text-xs px-2 py-0.5 rounded bg-gray-700/60 text-gray-200">Bo{series.best_of}</span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {[
          ['team_a', 'Team A', series.fed_a],
          ['team_b', 'Team B', series.fed_b],
        ].map(([slot, label, fed]) => (
          <label key={slot} className={labelCls}>
            <span className="text-gray-300">
              {label} {fed && <span className="text-emerald-400 text-xs">(advanced automatically)</span>}
            </span>
            <input
              id={`series-${slot}`}
              value={fed ? series[slot] || '' : form[slot]}
              onChange={(e) => setForm((f) => ({ ...f, [slot]: e.target.value }))}
              disabled={fed}
              className={`${inputCls} disabled:opacity-70`}
              placeholder="TBD"
            />
          </label>
        ))}
      </div>

      <label className={`${labelCls} block`}>
        <span className="text-gray-300">Series VOD</span>
        <input id="series-vod" value={form.vod} onChange={(e) => setForm((f) => ({ ...f, vod: e.target.value }))} className={inputCls} placeholder="https://youtube.com/…" />
      </label>

      <div className="max-w-xs space-y-1">
        <label className={labelCls}>
          <span className="text-gray-300">Ban order for this series</span>
          <select
            id="series-ban-pattern"
            value={form.ban_pattern}
            onChange={(e) => setForm((f) => ({ ...f, ban_pattern: e.target.value }))}
            className={inputCls}
          >
            <option value="">Event default ({BAN_PATTERNS[patternOf(event.ban_pattern)]})</option>
            {Object.entries(BAN_PATTERNS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </label>
        <p className="text-xs text-gray-500">Use round-based bans here when first pick is unknown. Other series keep the event default.</p>
      </div>

      <div className="space-y-3">
        {form.games.map((g, i) => {
          const afterDq = dq && i + 1 > Number(dq.after_game || 0);
          return (
            <div key={i} className={`grid grid-cols-[4.5rem_1fr] gap-2 items-start ${afterDq ? 'opacity-50' : ''}`}>
              <div className="text-sm text-gray-300 font-mono pt-2">Game {i + 1}</div>
              <div className="space-y-1.5 min-w-0">
                <div className="flex flex-wrap gap-2 items-center">
                  <input
                    id={`game-${i}-id`}
                    value={g.match_id}
                    onChange={(e) => setGame(i, { match_id: e.target.value.trim() })}
                    onBlur={(e) => e.target.value && !g.unavailable && runCheck(i, e.target.value.trim())}
                    disabled={g.forfeit}
                    className={`${inputCls} font-mono flex-1 min-w-[9rem] w-auto`}
                    placeholder={g.forfeit ? 'Forfeit, no ID' : g.unavailable ? 'Match ID if known (optional)' : 'Match ID'}
                    inputMode="numeric"
                  />
                  <label className="text-xs text-gray-300 flex items-center gap-1" title="Played, but the API can't fetch it (e.g. a private lobby). Counts with your winner pick, without match stats.">
                    <input
                      type="checkbox"
                      checked={g.unavailable}
                      onChange={(e) => {
                        setGame(i, { unavailable: e.target.checked, forfeit: false });
                        if (e.target.checked) setChecks((c) => ({ ...c, [i]: null }));
                      }}
                    />
                    N/A (private)
                  </label>
                  <label className="text-xs text-gray-300 flex items-center gap-1">
                    <input type="checkbox" checked={g.forfeit} onChange={(e) => setGame(i, { forfeit: e.target.checked, unavailable: false })} />
                    Forfeit
                  </label>
                  {form.games.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setForm((f) => ({ ...f, games: f.games.filter((_, idx) => idx !== i) }))}
                      className="text-xs text-red-300 hover:text-red-200"
                    >
                      Remove
                    </button>
                  )}
                </div>
                {checks[i]?.loading && <div className="text-xs text-gray-400">Checking…</div>}
                <CheckLine check={checks[i]?.loading ? null : checks[i]} teamA={teamA} teamB={teamB} />
                {g.unavailable && (
                  <div className="text-xs rounded border-l-2 border-yellow-500 bg-yellow-900/20 px-2 py-1 text-yellow-100">
                    Not fetched from the API. Saved with your winner pick only, so it counts in the score and standings but has no player stats.
                  </div>
                )}
                {g.ingested && !checks[i] && !g.unavailable && !g.forfeit && (
                  <div className="text-xs text-gray-500">In stats. Change the ID to replace it; the old match is removed on save.</div>
                )}
                <div className="flex flex-wrap items-center gap-2" role="radiogroup" aria-label={`Game ${i + 1} winner`}>
                  <span className="text-xs text-gray-400">{g.forfeit ? 'Who won the forfeit?' : g.unavailable ? 'Who won? (required for N/A)' : 'Who won?'}</span>
                  {[
                    ['team_a', teamA || 'Team A'],
                    ['team_b', teamB || 'Team B'],
                  ].map(([slot, name]) => (
                    <button
                      key={slot}
                      id={`game-${i}-winner-${slot}`}
                      type="button"
                      role="radio"
                      aria-checked={g.winner === slot}
                      onClick={() => setGame(i, { winner: slot })}
                      className={`text-xs px-2.5 py-1 rounded border ${
                        g.winner === slot
                          ? 'border-emerald-400 bg-emerald-900/40 text-emerald-100'
                          : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'
                      }`}
                    >
                      {name}
                    </button>
                  ))}
                </div>
                <BanDraft
                  key={`${series.id}-${i}`}
                  gameIndex={i}
                  draft={g.bans}
                  pattern={banPattern}
                  onChange={(bans) => setGame(i, { bans })}
                  heroes={heroes}
                  sortedHeroes={sortedHeroes}
                  teamA={teamA}
                  teamB={teamB}
                />
              </div>
            </div>
          );
        })}
        {form.games.length < series.best_of && (
          <button type="button" onClick={() => setForm((f) => ({ ...f, games: [...f.games, { match_id: '', forfeit: false, unavailable: false, placeholder_id: null, winner: '', vod: '', bans: toBanForm() }] }))} className={btnGhost}>
            + Add game
          </button>
        )}
      </div>

      {dq ? (
        <div className="rounded-lg border border-orange-500/60 bg-orange-900/15 p-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-orange-200">Disqualification</h3>
            <span className="text-xs text-orange-300">Overrides game results</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelCls}>
              <span className="text-gray-300">Team disqualified</span>
              <select id="dq-team" value={dq.team} onChange={(e) => setForm((f) => ({ ...f, dq: { ...f.dq, team: e.target.value } }))} className={inputCls}>
                <option value="team_a">{teamA || 'Team A'}</option>
                <option value="team_b">{teamB || 'Team B'}</option>
              </select>
            </label>
            <label className={labelCls}>
              <span className="text-gray-300">After game</span>
              <select id="dq-after" value={dq.after_game} onChange={(e) => setForm((f) => ({ ...f, dq: { ...f.dq, after_game: Number(e.target.value) } }))} className={inputCls}>
                <option value={0}>Before any game</option>
                {form.games.map((_, i) => (
                  <option key={i} value={i + 1}>
                    Game {i + 1}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={`${labelCls} block`}>
            <span className="text-gray-300">Reason (shown on the site)</span>
            <input id="dq-reason" value={dq.reason || ''} onChange={(e) => setForm((f) => ({ ...f, dq: { ...f.dq, reason: e.target.value } }))} className={inputCls} placeholder="Ineligible player in Game 1" />
          </label>
          <fieldset className="space-y-1 text-sm text-gray-200">
            <legend className="text-gray-300 mb-1">Played games</legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="dq-played" checked={dq.played_games !== 'void'} onChange={() => setForm((f) => ({ ...f, dq: { ...f.dq, played_games: 'keep' } }))} />
              Keep stats (games count as played)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="dq-played" checked={dq.played_games === 'void'} onChange={() => setForm((f) => ({ ...f, dq: { ...f.dq, played_games: 'void' } }))} />
              Void (games are left out of stats)
            </label>
          </fieldset>
          <p className="text-xs text-gray-400">
            {(dq.team === 'team_a' ? teamB : teamA) || 'The other team'} advances. Games after the DQ stay listed but are left out of stats (removed if already added).
          </p>
        </div>
      ) : null}

      {error && <div className="text-sm text-red-300 whitespace-pre-wrap">{error}</div>}
      {job && (
        <div className={`text-xs rounded border px-3 py-2 ${job.status === 'error' ? 'border-red-500/50 text-red-200' : 'border-gray-700/60 text-gray-200'}`}>
          {job.status}: {job.message}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={saving} className={btnPrimary}>
          {saving ? 'Saving…' : 'Save series'}
        </button>
        <button
          type="button"
          onClick={() =>
            setForm((f) => ({
              ...f,
              dq: f.dq ? null : { team: 'team_b', after_game: Math.min(1, f.games.length), reason: '', played_games: 'keep' },
            }))
          }
          className="text-xs px-3 py-2 rounded border border-orange-500/60 text-orange-200 hover:bg-orange-700/20"
        >
          {dq ? 'Undo disqualification' : 'Disqualify a team'}
        </button>
      </div>
      <p className="text-xs text-gray-500">
        On save, games are fetched from the API, written to the database and matches.json, and the winner moves to the next slot.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Edit event
// ---------------------------------------------------------------------------

const BEST_OF_CHOICES = [1, 3, 5, 7];

const toEventForm = (event) => ({
  title: event.title || '',
  ban_pattern: event.ban_pattern || DEFAULT_BAN_PATTERN,
  week: event.week ?? '',
  region: event.region || '',
  rounds: (event.rounds || []).map((r) => ({ round: r.round, name: r.name || '', best_of: r.best_of || 1 })),
  // Only stored team slots are editable; fed ones come from an earlier round's winner.
  teams: Object.fromEntries(
    (event.series || []).map((s) => [s.id, { team_a: s.fed_a ? null : s.team_a || '', team_b: s.fed_b ? null : s.team_b || '' }]),
  ),
});

function EventEditor({ event, onChanged, onClose }) {
  const [form, setForm] = useState(() => toEventForm(event));
  const [newRound, setNewRound] = useState(() => ({
    name: 'Qualifiers',
    best_of: 3,
    team_a: event.series?.find((s) => s.round === 1)?.team_b || '',
    team_b: '',
  }));
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(toEventForm(event));
  }, [event]);

  const roundName = (n) => form.rounds.find((r) => r.round === n)?.name || `Round ${n}`;
  const firstSeries = event.series?.find((s) => s.round === 1);
  const firstPlayed = Boolean(firstSeries?.games?.length);
  const played = (event.series || []).filter((s) => (s.games || []).length);
  const gameCount = played.reduce((n, s) => n + s.games.length, 0);
  const series = [...(event.series || [])].sort(
    (a, b) => a.round - b.round || a.id.localeCompare(b.id, undefined, { numeric: true }),
  );
  const setTeam = (id, slot, value) =>
    setForm((f) => ({ ...f, teams: { ...f.teams, [id]: { ...f.teams[id], [slot]: value } } }));
  const setRound = (n, patch) =>
    setForm((f) => ({ ...f, rounds: f.rounds.map((r) => (r.round === n ? { ...r, ...patch } : r)) }));

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try {
      await fn();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      setJob(null);
      // Fed slots are null in the form and left out, so they keep advancing automatically.
      const teams = Object.fromEntries(
        Object.entries(form.teams).map(([id, t]) => [id, Object.fromEntries(Object.entries(t).filter(([, v]) => v !== null))]),
      );
      const data = await api(
        `/events/${encodeURIComponent(event.id)}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            title: form.title,
            week: form.week,
            region: form.region,
            ban_pattern: form.ban_pattern,
            rounds: form.rounds,
            teams,
          }),
        },
        'Failed to save event',
      );
      if (data.job_id) {
        const final = await pollJob(data.job_id, setJob);
        if (final.status === 'error') setError(final.message);
      } else {
        setJob({ status: 'done', message: 'Saved. No games to re-import.' });
      }
      await onChanged();
    });

  const addRound = () =>
    run(async () => {
      await api(
        `/events/${encodeURIComponent(event.id)}/rounds`,
        { method: 'POST', body: JSON.stringify(newRound) },
        'Failed to add round',
      );
      await onChanged();
    });

  const removeRound = () =>
    run(async () => {
      await api(`/events/${encodeURIComponent(event.id)}/rounds/first`, { method: 'DELETE' }, 'Failed to remove round');
      await onChanged();
    });

  return (
    <section className={sectionCls}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Edit event</h2>
        <button type="button" onClick={onClose} className={btnGhost}>
          Close
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <label className={labelCls}>
          <span className="text-gray-300">Title</span>
          <input id="edit-title" value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} className={inputCls} />
        </label>
        <label className={labelCls}>
          <span className="text-gray-300">Week</span>
          <input
            id="edit-week"
            type="number"
            value={form.week}
            onChange={(e) => setForm((f) => ({ ...f, week: e.target.value }))}
            className={inputCls}
          />
        </label>
        <label className={labelCls}>
          <span className="text-gray-300">Region</span>
          <input id="edit-region" value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value }))} className={inputCls} />
        </label>
      </div>
      <div className="max-w-xs space-y-1">
        <BanPatternSelect id="edit-ban-pattern" value={form.ban_pattern} onChange={(v) => setForm((f) => ({ ...f, ban_pattern: v }))} />
        <p className="text-xs text-gray-500">Default for the event; individual series can override this setting.</p>
      </div>

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-gray-400">Rounds</h3>
        {form.rounds.map((r) => (
          <div key={r.round} className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-mono text-gray-500 w-6">{r.round}</span>
            <input
              id={`edit-round-${r.round}-name`}
              value={r.name}
              onChange={(e) => setRound(r.round, { name: e.target.value })}
              className={`${inputCls} w-48`}
            />
            <select
              id={`edit-round-${r.round}-bo`}
              value={r.best_of}
              onChange={(e) => setRound(r.round, { best_of: Number(e.target.value) })}
              className={`${inputCls} w-auto`}
            >
              {BEST_OF_CHOICES.map((n) => (
                <option key={n} value={n}>
                  Bo{n}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        <h3 className="text-xs uppercase tracking-wider text-gray-400">Teams</h3>
        {series.map((s) => (
          <div key={s.id} className="grid grid-cols-[7rem_1fr_1fr] gap-2 items-center">
            <span className="text-xs text-gray-400 truncate">
              {roundName(s.round)} <span className="font-mono text-gray-600">{s.id}</span>
            </span>
            {['team_a', 'team_b'].map((slot) =>
              form.teams[s.id]?.[slot] === null ? (
                <span key={slot} className="text-xs text-emerald-300 truncate px-1" title="Filled by the winner of the round before">
                  {s[slot] || 'TBD'} (advanced)
                </span>
              ) : (
                <input
                  key={slot}
                  id={`edit-${s.id}-${slot}`}
                  value={form.teams[s.id]?.[slot] ?? ''}
                  onChange={(e) => setTeam(s.id, slot, e.target.value)}
                  className={inputCls}
                  placeholder="TBD"
                />
              ),
            )}
          </div>
        ))}
      </div>

      {error && <div className="text-sm text-red-300 whitespace-pre-wrap">{error}</div>}
      {job && (
        <div
          className={`text-xs rounded border px-3 py-2 ${
            job.status === 'error' ? 'border-red-500/50 text-red-200' : 'border-gray-700/60 text-gray-200'
          }`}
        >
          {job.status}: {job.message}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={busy} className={btnPrimary}>
          {busy ? 'Saving…' : 'Save and re-import'}
        </button>
        <span className="text-xs text-gray-500">
          {played.length
            ? `Re-imports ${played.length} series (${gameCount} games) so stats and matches.json match these details.`
            : 'No games yet, so nothing is re-imported.'}
        </span>
      </div>

      {event.format === 'gauntlet' && (
        <div className="rounded-lg border border-gray-700/60 p-3 space-y-3">
          <h3 className="text-xs uppercase tracking-wider text-gray-400">Add an opening round</h3>
          <p className="text-xs text-gray-500">
            Goes before {roundName(1)}. Its winner takes the second slot of {roundName(1)}
            {firstPlayed ? `, unless ${roundName(1)} is already played: then its teams stay as they are` : ''}.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <input
              id="new-round-name"
              value={newRound.name}
              onChange={(e) => setNewRound((r) => ({ ...r, name: e.target.value }))}
              className={inputCls}
              placeholder="Qualifiers"
            />
            <select
              id="new-round-bo"
              value={newRound.best_of}
              onChange={(e) => setNewRound((r) => ({ ...r, best_of: Number(e.target.value) }))}
              className={inputCls}
            >
              {BEST_OF_CHOICES.map((n) => (
                <option key={n} value={n}>
                  Bo{n}
                </option>
              ))}
            </select>
            <input
              id="new-round-team-a"
              value={newRound.team_a}
              onChange={(e) => setNewRound((r) => ({ ...r, team_a: e.target.value }))}
              className={inputCls}
              placeholder="Team A"
            />
            <input
              id="new-round-team-b"
              value={newRound.team_b}
              onChange={(e) => setNewRound((r) => ({ ...r, team_b: e.target.value }))}
              className={inputCls}
              placeholder="Team B"
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={addRound} disabled={busy} className={btnGhost}>
              + Add round
            </button>
            {form.rounds.length > 1 && (
              <button
                type="button"
                onClick={removeRound}
                disabled={busy || firstPlayed}
                title={firstPlayed ? 'The first round has games' : ''}
                className="text-xs px-3 py-2 rounded border border-red-500/40 text-red-300 hover:bg-red-700/20 disabled:opacity-50"
              >
                Remove {roundName(1)}
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BracketAdmin() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [event, setEvent] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const loadEvents = useCallback(async () => {
    try {
      const data = await api('/events', {}, 'Failed to load events');
      setEvents(data.events);
      return data.events;
    } catch (err) {
      setError(err.message);
      return [];
    }
  }, []);

  const loadEvent = useCallback(async (id) => {
    if (!id) {
      setEvent(null);
      return;
    }
    try {
      const data = await api(`/events/${encodeURIComponent(id)}`, {}, 'Failed to load event');
      setEvent(data.event);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    loadEvents().then((list) => {
      if (list.length) setEventId(list[0].id);
      else setCreating(true);
    });
  }, [loadEvents]);

  useEffect(() => {
    loadEvent(eventId);
    setSelectedId('');
    setEditing(false);
  }, [eventId, loadEvent]);

  const selected = event?.series?.find((s) => s.id === selectedId) || null;

  const deleteEvent = async () => {
    if (!event) return;
    try {
      await api(`/events/${encodeURIComponent(event.id)}`, { method: 'DELETE' }, 'Failed to delete');
      const list = await loadEvents();
      setEventId(list[0]?.id || '');
      if (!list.length) setCreating(true);
    } catch (err) {
      setError(err.message);
    }
  };
  const [confirmDelete, setConfirmDelete] = useState(false);

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Brackets</h1>
          <p className="text-sm text-gray-400 mt-1">Create an event from a format, then add match IDs and VODs per series as they finish.</p>
        </div>
        <div className="flex gap-2">
          <a href="/admin/brackets/view" className={btnGhost}>
            View submitted data
          </a>
          <a href="/admin/matches" className={btnGhost}>
            Bulk submit / edit matches
          </a>
        </div>
      </div>

      {error && (
        <div className="text-sm text-red-300 rounded border border-red-500/40 px-3 py-2 flex justify-between">
          <span>{error}</span>
          <button type="button" onClick={() => setError('')} className="text-xs">
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <select id="event-pick" value={eventId} onChange={(e) => { setEventId(e.target.value); setCreating(false); }} className={`${inputCls} w-auto`}>
          {!events.length && <option value="">No events yet</option>}
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
              {e.week != null ? ` · Week ${e.week}` : ''}
              {e.region ? ` · ${e.region}` : ''} ({e.format === 'single_elim' ? 'single elim' : e.format})
            </option>
          ))}
        </select>
        <button type="button" onClick={() => setCreating(true)} className={btnGhost}>
          + New event
        </button>
        {event && !creating && !editing && (
          <button type="button" onClick={() => { setEditing(true); setSelectedId(''); }} className={btnGhost}>
            Edit event
          </button>
        )}
        {event && !creating && (
          confirmDelete ? (
            <span className="flex items-center gap-2 text-xs text-gray-300">
              Delete this bracket? Games already in stats stay.
              <button type="button" onClick={() => { setConfirmDelete(false); deleteEvent(); }} className="px-2 py-1 rounded border border-red-500/60 text-red-200">
                Delete
              </button>
              <button type="button" onClick={() => setConfirmDelete(false)} className="px-2 py-1 rounded border border-gray-600">
                Keep
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDelete(true)} className="text-xs px-3 py-2 rounded border border-red-500/40 text-red-300 hover:bg-red-700/20">
              Delete bracket
            </button>
          )
        )}
      </div>

      {creating ? (
        <CreateEvent
          defaultBanPattern={events[0]?.ban_pattern}
          onCancel={events.length ? () => setCreating(false) : null}
          onCreated={async (ev) => {
            setCreating(false);
            await loadEvents();
            setEventId(ev.id);
            setEvent(ev);
          }}
        />
      ) : event ? (
        <div className="space-y-6">
          <section className={sectionCls}>
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">
              {event.title}
              {event.week != null ? ` · Week ${event.week}` : ''}
              {event.region ? ` · ${event.region}` : ''}
            </h2>
            <p className="text-xs text-gray-400">Click a series to enter its games.</p>
            <Board event={event} selectedId={selectedId} onSelect={(id) => { setSelectedId(id); setEditing(false); }} />
          </section>
          {editing ? (
            <div className="max-w-3xl">
              <EventEditor
                event={event}
                onClose={() => setEditing(false)}
                onChanged={async () => {
                  await loadEvent(event.id);
                  await loadEvents();
                }}
              />
            </div>
          ) : selected ? (
            <div className="max-w-3xl"><SeriesEditor event={event} series={selected} onSaved={() => loadEvent(event.id)} /></div>
          ) : (
            <section className={`${sectionCls} text-sm text-gray-400`}>Pick a series above to add match IDs, VODs or a disqualification.</section>
          )}
        </div>
      ) : null}
    </div>
  );
}
