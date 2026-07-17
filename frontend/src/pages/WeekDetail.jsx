import React, { useState, useEffect, useMemo } from "react";
import {
  Link,
  useParams,
  useNavigate,
  useSearchParams,
} from "react-router-dom";

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

function formatDurationShort(s) {
  if (!s) return "—";
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return `${min}:${String(sec).padStart(2, "0")}`;
}

function SeriesBlock({
  teamA,
  teamB,
  matches,
  eventTitle,
  seriesVod,
  gameVods,
}) {
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

  // Deduplicate players per team (merge stats across games)
  const { teamAPlayers, teamBPlayers } = useMemo(() => {
    const aMap = new Map();
    const bMap = new Map();
    for (const m of matches) {
      const side = m.event_team_a_ingame_side;
      for (const p of m.players || []) {
        if (!p.account_id) continue;
        const isTeamA = side != null ? p.team === side : p.team === 0;
        const map = isTeamA ? aMap : bMap;
        if (!map.has(p.account_id)) {
          map.set(p.account_id, { ...p });
        } else {
          // Aggregate stats across games
          const existing = map.get(p.account_id);
          existing.kills = (existing.kills || 0) + (p.kills || 0);
          existing.deaths = (existing.deaths || 0) + (p.deaths || 0);
          existing.assists = (existing.assists || 0) + (p.assists || 0);
          existing.gamesPlayed = (existing.gamesPlayed || 1) + 1;
        }
      }
    }
    return {
      teamAPlayers: [...aMap.values()],
      teamBPlayers: [...bMap.values()],
    };
  }, [matches]);

  // Determine series type label from event_subtitle (e.g. "EU QUALIFIER", "FINALS", "CHALLENGER MATCH")
  const seriesLabel = useMemo(() => {
    const sub = matches[0]?.event_subtitle;
    return sub && sub.trim() ? sub.toUpperCase() : null;
  }, [matches]);

  const isBo = matches.length >= 3 ? "3" : matches.length >= 2 ? "3" : "1";
  const bestOf = matches.length >= 3 ? "BEST OF 3" : matches.length >= 2 ? "BEST OF 3" : "BEST OF 1";

  return (
    <div className="rounded-xl border border-gray-700/50 bg-gray-800/10 overflow-hidden">
      {/* Title badge row */}
      <div className="flex items-center gap-2 px-5 pt-3 pb-1">
        {seriesLabel && (
          <span className="text-[11px] font-bold uppercase tracking-widest text-accent-secondary-light">
            {seriesLabel}
          </span>
        )}
        {matches.length > 1 && (
          <>
            <span className="text-gray-600">·</span>
            <span className="text-[11px] font-bold uppercase tracking-widest text-gray-500">
              {bestOf}
            </span>
          </>
        )}
      </div>

      {/* Series header — team names + score */}
      <div className="flex items-center gap-4 px-5 py-2">
        {/* Team A */}
        <div className="flex-1 text-right">
          <span className={`text-lg font-bold ${seriesWinner === "a" ? "text-green-400" : "text-gray-300"}`}>
            {teamA || "Team A"}
          </span>
        </div>

        {/* Score */}
        <div className="shrink-0 flex items-center gap-2">
          <span className={`text-2xl font-extrabold tabular-nums ${seriesWinner === "a" ? "text-green-400" : "text-gray-400"}`}>
            {teamAWins}
          </span>
          <span className="text-lg text-gray-600 font-light">–</span>
          <span className={`text-2xl font-extrabold tabular-nums ${seriesWinner === "b" ? "text-green-400" : "text-gray-400"}`}>
            {teamBWins}
          </span>
        </div>

        {/* Team B */}
        <div className="flex-1 text-left">
          <span className={`text-lg font-bold ${seriesWinner === "b" ? "text-green-400" : "text-gray-300"}`}>
            {teamB || "Team B"}
          </span>
        </div>
      </div>

      {/* VOD button row */}
      <div className="flex justify-center px-5 pb-2">
        {seriesVod ? (
          <a
            href={seriesVod}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-red-400 bg-red-500/10 border border-red-500/30 rounded-md hover:bg-red-500/20 transition-colors"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM8 16V8l8 4-8 4z" />
            </svg>
            WATCH VOD
          </a>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-gray-600 bg-gray-700/20 border border-gray-700/30 rounded-md cursor-default"
            title="Have a VOD for this match? Message us to submit it!"
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM8 16V8l8 4-8 4z" />
            </svg>
            VOD N/A
          </span>
        )}
      </div>

      {/* Series winner banner */}
      {seriesWinner && (
        <div className="mx-5 mb-2 rounded-md text-center text-xs font-bold uppercase tracking-wider py-1.5 text-green-300 bg-green-500/10 border border-green-500/20">
          {seriesWinner === "a" ? teamA || "Team A" : teamB || "Team B"} WINS
        </div>
      )}

      {/* Match list */}
      <div className="divide-y divide-gray-700/20 border-t border-gray-700/30">
        {matches.map((m, i) => {
          const gvod = gameVods?.[String(m.match_id)];
          const winnerName = m.winning_team != null
            ? (m.winning_team === m.event_team_a_ingame_side
                ? m.event_team_a || "Team A"
                : m.event_team_b || "Team B")
            : null;
          return (
            <Link
              key={m.match_id}
              to={`/match/${m.match_id}`}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-700/20 transition-colors group"
            >
              <span className="text-xs font-semibold text-gray-400 w-16 shrink-0 group-hover:text-gray-300 transition-colors">
                {m.event_game || `Game ${i + 1}`}
              </span>
              <span className="text-xs text-gray-500 tabular-nums w-12 shrink-0">
                {formatDurationShort(m.duration_s)}
              </span>
              {winnerName && (
                <span className="text-xs font-bold text-green-400 flex-1 truncate">
                  {winnerName}
                </span>
              )}
              <span className="text-xs text-gray-600 shrink-0 font-mono">
                #{m.match_id}
              </span>
              {gvod && (
                <a
                  href={gvod}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="text-red-400 hover:text-red-300 transition-colors shrink-0"
                  title="Game VOD"
                >
                  <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM8 16V8l8 4-8 4z" />
                  </svg>
                </a>
              )}
            </Link>
          );
        })}
      </div>

      {/* Toggle players with KDA */}
      {teamAPlayers.length + teamBPlayers.length > 0 && (
        <div className="border-t border-gray-700/40">
          <button
            onClick={() => setShowPlayers((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-700/20 transition-colors"
          >
            <span className="font-semibold uppercase tracking-wider">
              Players
            </span>
            <span>{showPlayers ? "▲" : "▼"}</span>
          </button>
          {showPlayers && (
            <div className="grid grid-cols-2 divide-x divide-gray-700/30">
              {/* Team A */}
              <div className="bg-gray-800/20">
                <div className="px-4 py-2 border-b border-gray-700/20">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    {teamA || "Team A"}
                  </span>
                </div>
                <div className="divide-y divide-gray-700/10">
                  {teamAPlayers.map((p) => (
                    <Link
                      key={p.account_id}
                      to={`/player/${p.account_id}`}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700/30 transition-colors group"
                    >
                      <div className="w-6 h-6 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] font-bold text-amber-300 shrink-0">
                        {(p.persona_name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-300 truncate group-hover:underline">
                          {p.persona_name || `Player ${p.account_id}`}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-gray-400 tabular-nums shrink-0">
                        {p.kills ?? "—"}/{p.deaths ?? "—"}/{p.assists ?? "—"}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
              {/* Team B */}
              <div className="bg-gray-800/20">
                <div className="px-4 py-2 border-b border-gray-700/20">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    {teamB || "Team B"}
                  </span>
                </div>
                <div className="divide-y divide-gray-700/10">
                  {teamBPlayers.map((p) => (
                    <Link
                      key={p.account_id}
                      to={`/player/${p.account_id}`}
                      className="flex items-center gap-2 px-3 py-2 hover:bg-gray-700/30 transition-colors group"
                    >
                      <div className="w-6 h-6 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-300 shrink-0">
                        {(p.persona_name || "?")[0].toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gray-300 truncate group-hover:underline">
                          {p.persona_name || `Player ${p.account_id}`}
                        </div>
                      </div>
                      <div className="text-xs font-semibold text-gray-400 tabular-nums shrink-0">
                        {p.kills ?? "—"}/{p.deaths ?? "—"}/{p.assists ?? "—"}
                      </div>
                    </Link>
                  ))}
                </div>
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
  const [searchParams] = useSearchParams();
  const weekNum = week != null ? parseInt(week, 10) : null;
  const eventTitleParam = (searchParams.get("event_title") || "").trim();
  const eventTitle = eventTitleParam || "Night Shift";

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [availableEvents, setAvailableEvents] = useState([]);

  useEffect(() => {
    if (weekNum == null) {
      fetch(`/db/stats/weekly?event_title=${encodeURIComponent(eventTitle)}`)
        .then((r) => r.json())
        .then((d) => {
          if (Array.isArray(d.available_event_titles)) {
            setAvailableEvents(d.available_event_titles);
          }
          const weeks = d.weeks;
          if (weeks && weeks.length > 0) {
            navigate(
              `/week/${weeks[weeks.length - 1].event_week}?event_title=${encodeURIComponent(eventTitle)}`,
              {
                replace: true,
              },
            );
          }
        })
        .catch(() => {});
      return;
    }
    if (isNaN(weekNum)) return;
    setLoading(true);
    setData(null);
    setError(null);
    fetch(
      `/db/nightshift/${weekNum}?event_title=${encodeURIComponent(eventTitle)}`,
    )
      .then((r) => {
        if (!r.ok) throw new Error(`Week ${weekNum} not found`);
        return r.json();
      })
      .then((payload) => {
        setData(payload);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [weekNum, eventTitle]);

  useEffect(() => {
    fetch(`/db/stats/weekly?event_title=${encodeURIComponent(eventTitle)}`)
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d.available_event_titles)) {
          setAvailableEvents(d.available_event_titles);
        }
      })
      .catch(() => {});
  }, [eventTitle]);

  const series = useMemo(() => {
    if (!data?.matches) return [];
    const map = new Map();
    for (const m of data.matches) {
      const hasTeams = Boolean(m.event_team_a || m.event_team_b);
      const key = hasTeams
        ? `${m.event_team_a ?? ""}__${m.event_team_b ?? ""}`
        : `__match__${m.match_id}`;
      if (!map.has(key))
        map.set(key, {
          teamA: m.event_team_a,
          teamB: m.event_team_b,
          hasTeams,
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

  const { stats, all_weeks, event_title, vod_link, series_vods, game_vods } =
    data;
  const prevWeek = all_weeks
    ? (all_weeks[all_weeks.indexOf(weekNum) - 1] ?? null)
    : null;
  const nextWeek = all_weeks
    ? (all_weeks[all_weeks.indexOf(weekNum) + 1] ?? null)
    : null;

  return (
    <div className="w-full p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white">
              {event_title} <span className="text-gray-400">#{weekNum}</span>
            </h1>
            {stats?.first_match_time && (
              <p className="text-sm text-gray-500 mt-1">
                {formatDate(stats.first_match_time)}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {vod_link && (
              <a
                href={vod_link}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-500/30 rounded-lg hover:bg-red-500/10 transition-colors"
              >
                <svg
                  className="w-3.5 h-3.5"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM8 16V8l8 4-8 4z" />
                </svg>
                VOD
              </a>
            )}
            {availableEvents.length > 0 && (
              <select
                value={event_title || eventTitle}
                onChange={(e) => {
                  const nextEvent = e.target.value;
                  fetch(
                    `/db/stats/weekly?event_title=${encodeURIComponent(nextEvent)}`,
                  )
                    .then((r) => r.json())
                    .then((d) => {
                      const weeks = Array.isArray(d.weeks) ? d.weeks : [];
                      if (weeks.length > 0) {
                        navigate(
                          `/week/${weeks[weeks.length - 1].event_week}?event_title=${encodeURIComponent(nextEvent)}`,
                        );
                      } else {
                        navigate(
                          `/week?event_title=${encodeURIComponent(nextEvent)}`,
                        );
                      }
                    })
                    .catch(() =>
                      navigate(
                        `/week?event_title=${encodeURIComponent(nextEvent)}`,
                      ),
                    );
                }}
                className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-xs text-gray-300"
              >
                {availableEvents.map((et) => (
                  <option key={et} value={et}>
                    {et}
                  </option>
                ))}
              </select>
            )}
          </div>
        </div>
      </div>

      {/* Series list */}
      <div className="space-y-3">
        {series.length === 0 && (
          <p className="text-gray-500 text-sm text-center py-8">
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
            seriesVod={
              s.hasTeams
                ? (series_vods?.[`${s.teamA ?? ""}__${s.teamB ?? ""}`] ?? null)
                : null
            }
            gameVods={game_vods ?? {}}
          />
        ))}
      </div>

      {/* Week navigation */}
      {(prevWeek != null || nextWeek != null) && (
        <div className="flex justify-between mt-8 pt-5 border-t border-gray-700/50">
          {prevWeek != null ? (
            <Link
              to={`/week/${prevWeek}?event_title=${encodeURIComponent(event_title || eventTitle)}`}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              ← Week {prevWeek}
            </Link>
          ) : (
            <span />
          )}
          {nextWeek != null && (
            <Link
              to={`/week/${nextWeek}?event_title=${encodeURIComponent(event_title || eventTitle)}`}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              Week {nextWeek} →
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
