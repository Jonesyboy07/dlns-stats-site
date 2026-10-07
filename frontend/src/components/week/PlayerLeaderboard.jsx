import React from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import { WEEK_STATS, formatDuration } from "../../utils/weekData";

/**
 * PlayerLeaderboard — best single-game value per player across the week scope.
 *
 * Props:
 *   statKey      – active stat key (see WEEK_STATS)
 *   onStatChange – (key) => void
 *   subline      – "Best single-game kills, Week #58 · both regions"
 *   rows         – ranked rows from `buildLeaderboard`
 *   total        – player-games considered, for the "Showing 8 of N" footer
 *   expanded     – whether every row is shown
 *   onToggle     – toggles the expanded state
 */
export default function PlayerLeaderboard({
  statKey,
  onStatChange,
  subline,
  rows,
  total,
  expanded,
  onToggle,
}) {
  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-card shadow">
      <header className="flex flex-col gap-1 border-b border-border px-5 py-4">
        <h2 className="font-valve-oracle text-[20px] text-primary">Player Leaderboard</h2>
        <span className="text-[13px] text-muted">{subline}</span>
      </header>

      <div className="scroll-thin flex overflow-x-auto border-b border-border px-3">
        {WEEK_STATS.map((stat) => {
          const active = stat.key === statKey;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => onStatChange(stat.key)}
              className={`px-[11px] py-3 font-valve-oracle text-[13px] font-medium whitespace-nowrap transition-colors ${
                active ? "text-primary shadow-[inset_0_-2px_0_var(--color-accent)]" : "text-muted hover:text-secondary"
              }`}
            >
              Most {stat.label}
            </button>
          );
        })}
      </div>

      {rows.length === 0 && (
        <p className="px-5 py-8 text-center text-[13px] text-muted">
          No player stats recorded for this scope.
        </p>
      )}

      {rows.map((row) => (
        <div
          key={row.accountId}
          className="grid grid-cols-[40px_minmax(0,1.4fr)_90px_minmax(0,1fr)] items-center border-t border-border bg-table px-5 py-2.5 text-[14px] transition-colors hover:bg-accent-bg"
        >
          <span
            className={`font-valve-pulp text-[15px] font-bold ${
              row.rank <= 3 ? "text-accent-light" : "text-dim"
            }`}
          >
            {row.rank}
          </span>
          <span className="flex min-w-0 items-center gap-2.5">
            <HeroIcon name={row.hero} size="h-[26px] w-[26px]" className="rounded-md" />
            <span className="flex min-w-0 flex-col">
              <Link
                to={`/player/${row.accountId}`}
                className="truncate font-semibold text-primary hover:text-accent-light"
              >
                {row.name}
              </Link>
              <span className="truncate text-[12px] text-dim" title={row.team || undefined}>
                {row.team || "—"}
              </span>
            </span>
          </span>
          <span className="text-right font-valve-oracle text-[17px] font-bold text-primary tabular-nums">
            {row.value.toLocaleString()}
          </span>
          <span className="flex min-w-0 items-center gap-2 pl-6 text-[12px] leading-tight text-muted">
            <span
              className="h-1.5 w-1.5 shrink-0 rounded-full"
              style={{
                background: row.side === 1 ? "var(--color-team-sapphire)" : "var(--color-team-amber)",
              }}
            />
            {/* Two lines rather than one: a 9-digit match id plus a duration does
                not fit this column, and truncating the id hid which game it was. */}
            <span className="flex min-w-0 flex-col">
              <span className="truncate">Game #{row.matchId}</span>
              <span className="truncate text-dim">{formatDuration(row.durationS)}</span>
            </span>
          </span>
        </div>
      ))}

      {rows.length > 0 && (
        <footer className="flex items-center justify-between border-t border-border px-5 py-3 text-[13px] text-dim">
          <span>
            Showing {rows.length} of {total}.
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="font-semibold text-accent-light transition-colors hover:text-accent"
          >
            {expanded ? "Show top 8 →" : "Show all players →"}
          </button>
        </footer>
      )}
    </section>
  );
}
