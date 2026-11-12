import React from "react";
import { formatDuration, formatInteger } from "../../utils/format";

const pct = (value) => `${Number(value).toFixed(1)}%`;
const TILE = "flex min-w-0 flex-col gap-2 rounded-2xl border border-border-light bg-card p-4 shadow";
const LABEL = "text-[12px] tracking-[0.05em] text-muted uppercase";
const VALUE = "font-valve-oracle text-[34px] leading-none";

function Tile({ label, value, extra = null, sub, note = null, noteClass = "text-warning" }) {
  return (
    <div className={TILE}>
      <span className={LABEL}>{label}</span>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className={`${VALUE} text-primary`}>{value}</span>
        {extra}
      </div>
      <span className="text-[12px] text-dim">{sub}</span>
      {note && <span className={`text-[13px] font-semibold ${noteClass}`}>{note}</span>}
    </div>
  );
}

/** Win rate, pick rate, games, median buy and sell rate, plus the baseline placeholder. */
export default function ItemHeadlineTiles({ totals, playerGames, matches, minGames, low, showRoadmap = true }) {
  const { games, wins, sold, median_buy_s: medianBuy } = totals;
  const losses = games - wins;
  return (
    <div
      className={`grid grid-cols-2 gap-3 transition-opacity md:grid-cols-[repeat(auto-fit,minmax(190px,1fr))] ${low ? "opacity-60" : ""}`}
    >
      <Tile
        label="Win rate"
        value={games ? pct((wins / games) * 100) : "—"}
        extra={
          games > 0 && (
            <span className="text-[14px] font-semibold whitespace-nowrap">
              <span className="text-success">{wins}W</span>
              <span className="text-dim"> – </span>
              <span className="text-danger-text">{losses}L</span>
            </span>
          )
        }
        sub={`${formatInteger(games)} games`}
      />
      <Tile label="Pick rate" value={pct(playerGames ? (games / playerGames) * 100 : 0)} sub="of player-games" />
      <Tile
        label="Games"
        value={formatInteger(games)}
        sub={`${formatInteger(matches)} matches in scope`}
        note={low ? `Below the ${minGames}-game minimum` : null}
      />
      <Tile label="Median buy" value={formatDuration(medianBuy) ?? "—"} sub="game time" />
      <Tile label="Sell rate" value={games ? pct((sold / games) * 100) : "—"} sub={`${sold} of ${games} sold`} />
      {showRoadmap && (
        <div title="Item win rate minus each hero's usual win rate" className={`${TILE} border-dashed border-border-lighter shadow-none`}>
          <span className={LABEL}>vs Hero Baseline</span>
          <span className={`${VALUE} text-dim`}>—</span>
          <span className="text-[13px] font-semibold text-dim">Adding Soon</span>
        </div>
      )}
    </div>
  );
}
