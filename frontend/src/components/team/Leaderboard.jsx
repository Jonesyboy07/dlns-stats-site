import React, { useState } from "react";
import PlayerAvatar from "../PlayerAvatar";
import { formatCompact, formatKda } from "../../utils/format";

/** Metrics offered by the segmented control, in tab order. */
const METRICS = [
  { key: "kda", label: "KDA", baselineKey: "kda", format: formatKda },
  { key: "nw_per_game", label: "Net worth", baselineKey: "net_worth", format: formatCompact },
  { key: "dmg_per_game", label: "Damage", baselineKey: "damage", format: formatCompact },
];

function LeaderboardBar({ value, max, ratioLabel, muted = false }) {
  const width = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;

  return (
    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-gray-700/70">
      <div
        title={ratioLabel}
        className={`h-full rounded-full ${muted ? "bg-gray-500" : "bg-purple-500"}`}
        style={{ width: `${width}%` }}
      />
    </div>
  );
}

/**
 * Roster leaderboard: pick a metric, see the roster ranked with a league
 * average baseline pinned at the bottom.
 */
function Leaderboard({ players = [], league }) {
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  const scored = players
    .map((player) => ({ player, value: player[metric.key] }))
    .filter((row) => row.value != null);

  const baseline = league?.[metric.baselineKey];
  const hasBaseline = baseline != null;
  const max = Math.max(
    ...scored.map((row) => row.value),
    hasBaseline ? baseline : 0,
    0,
  );

  return (
    <section className="space-y-3">
      <header className="flex items-start justify-between gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Leaderboard
        </h2>
        <div className="flex shrink-0 gap-0.5 rounded-lg border border-gray-700/60 bg-gray-800/40 p-0.5">
          {METRICS.map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setMetricKey(option.key)}
              aria-pressed={option.key === metricKey}
              className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition-colors ${
                option.key === metricKey
                  ? "bg-purple-600 text-white"
                  : "text-gray-400 hover:text-gray-200"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      {scored.length === 0 ? (
        <p className="text-sm text-gray-600">No {metric.label.toLowerCase()} data.</p>
      ) : (
        <div className="space-y-1.5">
          {scored
            .sort((a, b) => b.value - a.value)
            .map(({ player, value }) => (
              <div key={player.account_id} className="flex items-center gap-3">
                <PlayerAvatar player={player} size="h-7 w-7" />
                <span className="w-24 shrink-0 truncate text-sm text-gray-200">
                  {player.persona_name || `Player ${player.account_id}`}
                </span>
                <LeaderboardBar
                  value={value}
                  max={max}
                  ratioLabel={`${player.persona_name}: ${metric.format(value)}`}
                />
                <span className="w-14 shrink-0 text-right text-sm font-semibold text-white">
                  {metric.format(value)}
                </span>
              </div>
            ))}

          {hasBaseline && (
            <div className="flex items-center gap-3 pt-0.5">
              <span className="h-7 w-7 shrink-0" aria-hidden="true" />
              <span className="w-24 shrink-0 truncate text-sm lowercase text-gray-500">
                league
              </span>
              <LeaderboardBar
                value={baseline}
                max={max}
                muted
                ratioLabel={`League average: ${metric.format(baseline)}`}
              />
              <span className="w-14 shrink-0 text-right text-sm text-gray-400">
                {metric.format(baseline)}
              </span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default Leaderboard;
