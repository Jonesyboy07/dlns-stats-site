import React, { useEffect, useMemo, useState } from 'react';

const API_BASE = '';

const emptyMatch = () => ({ match_id: '', winner: '', game: '', skip: false });
const emptySet = () => ({ set_title: '', team_a: '', team_b: '', vod_link: '', region: '', matches: [emptyMatch()] });

const formatDuration = (s) => {
  const num = Number(s);
  if (!Number.isFinite(num) || num <= 0) return '—';
  const mins = Math.floor(num / 60);
  const secs = Math.floor(num % 60);
  return `${mins}:${String(secs).padStart(2, '0')}`;
};

const formatStart = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return '—';
  }
};

const readJsonOrThrow = async (res, fallbackMessage) => {
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    const text = await res.text();
    if (text.toLowerCase().includes('<!doctype') || text.toLowerCase().includes('<html')) {
      throw new Error('Request returned HTML (likely login redirect). Sign in again on this host and retry.');
    }
    throw new Error(text || fallbackMessage);
  }

  const data = await res.json();
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || fallbackMessage);
  }
  return data;
};

export function MatchAdmin() {
  const [mode, setMode] = useState('bulk');

  const [title, setTitle] = useState('Night Shift');
  const [week, setWeek] = useState('');
  const [vodLink, setVodLink] = useState('');
  const [sets, setSets] = useState([emptySet()]);

  const [submitting, setSubmitting] = useState(false);
  const [jobId, setJobId] = useState('');
  const [jobState, setJobState] = useState(null);
  const [error, setError] = useState('');
  const [backfillingNames, setBackfillingNames] = useState(false);
  const [backfillNotice, setBackfillNotice] = useState('');
  const [backfillingItems, setBackfillingItems] = useState(false);
  const [backfillItemsNotice, setBackfillItemsNotice] = useState('');
  const [backfillItemsJobId, setBackfillItemsJobId] = useState(null);
  const [previews, setPreviews] = useState({});

  const [treeLoading, setTreeLoading] = useState(false);
  const [treeError, setTreeError] = useState('');
  const [matchTree, setMatchTree] = useState([]);
  const [expanded, setExpanded] = useState({});
  const [selectedMatchId, setSelectedMatchId] = useState('');
  const [editForm, setEditForm] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [editNotice, setEditNotice] = useState('');

  const totalMatches = useMemo(
    () => sets.reduce((sum, s) => sum + (s.matches?.length || 0), 0),
    [sets],
  );

  const updateSet = (index, updater) => {
    setSets((prev) => prev.map((s, i) => (i === index ? updater(s) : s)));
  };

  const addSet = () => setSets((prev) => [...prev, emptySet()]);

  const removeSet = (index) => {
    setSets((prev) => {
      if (prev.length === 1) return prev;
      return prev.filter((_, i) => i !== index);
    });
    setPreviews((prev) => {
      const next = {};
      Object.entries(prev).forEach(([key, value]) => {
        const [setIdx] = key.split(':').map(Number);
        if (setIdx !== index) next[key] = value;
      });
      return next;
    });
  };

  const addMatchRow = (setIndex) => {
    updateSet(setIndex, (s) => ({ ...s, matches: [...s.matches, emptyMatch()] }));
  };

  const removeMatchRow = (setIndex, matchIndex) => {
    updateSet(setIndex, (s) => {
      if (s.matches.length === 1) return s;
      return { ...s, matches: s.matches.filter((_, i) => i !== matchIndex) };
    });
    setPreviews((prev) => {
      const next = { ...prev };
      delete next[`${setIndex}:${matchIndex}`];
      return next;
    });
  };

  const loadPreview = async (setIndex, matchIndex) => {
    const key = `${setIndex}:${matchIndex}`;
    const rawId = sets?.[setIndex]?.matches?.[matchIndex]?.match_id;
    const matchId = Number(rawId);
    if (!Number.isFinite(matchId)) {
      setPreviews((prev) => ({
        ...prev,
        [key]: { loading: false, error: 'Enter a valid numeric match ID first.', data: null },
      }));
      return;
    }

    setPreviews((prev) => ({ ...prev, [key]: { loading: true, error: '', data: null } }));
    try {
      const res = await fetch(`${API_BASE}/admin/match/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ match_id: matchId }),
      });
      const data = await readJsonOrThrow(res, 'Preview failed');
      setPreviews((prev) => ({
        ...prev,
        [key]: { loading: false, error: '', data: data.preview },
      }));
    } catch (err) {
      setPreviews((prev) => ({
        ...prev,
        [key]: { loading: false, error: err?.message || 'Preview failed', data: null },
      }));
    }
  };

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setJobState(null);

    for (let setIndex = 0; setIndex < sets.length; setIndex += 1) {
      const setItem = sets[setIndex];
      const teamA = (setItem.team_a || '').trim();
      const teamB = (setItem.team_b || '').trim();
      const allowed = new Set(['team a', 'team b', 'a', 'b', teamA.toLowerCase(), teamB.toLowerCase()]);

      for (let matchIndex = 0; matchIndex < (setItem.matches || []).length; matchIndex += 1) {
        const match = setItem.matches[matchIndex];
        const hasMatchId = String(match.match_id || '').trim();
        if (!hasMatchId && !match.skip) continue;

        const winner = (match.winner || '').trim();
        if (!winner) {
          setError(`Set ${setIndex + 1}, match ${matchIndex + 1}: winner is required.`);
          return;
        }

        if (!allowed.has(winner.toLowerCase())) {
          setError(
            `Set ${setIndex + 1}, match ${matchIndex + 1}: winner must be Team A, Team B, A, B, or exact team names (${teamA}/${teamB}).`,
          );
          return;
        }
      }
    }

    const payload = {
      title: title.trim(),
      week: Number(week),
      vod_link: vodLink.trim(),
      sets: sets.map((s) => ({
        set_title: (s.set_title || '').trim(),
        team_a: s.team_a.trim(),
        team_b: s.team_b.trim(),
        vod_link: (s.vod_link || '').trim(),
        region: (s.region || '').trim(),
        matches: s.matches
          .filter((m) => m.skip || String(m.match_id || '').trim())
          .map((m, idx) => ({
            match_id: m.skip && !String(m.match_id || '').trim() ? null : Number(m.match_id),
            winner: m.winner.trim(),
            game: m.game.trim() || `Game ${idx + 1}`,
            skip: m.skip || false,
          })),
      })),
    };

    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/admin/match/bulk-submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      const data = await readJsonOrThrow(res, 'Submit failed');
      setJobId(data.job_id);
      setJobState({ status: 'queued', message: 'Queued' });
    } catch (err) {
      setError(err?.message || 'Submit failed');
    } finally {
      setSubmitting(false);
    }
  };

  const backfillUnknownNames = async () => {
    setBackfillNotice('');
    setBackfillingNames(true);
    try {
      const res = await fetch(`${API_BASE}/admin/match/backfill-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await readJsonOrThrow(res, 'Backfill failed');
      const remaining = Number(data.remaining || 0);
      const updated = Number(data.updated || 0);
      const checked = Number(data.checked || 0);
      setBackfillNotice(`Checked ${checked} accounts, updated ${updated}, remaining ${remaining}.`);
    } catch (err) {
      setBackfillNotice(err?.message || 'Backfill failed');
    } finally {
      setBackfillingNames(false);
    }
  };

  const backfillItems = async () => {
    setBackfillItemsNotice('');
    setBackfillItemsJobId(null);
    setBackfillingItems(true);
    try {
      const res = await fetch(`${API_BASE}/admin/match/backfill-items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await readJsonOrThrow(res, 'Backfill items failed');
      if (!data.job_id) {
        setBackfillItemsNotice(data.message || 'No matches need backfilling.');
        setBackfillingItems(false);
        return;
      }
      setBackfillItemsJobId(data.job_id);
      setBackfillItemsNotice(`Queued — ${data.total} matches to process…`);
    } catch (err) {
      setBackfillItemsNotice(err?.message || 'Backfill items failed');
      setBackfillingItems(false);
    }
  };

  useEffect(() => {
    if (!backfillItemsJobId) return undefined;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/match/job/${backfillItemsJobId}`, { credentials: 'include' });
        const data = await readJsonOrThrow(res, 'Job status failed');
        setBackfillItemsNotice(data.message || '');
        if (data.status === 'done' || data.status === 'error') {
          clearInterval(timer);
          setBackfillingItems(false);
          setBackfillItemsJobId(null);
        }
      } catch { /* ignore polling errors */ }
    }, 2000);
    return () => clearInterval(timer);
  }, [backfillItemsJobId]);

  useEffect(() => {
    if (!jobId) return undefined;

    const timer = setInterval(async () => {
      try {
        const res = await fetch(`${API_BASE}/admin/match/job/${jobId}`, {
          credentials: 'include',
        });
        const data = await readJsonOrThrow(res, 'Job status failed');
        setJobState(data);

        if (data.status === 'done' || data.status === 'error') {
          clearInterval(timer);
        }
      } catch {
        // polling errors are ignored to keep UI responsive while backend recovers
      }
    }, 2000);

    return () => clearInterval(timer);
  }, [jobId]);

  const toggleExpand = (key) => {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const hydrateSelectedFromTree = (seriesList, targetMatchId) => {
    if (!targetMatchId) return;
    for (const series of seriesList) {
      for (const weekNode of series.weeks || []) {
        for (const game of weekNode.games || []) {
          for (const match of game.matches || []) {
            if (String(match.match_id) === String(targetMatchId)) {
              setEditForm({
                match_id: match.match_id,
                series_title: match.context?.series_title || '',
                week: match.context?.week || '',
                vod_link: match.context?.vod_link || '',
                match_vod: match.context?.match_vod || '',
                region: match.context?.region || '',
                team_a: match.context?.team_a || '',
                team_b: match.context?.team_b || '',
                game_label: match.context?.game_label || '',
                set_title: match.context?.set_title || '',
                team_a_side: Number(match.team_a_side ?? 0),
                winner_team: match.winner_team || 'team_a',
              });
              return;
            }
          }
        }
      }
    }
  };

  const loadMatchTree = async () => {
    setTreeLoading(true);
    setTreeError('');
    try {
      const res = await fetch(`${API_BASE}/admin/match/tree`, { credentials: 'include' });
      const data = await readJsonOrThrow(res, 'Failed to load match tree');
      const seriesList = data.series || [];
      setMatchTree(seriesList);
      hydrateSelectedFromTree(seriesList, selectedMatchId);
    } catch (err) {
      setTreeError(err?.message || 'Failed to load match tree');
    } finally {
      setTreeLoading(false);
    }
  };

  useEffect(() => {
    if (mode === 'edit') loadMatchTree();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const selectMatch = (match) => {
    setSelectedMatchId(String(match.match_id));
    setEditNotice('');
    setEditForm({
      match_id: match.match_id,
      series_title: match.context?.series_title || '',
      week: match.context?.week || '',
      vod_link: match.context?.vod_link || '',
      match_vod: match.context?.match_vod || '',
      region: match.context?.region || '',
      team_a: match.context?.team_a || '',
      team_b: match.context?.team_b || '',
      game_label: match.context?.game_label || '',
      set_title: match.context?.set_title || '',
      team_a_side: Number(match.team_a_side ?? 0),
      winner_team: match.winner_team || 'team_a',
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm) return;
    setEditSaving(true);
    setEditNotice('');
    try {
      const res = await fetch(`${API_BASE}/admin/match/edit`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          ...editForm,
          match_id: Number(editForm.match_id),
          week: Number(editForm.week),
          team_a_side: Number(editForm.team_a_side),
          winner_team: editForm.winner_team,
          set_title: editForm.set_title || '',
        }),
      });
      const data = await readJsonOrThrow(res, 'Failed to save match edit');
      setEditNotice(`Saved changes for match ${data.updated?.match_id || editForm.match_id}.`);
      await loadMatchTree();
    } catch (err) {
      setEditNotice(err?.message || 'Failed to save match edit');
    } finally {
      setEditSaving(false);
    }
  };

  const renderBulkSubmit = () => (
    <>
      <div>
        <h1 className="text-2xl font-bold text-white">Bulk Match Submit</h1>
        <p className="text-sm text-gray-400 mt-1">
          Build an event week, add sets, then enter all matches at once.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={backfillUnknownNames}
            disabled={backfillingNames}
            className="text-xs px-3 py-2 rounded border border-amber-500/50 text-amber-200 hover:bg-amber-700/20 disabled:opacity-50"
          >
            {backfillingNames ? 'Backfilling Names...' : 'Backfill Unknown Names'}
          </button>
          <button
            type="button"
            onClick={backfillItems}
            disabled={backfillingItems}
            className="text-xs px-3 py-2 rounded border border-blue-500/50 text-blue-200 hover:bg-blue-700/20 disabled:opacity-50"
          >
            {backfillingItems ? 'Backfilling Items…' : 'Backfill Missing Items'}
          </button>
          {backfillNotice && (
            <div className="text-xs rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2 text-gray-200">
              {backfillNotice}
            </div>
          )}
          {backfillItemsNotice && (
            <div className="text-xs rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2 text-gray-200">
              {backfillItemsNotice}
            </div>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-6">
        <section className="rounded-xl border border-gray-700/60 bg-gray-800/20 p-4 md:p-5 space-y-4">
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Event Details</h2>
          <div className="grid md:grid-cols-3 gap-3">
            <label className="space-y-1 text-sm">
              <span className="text-gray-300">Title</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                placeholder="Night Shift"
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-300">Week</span>
              <input
                type="number"
                value={week}
                onChange={(e) => setWeek(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                placeholder="34"
                required
              />
            </label>
            <label className="space-y-1 text-sm">
              <span className="text-gray-300">VOD Link (optional)</span>
              <input
                value={vodLink}
                onChange={(e) => setVodLink(e.target.value)}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                placeholder="https://..."
              />
            </label>
          </div>
        </section>

        {sets.map((setItem, setIndex) => (
          <section key={setIndex} className="rounded-xl border border-gray-700/60 bg-gray-800/20 p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Set {setIndex + 1}</h2>
              <button
                type="button"
                onClick={() => removeSet(setIndex)}
                className="text-xs px-2 py-1 rounded border border-red-600/40 text-red-300 hover:bg-red-700/20"
              >
                Remove Set
              </button>
            </div>

            <div className="grid md:grid-cols-2 gap-3">
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-gray-300">Set Title <span className="text-gray-500 font-normal">(optional)</span></span>
                <input
                  value={setItem.set_title || ''}
                  onChange={(e) => updateSet(setIndex, (s) => ({ ...s, set_title: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  placeholder="e.g. Grand Finals"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-gray-300">Team A</span>
                <input
                  value={setItem.team_a}
                  onChange={(e) => updateSet(setIndex, (s) => ({ ...s, team_a: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  placeholder="Team A"
                  required
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-gray-300">Team B</span>
                <input
                  value={setItem.team_b}
                  onChange={(e) => updateSet(setIndex, (s) => ({ ...s, team_b: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  placeholder="Team B"
                  required
                />
              </label>
              <label className="space-y-1 text-sm md:col-span-2">
                <span className="text-gray-300">Set VOD Link (optional)</span>
                <input
                  value={setItem.vod_link || ''}
                  onChange={(e) => updateSet(setIndex, (s) => ({ ...s, vod_link: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  placeholder="https://..."
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-gray-300">Region <span className="text-gray-500 font-normal">(optional)</span></span>
                <select
                  value={setItem.region || ''}
                  onChange={(e) => updateSet(setIndex, (s) => ({ ...s, region: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                >
                  <option value="">—</option>
                  <option value="NA">NA</option>
                  <option value="EU">EU</option>
                </select>
              </label>
            </div>

            <div className="space-y-2">
              {setItem.matches.map((match, matchIndex) => (
                <div key={matchIndex} className={`rounded-lg border p-3 space-y-3 ${match.skip ? 'border-yellow-700/50 bg-yellow-900/10' : 'border-gray-700/60 bg-gray-900/40'}`}>
                  <div className="grid md:grid-cols-12 gap-2 items-end">
                    <label className="md:col-span-4 space-y-1 text-sm">
                      <span className="text-gray-300">Match ID</span>
                      <input
                        value={match.match_id}
                        onChange={(e) => updateSet(setIndex, (s) => ({
                          ...s,
                          matches: s.matches.map((m, i) => (i === matchIndex ? { ...m, match_id: e.target.value } : m)),
                        }))}
                        className={`w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white ${match.skip ? 'opacity-50' : ''}`}
                        placeholder={match.skip ? 'N/A — no ID' : '75968492'}
                        required={!match.skip}
                      />
                    </label>
                    <label className="md:col-span-4 space-y-1 text-sm">
                      <span className="text-gray-300">{match.skip ? <span className="text-yellow-400">Winner (N/A match)</span> : 'Winner (required)'}</span>
                      <select
                        value={match.winner}
                        onChange={(e) => updateSet(setIndex, (s) => ({
                          ...s,
                          matches: s.matches.map((m, i) => (i === matchIndex ? { ...m, winner: e.target.value } : m)),
                        }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                        required
                      >
                        <option value="" className="text-gray-500">Select winner</option>
                        <option value="Team A">Team A{setItem.team_a ? ` (${setItem.team_a})` : ''}</option>
                        <option value="Team B">Team B{setItem.team_b ? ` (${setItem.team_b})` : ''}</option>
                      </select>
                    </label>
                    <label className="md:col-span-3 space-y-1 text-sm">
                      <span className="text-gray-300">Game Label</span>
                      <input
                        value={match.game}
                        onChange={(e) => updateSet(setIndex, (s) => ({
                          ...s,
                          matches: s.matches.map((m, i) => (i === matchIndex ? { ...m, game: e.target.value } : m)),
                        }))}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                        placeholder={`Game ${matchIndex + 1}`}
                      />
                    </label>
                    <div className="md:col-span-1 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => loadPreview(setIndex, matchIndex)}
                        className="text-xs px-2 py-2 rounded border border-indigo-500/40 text-indigo-300 hover:bg-indigo-700/20"
                        title="Load preview"
                      >
                        Preview
                      </button>
                      <button
                        type="button"
                        onClick={() => updateSet(setIndex, (s) => ({
                          ...s,
                          matches: s.matches.map((m, i) => (i === matchIndex ? { ...m, skip: !m.skip } : m)),
                        }))}
                        className={`text-xs px-2 py-2 rounded border ${match.skip ? 'border-yellow-500/60 bg-yellow-900/30 text-yellow-300' : 'border-yellow-700/40 text-yellow-600 hover:bg-yellow-900/20'}`}
                        title={match.skip ? 'Mark as fetchable' : 'Mark as N/A (skip API fetch)'}
                      >
                        N/A
                      </button>
                      <button
                        type="button"
                        onClick={() => removeMatchRow(setIndex, matchIndex)}
                        className="text-xs px-2 py-2 rounded border border-red-600/40 text-red-300 hover:bg-red-700/20"
                        title="Remove match"
                      >
                        X
                      </button>
                    </div>
                  </div>

                  {(() => {
                    const key = `${setIndex}:${matchIndex}`;
                    const preview = previews[key];
                    if (!preview) return null;
                    if (preview.loading) {
                      return <div className="text-xs text-blue-300">Loading preview...</div>;
                    }
                    if (preview.error) {
                      return (
                        <div className="text-xs text-red-300 bg-red-900/20 border border-red-700/40 rounded px-3 py-2">
                          {preview.error}
                        </div>
                      );
                    }
                    if (!preview.data) return null;

                    const p = preview.data;
                    const winnerLabel =
                      p.winning_team === 0 ? 'Amber' : p.winning_team === 1 ? 'Sapphire' : 'Unknown';
                    const amberCount = (p.players || []).filter((pl) => pl.team === 0).length;
                    const sapphireCount = (p.players || []).filter((pl) => pl.team === 1).length;

                    return (
                      <div className="text-xs rounded border border-emerald-600/30 bg-emerald-900/10 px-3 py-2">
                        <div className="text-emerald-200 font-semibold mb-1">Preview</div>
                        <div className="grid md:grid-cols-4 gap-2 text-gray-200">
                          <div>Match: <span className="text-white">{p.match_id}</span></div>
                          <div>Winner: <span className="text-white">{winnerLabel}</span></div>
                          <div>Duration: <span className="text-white">{formatDuration(p.duration_s)}</span></div>
                          <div>Start: <span className="text-white">{formatStart(p.start_time)}</span></div>
                        </div>
                        <div className="mt-1 text-gray-300">
                          Players: Amber {amberCount} / Sapphire {sapphireCount}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => addMatchRow(setIndex)}
              className="text-xs px-3 py-2 rounded border border-blue-500/40 text-blue-300 hover:bg-blue-600/20"
            >
              + Add Match
            </button>
          </section>
        ))}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={addSet}
            className="px-3 py-2 rounded-lg border border-emerald-500/40 text-emerald-300 hover:bg-emerald-600/20"
          >
            + Add Set
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : `Submit ${totalMatches} Matches`}
          </button>
        </div>
      </form>

      {error && (
        <div className="rounded-lg border border-red-600/40 bg-red-900/20 text-red-300 px-4 py-3 text-sm">
          {error}
        </div>
      )}

      {jobState && (
        <div className="rounded-lg border border-gray-700 bg-gray-900/40 px-4 py-3 text-sm">
          <div className="font-semibold text-white">Job Status: {jobState.status}</div>
          <div className="text-gray-300 mt-1">{jobState.message}</div>
        </div>
      )}
    </>
  );

  const renderEditMode = () => (
    <>
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Match Editor</h1>
          <p className="text-sm text-gray-400 mt-1">
            Select a match from the nested sidebar, then edit in the main panel.
          </p>
        </div>
        <button
          type="button"
          onClick={loadMatchTree}
          className="text-xs px-3 py-2 rounded border border-blue-500/40 text-blue-300 hover:bg-blue-600/20"
        >
          Refresh Tree
        </button>
      </div>

      <div className="grid md:grid-cols-12 gap-4">
        <aside className="md:col-span-4 rounded-xl border border-gray-700/60 bg-gray-800/20 p-3 max-h-[70vh] overflow-auto">
          {treeLoading && <div className="text-sm text-gray-300">Loading match tree...</div>}
          {treeError && <div className="text-sm text-red-300">{treeError}</div>}
          {!treeLoading && !treeError && matchTree.length === 0 && (
            <div className="text-sm text-gray-400">No series found in matches.json.</div>
          )}

          <div className="space-y-2">
            {matchTree.map((series, si) => {
              const sKey = `s-${si}-${series.title}`;
              const sOpen = expanded[sKey] !== false;
              return (
                <div key={sKey} className="border border-gray-700/50 rounded-lg">
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm font-semibold text-white bg-gray-900/50"
                    onClick={() => toggleExpand(sKey)}
                  >
                    {sOpen ? '▾' : '▸'} {series.title || 'Untitled Series'}
                  </button>
                  {sOpen && (
                    <div className="p-2 space-y-2">
                      {(series.weeks || []).map((weekNode, wi) => {
                        const wKey = `${sKey}-w-${wi}-${weekNode.week}`;
                        const wOpen = expanded[wKey] !== false;
                        return (
                          <div key={wKey} className="border border-gray-700/40 rounded">
                            <button
                              type="button"
                              className="w-full text-left px-2 py-1 text-xs text-gray-200 bg-gray-900/30"
                              onClick={() => toggleExpand(wKey)}
                            >
                              {wOpen ? '▾' : '▸'} Week {weekNode.week}
                            </button>
                            {wOpen && (
                              <div className="p-1 space-y-1">
                                {(weekNode.games || []).map((game, gi) => {
                                  const gKey = `${wKey}-g-${gi}`;
                                  const gOpen = expanded[gKey] !== false;
                                  return (
                                    <div key={gKey} className="border border-gray-700/30 rounded">
                                      <button
                                        type="button"
                                        className="w-full text-left px-2 py-1 text-xs text-gray-300 bg-gray-900/20"
                                        onClick={() => toggleExpand(gKey)}
                                      >
                                        {gOpen ? '▾' : '▸'} {game.team_a} vs {game.team_b}
                                      </button>
                                      {gOpen && (
                                        <div className="p-1 space-y-1">
                                          {(game.matches || []).map((match) => {
                                            const selected = String(selectedMatchId) === String(match.match_id);
                                            return (
                                              <button
                                                key={match.match_id}
                                                type="button"
                                                onClick={() => selectMatch(match)}
                                                className={`w-full text-left px-2 py-1 rounded text-xs border ${
                                                  selected
                                                    ? 'bg-blue-900/40 border-blue-500/50 text-blue-200'
                                                    : 'bg-gray-900/30 border-gray-700/40 text-gray-300 hover:bg-gray-900/50'
                                                }`}
                                              >
                                                #{match.match_id} - {match.game}
                                              </button>
                                            );
                                          })}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </aside>

        <section className="md:col-span-8 rounded-xl border border-gray-700/60 bg-gray-800/20 p-4 md:p-5">
          {!editForm && <div className="text-sm text-gray-400">Select a match from the sidebar to edit.</div>}

          {editForm && (
            <form onSubmit={saveEdit} className="space-y-4">
              <div className="text-xs text-gray-400">Editing match #{editForm.match_id}</div>
              <div className="grid md:grid-cols-2 gap-3">
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Series Title</span>
                  <input
                    value={editForm.series_title}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, series_title: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Week</span>
                  <input
                    type="number"
                    value={editForm.week}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, week: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="text-gray-300">VOD Link <span className="text-gray-500 font-normal">(week-level)</span></span>
                  <input
                    value={editForm.vod_link}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, vod_link: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    placeholder="https://..."
                  />
                </label>
                <label className="space-y-1 text-sm md:col-span-2">
                  <span className="text-gray-300">Match VOD <span className="text-gray-500 font-normal">(game-level)</span></span>
                  <input
                    value={editForm.match_vod}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, match_vod: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    placeholder="https://..."
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Region <span className="text-gray-500 font-normal">(optional)</span></span>
                  <select
                    value={editForm.region || ''}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, region: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="">—</option>
                    <option value="NA">NA</option>
                    <option value="EU">EU</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Team A</span>
                  <input
                    value={editForm.team_a}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, team_a: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Team B</span>
                  <input
                    value={editForm.team_b}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, team_b: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Game Label</span>
                  <input
                    value={editForm.game_label}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, game_label: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    required
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Set Title <span className="text-gray-500 font-normal">(optional)</span></span>
                  <input
                    value={editForm.set_title || ''}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, set_title: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                    placeholder="e.g. Upper Bracket"
                  />
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Team A Side</span>
                  <select
                    value={String(editForm.team_a_side)}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, team_a_side: Number(e.target.value) }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="0">Amber (0)</option>
                    <option value="1">Sapphire (1)</option>
                  </select>
                </label>
                <label className="space-y-1 text-sm">
                  <span className="text-gray-300">Winner</span>
                  <select
                    value={editForm.winner_team || 'team_a'}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, winner_team: e.target.value }))}
                    className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white"
                  >
                    <option value="team_a">Team A ({editForm.team_a || 'Team A'})</option>
                    <option value="team_b">Team B ({editForm.team_b || 'Team B'})</option>
                  </select>
                </label>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="submit"
                  disabled={editSaving}
                  className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
                >
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>

              {editNotice && (
                <div className="rounded border border-gray-700/60 bg-gray-900/40 px-3 py-2 text-sm text-gray-200">
                  {editNotice}
                </div>
              )}
            </form>
          )}
        </section>
      </div>
    </>
  );

  return (
    <div className="w-full max-w-5xl mx-auto p-6 md:p-8 space-y-6">
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Admin</p>
        <div className="flex flex-wrap gap-2 mt-2">
          <button
            type="button"
            onClick={() => setMode('bulk')}
            className={`px-3 py-2 rounded-lg border text-sm ${
              mode === 'bulk'
                ? 'border-blue-500/70 bg-blue-900/30 text-blue-200'
                : 'border-gray-700 text-gray-300 hover:bg-gray-800/40'
            }`}
          >
            Bulk Submit
          </button>
          <button
            type="button"
            onClick={() => setMode('edit')}
            className={`px-3 py-2 rounded-lg border text-sm ${
              mode === 'edit'
                ? 'border-blue-500/70 bg-blue-900/30 text-blue-200'
                : 'border-gray-700 text-gray-300 hover:bg-gray-800/40'
            }`}
          >
            Edit Matches
          </button>
        </div>
      </div>

      {mode === 'bulk' ? renderBulkSubmit() : renderEditMode()}
    </div>
  );
}
