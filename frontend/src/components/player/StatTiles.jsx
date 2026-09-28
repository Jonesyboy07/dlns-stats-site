import React from "react";
import DeltaBadge from "./DeltaBadge";
import ScoreChip from "./ScoreChip";
import { formatCompact, formatKda, formatPercent } from "../../utils/format";
import { headlineStats } from "../../utils/playerStats";

const DASH = "—";

/** "62.5%", but "50%" when the decimal adds nothing. */
const percent = (fraction) =>
  fraction == null ? DASH : formatPercent(fraction * 100, 1).replace(/\.0%$/, "%");

const compact = (value) => (value == null ? DASH : formatCompact(value));
const average = (value) => (value == null ? DASH : formatKda(value));

/** Coverage note for averages that only some games can supply. */
const coverage = (withData, total) =>
  withData > 0 && withData < total ? `${withData} of ${total} games` : null;

function StatTile({ label, value, sub = null, delta = null }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-2xl border border-border-light bg-card px-4 py-3.5 shadow">
      <span className="text-[11px] uppercase tracking-[.05em] text-muted">{label}</span>
      <span className="truncate font-valve-pulp text-[28px] leading-[1.05] text-primary">
        {value}
      </span>
      {(delta != null || sub != null) && (
        <span className="flex flex-wrap items-center gap-1.5 text-[11px] text-dim">
          {delta}
          {sub != null && <span>{sub}</span>}
        </span>
      )}
    </div>
  );
}

/**
 * P1-2: the six headline tiles. Deltas are passed in per tile key and are simply
 * omitted while there is no league-baseline endpoint — the tile renders without
 * the badge row rather than showing a meaningless comparison.
 */
export default function StatTiles({ matches = [], deltas = null }) {
  const stats = headlineStats(matches);
  const d = deltas ?? {};
  const badge = (key, props = {}) =>
    d[key] ? <DeltaBadge {...props} {...d[key]} /> : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Games"
        value={stats.games}
        sub={stats.unknown > 0 ? `${stats.unknown} with unknown result` : null}
        delta={badge("games")}
      />
      <StatTile
        label="W–L"
        value={
          <ScoreChip
            wins={stats.wins}
            losses={stats.losses}
            className="text-[28px] leading-[1.05]"
          />
        }
        sub={stats.unknown > 0 ? "unknown results excluded" : null}
        delta={badge("record")}
      />
      <StatTile
        label="Win rate"
        value={percent(stats.winRate)}
        delta={badge("winRate", { unit: "pts" })}
      />
      <StatTile label="Avg KDA" value={average(stats.kda)} delta={badge("kda")} />
      <StatTile
        label="Souls/game"
        value={compact(stats.soulsPerGame)}
        sub={coverage(stats.soulsGames, stats.games)}
        delta={badge("soulsPerGame")}
      />
      <StatTile
        label="Hero dmg/game"
        value={compact(stats.damagePerGame)}
        sub={coverage(stats.damageGames, stats.games)}
        delta={badge("damagePerGame")}
      />
    </div>
  );
}
