import React from "react";
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

function TeamMatchesTab({ team_name, matches }) {
  return (
    <div>
      <div className="space-y-2">
        {matches.length === 0 && (
          <p className="text-gray-600 text-sm">No matches recorded.</p>
        )}
        {matches.map((m) => {
          const opponent =
            m.event_team_a === team_name ? m.event_team_b : m.event_team_a;
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
              className="flex items-center gap-4 px-4 py-3 rounded-lg border border-gray-700 bg-gray-800/40 hover:bg-gray-700/50 hover:border-gray-600 transition-all"
            >
              {/* W/L colour bar */}
              <div
                className={`w-1 h-10 rounded-full shrink-0 ${
                  result === true
                    ? "bg-green-500"
                    : result === false
                    ? "bg-red-500"
                    : "bg-gray-600"
                }`}
              />

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-gray-200">
                    vs {opponent || "Unknown"}
                  </span>
                  {m.event_game && (
                    <span className="text-xs text-gray-500">
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
                <p className="text-xs text-gray-500 mt-0.5">
                  {m.event_title && <span>{m.event_title} · </span>}
                  {m.event_week != null && (
                    <span>Week {m.event_week} · </span>
                  )}
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
    </div>
  );
}

export default TeamMatchesTab;
