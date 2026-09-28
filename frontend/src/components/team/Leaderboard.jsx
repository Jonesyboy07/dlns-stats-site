import React, { useState } from "react";
import SteamAvatar from "./SteamAvatar";
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
    <span className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-input">
      {/* The accent gradient is a `background` value rather than a colour, so it
          has to go through an arbitrary property — `bg-*` would emit an invalid
          background-color and the bar would come out empty. */}
      <span
        title={ratioLabel}
        className={`block h-full rounded-full ${
          muted ? "bg-dim" : "[background:var(--color-accent-secondary-gradient)]"
        }`}
        style={{ width: `${width}%` }}
      />
    </span>
  );
}

/**
 * Roster leaderboard: pick a metric, see the roster ranked with a league average
 * baseline pinned at the bottom. The card's title and subtitle come from the
 * caller, so this renders only the control and the bars.
 */
function Leaderboard({ players = [], league }) {
  const [metricKey, setMetricKey] = useState(METRICS[0].key);
  const metric = METRICS.find((m) => m.key === metricKey) ?? METRICS[0];

  const scored = players
    .map((player) => ({ player, value: player[metric.key] }))
    .filter((row) => row.value != null)
    .sort((a, b) => b.value - a.value);

  const baseline = league?.[metric.baselineKey];
  const hasBaseline = baseline != null;
  const max = Math.max(
    ...scored.map((row) => row.value),
    hasBaseline ? baseline : 0,
    0,
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className="flex gap-0.5 self-start rounded-lg border border-border-light bg-badge-bg p-[3px]">
        {METRICS.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === metricKey}
            onClick={() => setMetricKey(option.key)}
            className={`rounded-md px-3 py-1 text-[13px] transition-colors motion-reduce:transition-none ${
              option.key === metricKey
                ? "bg-accent-secondary-bg-strong font-semibold text-accent-secondary-light"
                : "font-medium text-muted hover:bg-hover hover:text-primary"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {scored.length === 0 ? (
        <p className="text-[13px] text-dim">No {metric.label.toLowerCase()} data.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {scored.map(({ player, value }) => (
            <div key={player.account_id} className="flex items-center gap-3">
              <SteamAvatar player={player} size="h-7 w-7" rounded="rounded-full" />
              <span className="w-24 shrink-0 truncate text-[14px] text-secondary">
                {player.persona_name || `Player ${player.account_id}`}
              </span>
              <LeaderboardBar
                value={value}
                max={max}
                ratioLabel={`${player.persona_name}: ${metric.format(value)}`}
              />
              <span className="w-14 shrink-0 text-right font-valve-oracle text-[16px] font-semibold text-primary">
                {metric.format(value)}
              </span>
            </div>
          ))}

          {hasBaseline && (
            <div className="flex items-center gap-3 border-t border-dashed border-border-light pt-2">
              <span className="h-7 w-7 shrink-0" aria-hidden="true" />
              <span className="w-24 shrink-0 truncate text-[13px] text-dim">League avg</span>
              <LeaderboardBar
                value={baseline}
                max={max}
                muted
                ratioLabel={`League average: ${metric.format(baseline)}`}
              />
              <span className="w-14 shrink-0 text-right text-[14px] text-muted">
                {metric.format(baseline)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Leaderboard;
