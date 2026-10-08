import React, { useEffect, useMemo, useState } from 'react';
import { api, Board, formatDuration, formatStart, useHeroes } from './BracketAdmin.jsx';
import HeroIcon from '../components/HeroIcon.jsx';

const sectionCls = 'rounded-xl border border-gray-700/60 bg-gray-800/20 p-4 md:p-5 space-y-4';
const btnGhost = 'text-xs px-3 py-2 rounded border border-gray-600 text-gray-200 hover:bg-gray-700/40';

const STATUS_STYLES = {
  done: 'bg-emerald-900/50 text-emerald-200',
  live: 'bg-sky-900/50 text-sky-200',
  dq: 'bg-orange-900/50 text-orange-200',
  bye: 'bg-gray-700/60 text-gray-300',
  pending: 'bg-gray-700/60 text-gray-400',
};

const FORMAT_NAMES = { gauntlet: 'Gauntlet', single_elim: 'Single elimination' };

const eventFromUrl = () => {
  try {
    return new URLSearchParams(window.location.search).get('event') || '';
  } catch {
    return '';
  }
};

const teamName = (series, slot) => series[slot] || (slot === 'team_a' ? 'Team A' : 'Team B');

// Games after a DQ (or every game, when played games are voided) don't count.
const isVoided = (outcome, gameNo) =>
  outcome?.type === 'dq' && (outcome.played_games === 'void' || gameNo > Number(outcome.after_game || 0));

function BanLine({ bans, series, heroes, roundBased }) {
  const groups = roundBased
    ? [
        { label: 'Round 1', bans: bans.filter((b) => b.order <= 2) },
        { label: 'Round 2', bans: bans.filter((b) => b.order > 2) },
      ].filter((group) => group.bans.length)
    : [{ label: 'Bans', bans }];
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-300">
      {groups.map((group) => (
        <div key={group.label} className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-gray-500 uppercase tracking-wider">{group.label}</span>
          {group.bans.map((b) => {
            const name = heroes[b.hero_id] || `Hero ${b.hero_id}`;
            return (
              <span key={b.order} className="flex items-center gap-1" title={`Ban ${b.order}: ${teamName(series, b.team)} banned ${name}`}>
                <span className="font-mono text-gray-500">{b.order}.</span>
                <HeroIcon name={heroes[b.hero_id]} size="h-5 w-5" />
                <span>{name}</span>
                <span className={b.team === 'team_a' ? 'text-sky-300' : 'text-rose-300'}>({teamName(series, b.team)})</span>
              </span>
            );
          })}
        </div>
      ))}
    </div>
  );
}

