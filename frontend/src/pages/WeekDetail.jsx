import React, { useState, useEffect, useMemo } from "react";
import { Link, useParams, useNavigate } from "react-router-dom";

const formatDuration = (s) => {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
};

function MatchRow({ match }) {
  const teamAName = match.event_team_a || "Team A";
  const teamBName = match.event_team_b || "Team B";
  const winnerSide =
    match.winning_team === 0
      ? "amber"
      : match.winning_team === 1
        ? "sapphire"
        : null;

  return (
    <Link
      to={`/series/${match.match_id}`}
      className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-700/60 bg-gray-800/30 hover:bg-gray-700/50 hover:border-gray-600 transition-all"
    >

      <div className="flex-1 min-w-0 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
        {/* Team A */}
        <span className="text-sm font-semibold truncate text-right text-gray-200">
          {teamAName}
        </span>

        {/* Game label / score centre */}
        <div className="flex flex-col items-center shrink-0">
          {match.event_game && (
            <span className="text-xs text-gray-500">{match.event_game}</span>
          )}
          <span className="text-xs text-gray-600">
            {formatDuration(match.duration_s)}
          </span>
        </div>

        {/* Team B */}
        <span className="text-sm font-semibold truncate text-gray-200">
          {teamBName}
        </span>
      </div>

      <span className="text-xs text-gray-600 shrink-0">#{match.match_id}</span>
    </Link>
  );
}

