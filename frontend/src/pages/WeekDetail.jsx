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

  // Deduplicate players per team
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

  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/20 overflow-hidden">
      {/* Series header — team names + score */}
      <div className="grid grid-cols-7 gap-6 px-5 py-4 bg-gray-900/40 border-b border-gray-700/50">
        {seriesVod && (
          <a
            href={seriesVod}
            target="_blank"
            rel="noopener noreferrer"
            title="Series VOD"
            className="justify-self-start self-center text-red-400 hover:text-red-300 transition-colors"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zM8 16V8l8 4-8 4z" />
            </svg>
          </a>
        )}
        <div className="flex items-center gap-3 col-span-5 col-start-2">
          <span className="text-lg font-bold text-gray-100 text-right flex-1 truncate">
            {teamA || "Team A"}
          </span>
          <div className="flex items-center gap-3 shrink-0">
            {teamAWins > 0 || teamBWins > 0 ? (
              <span className="text-xl font-bold text-white tabular-nums">
                {teamAWins} – {teamBWins}
              </span>
            ) : null}
          </div>
          <span className="text-lg font-bold text-gray-100 text-left flex-1 truncate">
            {teamB || "Team B"}
          </span>
        </div>
        {matches.length > 0 && (
          <Link
            to={`/series/${matches[0].match_id}`}
            className="justify-self-end self-center text-xs font-medium text-blue-400 hover:text-blue-300 transition-colors"
          >
            Full details →
          </Link>
        )}
      </div>

      {/* Series winner badge */}
      {seriesWinner && (
        <div className="text-center text-xs font-semibold uppercase tracking-wider py-1 text-green-400 bg-green-400/10">
          {seriesWinner === "a" ? teamA || "Team A" : teamB || "Team B"} wins
        </div>
      )}

      {/* Match list */}
      <div className="divide-y divide-gray-700/30">
        {matches.map((m, i) => {
          const gvod = gameVods?.[String(m.match_id)];
          return (
            <div
              key={m.match_id}
              className="flex items-center gap-3 px-5 py-2.5 hover:bg-gray-700/30 transition-colors"
            >
              <Link
                to={`/match/${m.match_id}`}
                className="flex-1 flex items-center gap-3 min-w-0"
              >
                <span className="text-xs font-medium text-gray-400 w-14 shrink-0">
                  {m.event_game || `Game ${i + 1}`}
                </span>
                <span className="text-xs text-gray-500 w-12 shrink-0">
                  {formatDuration(m.duration_s)}
                </span>
                {m.winning_team != null && (
                  <span className="text-xs font-semibold text-green-400">
                    {m.winning_team === m.event_team_a_ingame_side
                      ? m.event_team_a || "Team A"
                      : m.event_team_b || "Team B"}
                  </span>
                )}
              </Link>
              <span className="text-xs text-gray-600 shrink-0">
                #{m.match_id}
              </span>
            </div>
          );
        })}
      </div>

      {/* Toggle players */}
      {teamAPlayers.length + teamBPlayers.length > 0 && (
        <div className="border-t border-gray-700/40">
          <button
            onClick={() => setShowPlayers((v) => !v)}
            className="w-full flex items-center justify-between px-5 py-2 text-xs text-gray-500 hover:text-gray-300 hover:bg-gray-700/30 transition-colors"
          >
            <span className="font-semibold uppercase tracking-wider">
              Players
            </span>
            <span>{showPlayers ? "▲" : "▼"}</span>
          </button>
          {showPlayers && (
            <div className="grid grid-cols-2 gap-px bg-gray-700/20">
              <div className="bg-gray-800/30 p-3 space-y-1">
                {teamAPlayers.map((p) => (
                  <Link
                    key={p.account_id}
                    to={`/player/${p.account_id}`}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700/40 transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center text-[10px] font-bold text-amber-300 shrink-0">
                      {(p.persona_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-300 truncate hover:underline">
                      {p.persona_name || `Player ${p.account_id}`}
                    </span>
                  </Link>
                ))}
              </div>
              <div className="bg-gray-800/30 p-3 space-y-1">
                {teamBPlayers.map((p) => (
                  <Link
                    key={p.account_id}
                    to={`/player/${p.account_id}`}
                    className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-700/40 transition-colors"
                  >
                    <div className="w-5 h-5 rounded-full bg-blue-500/20 flex items-center justify-center text-[10px] font-bold text-blue-300 shrink-0">
                      {(p.persona_name || "?")[0].toUpperCase()}
                    </div>
                    <span className="text-sm text-gray-300 truncate hover:underline">
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
        <Link
          to="/"
          className="text-sm text-blue-400 hover:underline mb-2 inline-block"
        >
          ← Back
        </Link>
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