function GamesTable({ series, heroes, roundBased }) {
  const games = series.games || [];
  if (!games.length) return <p className="text-xs text-gray-500">No games entered yet.</p>;
  return (
    <div className="scroll-thin overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wider text-gray-500">
            <th className="py-1 pr-3 font-normal">Game</th>
            <th className="py-1 pr-3 font-normal">Match ID</th>
            <th className="py-1 pr-3 font-normal">Winner</th>
            <th className="py-1 pr-3 font-normal">In stats</th>
            <th className="py-1 pr-3 font-normal">Length</th>
            <th className="py-1 pr-3 font-normal">Played</th>
            <th className="py-1 font-normal">VOD</th>
          </tr>
        </thead>
        <tbody>
          {games.map((g, i) => {
            const voided = isVoided(series.outcome, i + 1);
            // The stored pick and the stats DB should agree; flag it if they don't.
            const mismatch = g.winner && g.result && g.winner !== g.result;
            return (
              <React.Fragment key={i}>
              <tr className={`border-t border-gray-700/50 ${voided ? 'opacity-50' : ''}`}>
                <td className="py-1.5 pr-3 font-mono text-gray-300">
                  {i + 1}
                  {voided && <span className="ml-1 text-[11px] text-orange-300">void</span>}
                </td>
                <td className="py-1.5 pr-3 font-mono">
                  {g.forfeit ? (
                    <span className="text-gray-400">Forfeit</span>
                  ) : g.unavailable ? (
                    <span className="text-yellow-300" title="Private or unfetchable: counted from the winner pick only">
                      N/A{g.match_id ? ` · ${g.match_id}` : ''}
                    </span>
                  ) : g.match_id ? (
                    <a href={`/match/${g.match_id}`} className="text-emerald-300 hover:underline">
                      {g.match_id}
                    </a>
                  ) : (
                    <span className="text-gray-500">none</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 text-gray-100">
                  {g.winner ? teamName(series, g.winner) : <span className="text-gray-500">not picked</span>}
                  {mismatch && (
                    <div className="text-[11px] text-amber-300">Stats say {teamName(series, g.result)} won</div>
                  )}
                </td>
                <td className="py-1.5 pr-3">
                  {g.ingested ? (
                    <span className="text-emerald-300">{g.forfeit || g.unavailable ? 'Result only' : 'Yes'}</span>
                  ) : (
                    <span className="text-amber-300">Not yet</span>
                  )}
                </td>
                <td className="py-1.5 pr-3 font-mono text-gray-300">{formatDuration(g.duration_s) || '-'}</td>
                <td className="py-1.5 pr-3 text-gray-300 whitespace-nowrap">{(!g.forfeit && !g.unavailable && formatStart(g.start_time)) || '-'}</td>
                <td className="py-1.5">
                  {g.vod ? (
                    <a href={g.vod} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline">
                      Link
                    </a>
                  ) : (
                    <span className="text-gray-500">-</span>
                  )}
                </td>
              </tr>
              {g.bans?.length > 0 && (
                <tr className={voided ? 'opacity-50' : ''}>
                  <td />
                  <td colSpan={6} className="pb-1.5">
                    <BanLine bans={g.bans} series={series} heroes={heroes} roundBased={roundBased} />
                  </td>
                </tr>
              )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SeriesDetail({ series, roundName, heroes, roundBased }) {
  const dq = series.outcome?.type === 'dq' ? series.outcome : null;
  const scoreless = series.status === 'pending' || series.status === 'bye';
  return (
    <section id={`series-${series.id}`} className={`${sectionCls} scroll-mt-4`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-white">
          {roundName} · <span className="font-mono text-gray-400">{series.id}</span>
        </h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="px-2 py-0.5 rounded bg-gray-700/60 text-gray-200">Bo{series.best_of}</span>
          <span className={`px-2 py-0.5 rounded ${STATUS_STYLES[series.status] || STATUS_STYLES.pending}`}>{series.status}</span>
        </div>
      </div>

      <div className="flex flex-wrap items-baseline gap-3 text-lg">
        <span className={series.winner === 'team_a' ? 'font-bold text-white' : 'text-gray-300'}>{series.team_a || 'TBD'}</span>
        <span className="font-mono text-gray-400">
          {scoreless ? 'vs' : `${series.score_a} - ${series.score_b}`}
        </span>
        <span className={series.winner === 'team_b' ? 'font-bold text-white' : 'text-gray-300'}>{series.team_b || 'TBD'}</span>
        {series.winner_name && <span className="text-sm text-emerald-300">{series.winner_name} advance</span>}
      </div>

      {dq && (
        <div className="text-sm rounded border-l-2 border-orange-400 bg-orange-900/20 px-3 py-2 text-orange-100">
          {teamName(series, dq.team)} disqualified after game {dq.after_game}
          {dq.reason ? `: ${dq.reason}` : ''}. Played games {dq.played_games === 'void' ? 'voided' : 'kept in stats'}.
        </div>
      )}

      {series.vod && (
        <div className="text-sm">
          <span className="text-gray-400">Series VOD: </span>
          <a href={series.vod} target="_blank" rel="noreferrer" className="text-emerald-300 hover:underline break-all">
            {series.vod}
          </a>
        </div>
      )}

      <GamesTable series={series} heroes={heroes} roundBased={roundBased} />
    </section>
  );
}

export function BracketView() {
  const { heroes } = useHeroes();
  const [events, setEvents] = useState([]);
  const [eventId, setEventId] = useState(eventFromUrl);
  const [event, setEvent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/events', {}, 'Failed to load events')
      .then((data) => {
        setEvents(data.events);
        setEventId((cur) => (data.events.some((e) => e.id === cur) ? cur : data.events[0]?.id || ''));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (!eventId) {
      setEvent(null);
      return;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('event', eventId);
      window.history.replaceState(null, '', url);
    } catch {
      // URL sync is a convenience only
    }
    api(`/events/${encodeURIComponent(eventId)}`, {}, 'Failed to load event')
      .then((data) => setEvent(data.event))
      .catch((err) => setError(err.message));
  }, [eventId]);

  const roundNames = useMemo(
    () => Object.fromEntries((event?.rounds || []).map((r) => [r.round, r.name])),
    [event],
  );
  // The series nothing feeds out of is the final; its winner is the champion.
  const final = event?.series?.find((s) => !s.winner_to);
  const seriesByRound = useMemo(
    () => [...(event?.series || [])].sort((a, b) => b.round - a.round || a.id.localeCompare(b.id, undefined, { numeric: true })),
    [event],
  );

  const jumpTo = (id) => document.getElementById(`series-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">Submitted brackets</h1>
          <p className="text-sm text-gray-400 mt-1">Read-only view of each event, its series and the games saved to them.</p>
        </div>
        <a href="/admin/brackets/" className={btnGhost}>
          Edit brackets
        </a>
      </div>

      {error && <div className="text-sm text-red-300 rounded border border-red-500/40 px-3 py-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !events.length ? (
        <section className={`${sectionCls} text-sm text-gray-400`}>
          No events yet. <a href="/admin/brackets/" className="text-emerald-300 hover:underline">Create one</a>.
        </section>
      ) : (
        <select
          id="view-event-pick"
          value={eventId}
          onChange={(e) => setEventId(e.target.value)}
          className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-white text-sm"
        >
          {events.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
              {e.week != null ? ` · Week ${e.week}` : ''}
              {e.region ? ` · ${e.region}` : ''}
            </option>
          ))}
        </select>
      )}

      {event && (
        <>
          <section className={sectionCls}>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold text-white">
                {event.title}
                {event.week != null ? ` · Week ${event.week}` : ''}
                {event.region ? ` · ${event.region}` : ''}
              </h2>
              <span className="text-xs text-gray-400">{FORMAT_NAMES[event.format] || event.format}</span>
            </div>
            {final?.winner_name && (
              <p className="text-sm text-emerald-300">
                Champion: <b>{final.winner_name}</b>
              </p>
            )}
            <p className="text-xs text-gray-400">Click a series to jump to its games.</p>
            <Board event={event} selectedId="" onSelect={jumpTo} />
          </section>

          <div className="space-y-4">
            {seriesByRound.map((s) => (
              <SeriesDetail
                key={s.id}
                series={s}
                heroes={heroes}
                roundBased={(s.ban_pattern || event.ban_pattern) === 'ROUND'}
                roundName={roundNames[s.round] || `Round ${s.round}`}
              />
            ))}
          </div>

          <details className={sectionCls}>
            <summary className="cursor-pointer text-sm text-gray-300">Raw data (as computed from brackets.json and the DB)</summary>
            <pre className="scroll-thin text-xs text-gray-300 overflow-x-auto max-h-[32rem]">{JSON.stringify(event, null, 2)}</pre>
          </details>
        </>
      )}
    </div>
  );
}