function SeriesBlock({ teamA, teamB, matches, eventTitle, seriesVod, gameVods }) {
  const [showPlayers, setShowPlayers] = useState(false);

  // Tally series wins per team
  const { teamAWins, teamBWins, seriesWinner } = useMemo(() => {
    let aWins = 0;
    let bWins = 0;
    for (const m of matches) {
      if (m.winning_team == null) continue;
      const teamAIngameSide = m.event_team_a_ingame_side;
      if (teamAIngameSide != null) {
        if (m.winning_team === teamAIngameSide) aWins++;
        else bWins++;
      } else {
        if (m.winning_team === 0) aWins++;
        else bWins++;
      }
    }
    const winner = aWins > bWins ? "a" : bWins > aWins ? "b" : null;
    return { teamAWins: aWins, teamBWins: bWins, seriesWinner: winner };
  }, [matches]);

  // Deduplicate players per team across all games in the series
  const { teamAPlayers, teamBPlayers } = useMemo(() => {
    const aMap = new Map();
    const bMap = new Map();
    for (const m of matches) {
      const side = m.event_team_a_ingame_side;
      for (const p of m.players || []) {
        if (!p.account_id) continue;
        const isTeamA = side != null ? p.team === side : p.team === 0;
        const map = isTeamA ? aMap : bMap;
        if (!map.has(p.account_id)) map.set(p.account_id, p);
      }
    }
    return {
      teamAPlayers: [...aMap.values()],
      teamBPlayers: [...bMap.values()],
    };
  }, [matches]);

  const hasPlayers = teamAPlayers.length > 0 || teamBPlayers.length > 0;
  const seriesDate = matches[0]?.start_time ?? null;
  const hasScore = teamAWins > 0 || teamBWins > 0;

  return (
    <div className="rounded-b-xl border border-gray-700/60 bg-gray-800/20 overflow-hidden">

      {/* Team vs Score row */}
      <div className="bg-input grid grid-cols-[1fr_auto_1fr] mb-4 border-b border-gray-700 overflow-hidden">
        {/* Team A */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-1">
          <Link
            to={`/team/${encodeURIComponent(teamA)}`}
            className="text-3xl font-bold text-white text-stroke-1 [--text-stroke-color:#000] hover:underline decoration-white text-center"
          >
            {teamA}
          </Link>
          {seriesWinner === "a" && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-success border border-success-border px-1.5 py-0.5 rounded">
              Winner
            </span>
          )}
        </div>

        {/* Score */}
        <div className="bg-panel flex items-center justify-center px-6 py-4 border-x border-gray-700">
          {hasScore && (
            <span className="text-xl font-bold text-stroke-1 [--text-stroke-color:#000] text-white tabular-nums">
              {teamAWins} – {teamBWins}
            </span>
          )}
        </div>

        {/* Team B */}
        <div className="flex flex-col items-center justify-center px-4 py-4 gap-1">
          <Link
            to={`/team/${encodeURIComponent(teamB)}`}
            className="text-3xl font-bold text-white text-stroke-1 [--text-stroke-color:#000] hover:underline decoration-white text-center"
          >
            {teamB}
          </Link>
          {seriesWinner === "b" && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-success border border-success-border px-1.5 py-0.5 rounded">
              Winner
            </span>
          )}
        </div>
      </div>

      {/* Game buttons + series VOD */}
      <div className="flex flex-wrap justify-center gap-2 px-4 pb-4">
        {matches.map((m, i) => {
          const gvod = gameVods?.[String(m.match_id)];
          return (
            <div key={m.match_id} className="inline-flex items-center">
              <Link
                to={`/match/${m.match_id}`}
                className={`px-4 py-1.5 text-sm text-gray-300 border border-gray-600 hover:bg-gray-700/60 hover:text-white hover:border-gray-500 transition-all ${gvod ? "rounded-l-lg border-r-0" : "rounded-lg"}`}
              >
                {m.event_game || `Match ${i + 1}`}
              </Link>
              {gvod && (
                <a
                  href={gvod}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Watch VOD"
                  className="px-2 py-1.5 text-red-400 border border-gray-600 rounded-r-lg hover:bg-red-500/10 hover:text-red-300 hover:border-red-500/40 transition-all"
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
                  </svg>
                </a>
              )}
            </div>
          );
        })}
        {seriesVod && (
          <a
            href={seriesVod}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-sm text-red-400 border border-red-500/40 rounded-lg hover:bg-red-500/10 hover:text-red-300 transition-all"
          >
            <svg
              className="w-3.5 h-3.5"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
            </svg>
            VOD
          </a>
        )}
      </div>

      {/* Players accordion */}
      {hasPlayers && (
        <div className="border-t border-gray-700/60">
          <button
            onClick={() => setShowPlayers((v) => !v)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-gray-400 hover:bg-gray-700/40 hover:text-gray-200 transition-all"
          >
            <span className="font-semibold uppercase tracking-wider">
              View Players
            </span>
            <span>{showPlayers ? "▲" : "▼"}</span>
          </button>

          {showPlayers && (
            <div className="grid grid-cols-2 gap-px bg-gray-700/30 border-t border-gray-700/60">
              {/* Team A */}
              <div className="bg-gray-800/40 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-300 uppercase tracking-wider mb-2">
                  {teamA}
                </p>
                {teamAPlayers.map((p) => (
                  <Link
                    key={p.account_id}
                    to={`/player/${p.account_id}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 transition-all"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
                      {(p.persona_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-200 truncate hover:underline">
                      {p.persona_name || `Player ${p.account_id}`}
                    </span>
                  </Link>
                ))}
              </div>

              {/* Team B */}
              <div className="bg-gray-800/40 p-3 space-y-1">
                <p className="text-xs font-semibold text-blue-300 uppercase tracking-wider mb-2">
                  {teamB}
                </p>
                {teamBPlayers.map((p) => (
                  <Link
                    key={p.account_id}
                    to={`/player/${p.account_id}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-700/50 transition-all"
                  >
                    <div className="w-6 h-6 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
                      {(p.persona_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-200 truncate hover:underline">
                      {p.persona_name || `Player ${p.account_id}`}
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function WeekDetail() {
  const { week } = useParams();
  const navigate = useNavigate();
  const weekNum = week != null ? parseInt(week, 10) : null;

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    // No week param — fetch available weeks and redirect to the latest
    if (weekNum == null) {
      fetch("/db/stats/weekly")
        .then((r) => r.json())
        .then((d) => {
          const weeks = d.weeks;
          if (weeks && weeks.length > 0) {
            navigate(`/week/${weeks[weeks.length - 1].event_week}`, {
              replace: true,
            });
          }
        })
        .catch(() => {});
      return;
    }
    if (isNaN(weekNum)) return;
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/db/nightshift/${weekNum}`)
      .then((r) => {
        if (!r.ok) throw new Error(`Week ${weekNum} not found`);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [weekNum]);

  // Group matches into series blocks by team pairing
  const series = useMemo(() => {
    if (!data?.matches) return [];
    const map = new Map();
    for (const m of data.matches) {
      const key = `${m.event_team_a ?? ""}__${m.event_team_b ?? ""}`;
      if (!map.has(key))
        map.set(key, {
          teamA: m.event_team_a,
          teamB: m.event_team_b,
          matches: [],
        });
      map.get(key).matches.push(m);
    }
    return [...map.values()];
  }, [data]);

  if (weekNum == null)
    return <div className="p-8 text-center text-gray-400">Redirecting...</div>;
  if (isNaN(weekNum))
    return <div className="p-8 text-red-400">Invalid week.</div>;
  if (loading)
    return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;
  if (!data) return null;

  const { stats, all_weeks, event_title, vod_link, series_vods, game_vods } = data;
  const prevWeek = all_weeks
    ? (all_weeks[all_weeks.indexOf(weekNum) - 1] ?? null)
    : null;
  const nextWeek = all_weeks
    ? (all_weeks[all_weeks.indexOf(weekNum) + 1] ?? null)
    : null;

  return (
    <div className="w-full p-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-white mb-2">
          {event_title} #{weekNum}
        </h1>
        {stats.first_match_time && (
          <p className="text-sm text-gray-400">
            {formatDate(stats.first_match_time)}
          </p>
        )}
        {vod_link && (
          <a
            href={vod_link}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 text-sm font-medium text-red-400 border border-red-500/40 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
            </svg>
            Watch VOD
          </a>
        )}
      </div>

      {/* Series */}
      <div className="space-y-4">
        {series.length === 0 && (
          <p className="text-gray-600 text-sm">
            No matches recorded for this week.
          </p>
        )}
        {series.map((s, i) => (
          <SeriesBlock
            key={i}
            teamA={s.teamA}
            teamB={s.teamB}
            matches={s.matches}
            eventTitle={event_title}
            seriesVod={series_vods?.[`${s.teamA}__${s.teamB}`] ?? null}
            gameVods={game_vods ?? {}}
          />
        ))}
      </div>

      {/* Week navigation */}
      {(prevWeek != null || nextWeek != null) && (
        <div className="flex justify-between mt-10 pt-6 border-t border-gray-700/50 text-sm">
          {prevWeek != null ? (
            <Link
              to={`/week/${prevWeek}`}
              className="text-gray-400 hover:text-white transition-colors"
            >
              ← Week {prevWeek}
            </Link>
          ) : (
            <span />
          )}
          {nextWeek != null && (
            <Link
              to={`/week/${nextWeek}`}
              className="text-gray-400 hover:text-white transition-colors"
            >
              Week {nextWeek} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
