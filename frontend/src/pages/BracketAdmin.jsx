import React, { useCallback, useEffect, useMemo, useState } from 'react';

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

const api = async (path, opts = {}, fallback = 'Request failed') => {
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

const formatDuration = (s) => {
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return '';
  return `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, '0')}`;
};

const formatStart = (iso) => {
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

function CreateEvent({ onCreated, onCancel }) {
  const [title, setTitle] = useState('Night Shift');
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
    const body = { title, week, region, format, teams };
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

function Board({ event, selectedId, onSelect }) {
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
    <div className="overflow-x-auto pb-2">
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

const toForm = (series) => ({
  team_a: series.team_a || '',
  team_b: series.team_b || '',
  vod: series.vod || '',
  games: (series.games?.length ? series.games : [{}]).map((g) => ({
    match_id: g.match_id != null && g.match_id > 0 ? String(g.match_id) : '',
    team_a_side: g.team_a_side ?? '',
    forfeit: Boolean(g.forfeit),
    winner: g.winner || '',
    vod: g.vod || '',
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
    c.team_a_side == null ? `Couldn't tell sides from known players; pick below.` : `${teamA || 'Team A'} on ${c.team_a_side === 0 ? 'Amber' : 'Sapphire'}`;
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
          · <b>{winnerName} won</b>
        </>
      )}
      {formatDuration(c.duration_s) && ` · ${formatDuration(c.duration_s)}`}
      {formatStart(c.start_time) && ` · ${formatStart(c.start_time)}`}
    </div>
  );
}

function SeriesEditor({ event, series, onSaved }) {
  const [form, setForm] = useState(() => toForm(series));
  const [checks, setChecks] = useState({});
  const [saving, setSaving] = useState(false);
  const [job, setJob] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm(toForm(series));
    setChecks({});
    setJob(null);
    setError('');
  }, [series.id, event.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const teamA = form.team_a || series.team_a;
  const teamB = form.team_b || series.team_b;

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
        games: form.games.map((g) => ({
          match_id: g.forfeit ? null : g.match_id,
          team_a_side: g.team_a_side === '' ? null : Number(g.team_a_side),
          forfeit: g.forfeit,
          winner: g.forfeit ? g.winner : undefined,
          vod: g.vod,
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
                    onBlur={(e) => e.target.value && runCheck(i, e.target.value.trim())}
                    disabled={g.forfeit}
                    className={`${inputCls} font-mono flex-1 min-w-[9rem] w-auto`}
                    placeholder={g.forfeit ? 'Forfeit, no ID' : 'Match ID'}
                    inputMode="numeric"
                  />
                  <label className="text-xs text-gray-300 flex items-center gap-1">
                    <input type="checkbox" checked={g.forfeit} onChange={(e) => setGame(i, { forfeit: e.target.checked })} />
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
                {g.ingested && !checks[i] && <div className="text-xs text-gray-500">In stats. Change the ID to replace it; the old match is removed on save.</div>}
                {g.forfeit ? (
                  <select id={`game-${i}-winner`} value={g.winner} onChange={(e) => setGame(i, { winner: e.target.value })} className={`${inputCls} w-auto`}>
                    <option value="">Who won the forfeit?</option>
                    <option value="team_a">{teamA || 'Team A'}</option>
                    <option value="team_b">{teamB || 'Team B'}</option>
                  </select>
                ) : (
                  <select
                    id={`game-${i}-side`}
                    value={g.team_a_side}
                    onChange={(e) => setGame(i, { team_a_side: e.target.value })}
                    className="bg-gray-900 border border-gray-700 rounded px-2 py-1 text-xs text-gray-300"
                  >
                    <option value="">Sides: detect from known players</option>
                    <option value="0">{teamA || 'Team A'} on Amber</option>
                    <option value="1">{teamA || 'Team A'} on Sapphire</option>
                  </select>
                )}
              </div>
            </div>
          );
        })}
        {form.games.length < series.best_of && (
          <button type="button" onClick={() => setForm((f) => ({ ...f, games: [...f.games, { match_id: '', team_a_side: '', forfeit: false, winner: '', vod: '' }] }))} className={btnGhost}>
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
// Page
// ---------------------------------------------------------------------------

export function BracketAdmin() {
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState('');
  const [event, setEvent] = useState(null);
  const [selectedId, setSelectedId] = useState('');
  const [creating, setCreating] = useState(false);
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
        <a href="/admin/matches" className={btnGhost}>
          Bulk submit / edit matches
        </a>
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
            <Board event={event} selectedId={selectedId} onSelect={setSelectedId} />
          </section>
          {selected ? (
            <div className="max-w-3xl"><SeriesEditor event={event} series={selected} onSaved={() => loadEvent(event.id)} /></div>
          ) : (
            <section className={`${sectionCls} text-sm text-gray-400`}>Pick a series above to add match IDs, VODs or a disqualification.</section>
          )}
        </div>
      ) : null}
    </div>
  );
}
