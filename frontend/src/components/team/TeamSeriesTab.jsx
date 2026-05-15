import React, { useState } from "react";
import { Link } from "react-router-dom";

const formatDuration = (s) => {
  if (!s) return "—";
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

const formatDate = (iso) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
};

/** Group flat match list into series by (event_team_a, event_team_b, event_title, event_week) */
function groupIntoSeries(matches) {
  const map = new Map();
  for (const m of matches) {
    const key = [m.event_team_a, m.event_team_b, m.event_title, m.event_week].join("||");
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(m);
  }
  return Array.from(map.values());
}

function SeriesRow({ team_name, games }) {
  const [open, setOpen] = useState(false);

  const first = games[0];
  const opponent =
    first.event_team_a === team_name ? first.event_team_b : first.event_team_a;

  // Tally series score
  let seriesWins = 0, seriesLosses = 0;
  for (const m of games) {
    const side = m.event_team_a_ingame_side;
    if (side == null || m.winning_team == null) continue;
    const isTeamA = m.event_team_a === team_name;
    const won = isTeamA ? m.winning_team === side : m.winning_team !== side;
    if (won) seriesWins++;
    else seriesLosses++;
  }
  const scored = seriesWins + seriesLosses > 0;
  const seriesWon = scored && seriesWins > seriesLosses;
  const seriesLost = scored && seriesLosses > seriesWins;

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden">
      {/* Accordion header */}
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-4 px-4 py-3 hover:bg-gray-700/50 transition-colors text-left"
      >
        {/* W/L bar */}
        <div
          className={`w-1 self-stretch rounded-full shrink-0 ${
            seriesWon
              ? "bg-green-500"
              : seriesLost
              ? "bg-red-500"
              : "bg-gray-600"
          }`}
        />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-200">
              vs {opponent || "Unknown"}
            </span>
            {scored && (
              <span
                className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  seriesWon
                    ? "bg-green-700/40 text-green-400"
                    : seriesLost
                    ? "bg-red-700/40 text-red-400"
                    : "bg-gray-700 text-gray-400"
                }`}
              >
                {seriesWins}–{seriesLosses}
              </span>
            )}
            <span className="text-xs text-gray-500">
              {games.length} game{games.length !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5">
            {first.event_title && <span>{first.event_title} · </span>}
            {first.event_week != null && <span>Week {first.event_week} · </span>}
            {formatDate(first.start_time)}
          </p>
        </div>

        {/* Chevron */}
        <span className={`text-gray-500 transition-transform shrink-0 ${open ? "rotate-180" : ""}`}>
          ▾
        </span>
      </button>

      {/* Accordion body */}
      {open && (
        <div className="border-t border-gray-700 divide-y divide-gray-700/60">
          {games.map((m) => {
            const side = m.event_team_a_ingame_side;
            let result = null;
            if (side != null && m.winning_team != null) {
              const isTeamA = m.event_team_a === team_name;
              result = isTeamA
                ? m.winning_team === side
                : m.winning_team !== side;
            }
            return (
              <Link
                key={m.match_id}
                to={`/match/${m.match_id}`}
                className="flex items-center gap-4 px-6 py-2.5 hover:bg-gray-700/40 transition-colors"
              >
                <div
                  className={`w-1 h-8 rounded-full shrink-0 ${
                    result === true
                      ? "bg-green-500"
                      : result === false
                      ? "bg-red-500"
                      : "bg-gray-600"
                  }`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {m.event_game && (
                      <span className="text-xs font-medium text-gray-300">
                        {m.event_game}
                      </span>
                    )}
                    {result != null && (
                      <span
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded ${
                          result
                            ? "bg-green-700/40 text-green-400"
                            : "bg-red-700/40 text-red-400"
                        }`}
                      >
                        {result ? "W" : "L"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">
                    {formatDate(m.start_time)} · {formatDuration(m.duration_s)}
                  </p>
                </div>
                <span className="text-xs text-gray-600 shrink-0">
                  #{m.match_id}
                </span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function TeamSeriesTab({ team_name, matches }) {
  const series = groupIntoSeries(matches);

  if (series.length === 0)
    return <p className="text-gray-600 text-sm">No series recorded.</p>;

  return (
    <div className="space-y-2">
      {series.map((games, i) => (
        <SeriesRow key={i} team_name={team_name} games={games} />
      ))}
    </div>
  );
}

export default TeamSeriesTab;
