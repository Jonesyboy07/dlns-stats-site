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
      <header className="flex flex-col gap-[3px] border-b border-border px-4 py-3.5 md:gap-1 md:px-5 md:py-4">
        <h2 className="font-valve-oracle text-[18px] text-primary md:text-[20px]">
          Player Leaderboard
        </h2>
        <span className="text-[12px] text-muted md:text-[13px]">{subline}</span>
      </header>

      <div className="scroll-thin flex overflow-x-auto border-b border-border px-1.5 md:px-3">
        {WEEK_STATS.map((stat) => {
          const active = stat.key === statKey;
          return (
            <button
              key={stat.key}
              type="button"
              onClick={() => onStatChange(stat.key)}
              className={`flex min-h-11 shrink-0 items-center px-2.5 font-valve-oracle text-[13px] font-medium whitespace-nowrap transition-colors md:min-h-0 md:px-[11px] md:py-3 ${
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
          className="relative grid min-h-[52px] grid-cols-[22px_minmax(0,1fr)_auto] items-center gap-2.5 border-t border-border bg-table px-4 text-[14px] transition-colors hover:bg-accent-bg md:min-h-0 md:grid-cols-[40px_minmax(0,1.4fr)_90px_minmax(0,1fr)] md:gap-0 md:px-5 md:py-2.5"
        >
          <span
            className={`font-valve-pulp text-[14px] font-bold md:text-[15px] ${
              row.rank <= 3 ? "text-accent-light" : "text-dim"
            }`}
          >
            {row.rank}
          </span>
          <span className="flex min-w-0 items-center gap-2.5">
            <HeroIcon
              name={row.hero}
              size="h-[32px] w-[32px] md:h-[26px] md:w-[26px]"
              className="shrink-0 rounded-md"
            />
            <span className="flex min-w-0 flex-col">
              <Link
                to={`/player/${row.accountId}`}
                className="truncate font-semibold text-primary hover:text-accent-light after:absolute after:inset-0 after:content-[''] md:after:hidden"
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
          {/* 13b drops the context column; the team above already says which side. */}
          <span className="hidden min-w-0 items-center gap-2 pl-6 text-[12px] leading-tight text-muted md:flex">
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
        <footer className="flex items-center justify-between border-t border-border px-4 text-[13px] text-dim md:px-5 md:py-3">
          <span className="hidden md:inline">
            Showing {rows.length} of {total}.
          </span>
          <button
            type="button"
            onClick={onToggle}
            className="flex min-h-11 items-center font-semibold text-accent-light transition-colors hover:text-accent md:min-h-0"
          >
            {expanded ? "Show top 8 →" : "Show all players →"}
          </button>
        </footer>
      )}
    </section>
  );
}
