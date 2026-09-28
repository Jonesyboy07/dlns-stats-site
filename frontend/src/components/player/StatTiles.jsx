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
 *
 * Games, record and win rate are ONE tile: they are three views of the same series,
 * and splitting them wasted two columns saying almost the same thing. The games
 * played ride in brackets next to the record so a W–L that does not add up to the
 * games count (unknown results) is visible in place, and the win rate sits on the
 * sub line it belongs to.
 */
export default function StatTiles({ matches = [], deltas = null }) {
  const stats = headlineStats(matches);
  const d = deltas ?? {};
  const badge = (key, props = {}) =>
    d[key] ? <DeltaBadge {...props} {...d[key]} /> : null;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
      <StatTile
        label="Record"
        value={
          <span className="flex items-baseline gap-1.5">
            <ScoreChip
              wins={stats.wins}
              losses={stats.losses}
              className="text-[28px] leading-[1.05]"
              title={
                stats.unknown > 0
                  ? `${stats.unknown} game${stats.unknown === 1 ? "" : "s"} with no result`
                  : undefined
              }
            />
            <span className="font-valve-pulp text-[18px] tabular-nums text-dim">
              ({stats.games})
            </span>
          </span>
        }
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
      <StatTile
        label="Healing/game"
        value={compact(stats.healingPerGame)}
        sub={coverage(stats.healingGames, stats.games)}
        delta={badge("healingPerGame")}
      />
      <StatTile
        label="Obj dmg/game"
        value={compact(stats.objDamagePerGame)}
        sub={coverage(stats.objDamageGames, stats.games)}
        delta={badge("objDamagePerGame")}
      />
    </div>
  );
}
