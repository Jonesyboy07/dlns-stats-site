import React, { useMemo } from "react";
import Panel from "./Panel";
import { heroWeekMatrix } from "../../utils/playerStats";

const LABEL_COLUMN = "96px";
/** Cell fill per game count: empty, light, medium, and the cap for 3+. */
const FILL = [
  null,
  "oklch(68.88% 0.187 300 / 0.28)",
  "oklch(68.88% 0.187 300 / 0.55)",
  "var(--color-accent-secondary)",
];
const TOP_HEROES = 7;

/**
 * Hero × Week: picks per week, one row per hero.
 *
 * The axis runs from the player's first to last league week and the count is
 * printed in every filled cell, so nothing is hover-only. A week the player sat
 * out is an empty cell rather than a skipped column — the point of the matrix is
 * to show the shape of the season, and skipping would hide the gaps. Heroes past
 * the top seven fold into an "Others" row whose cell is the total across them.
 */
export default function HeroWeekMatrix({ matches = [] }) {
  const { weeks, rows, unplaced } = useMemo(
    () => heroWeekMatrix(matches, { topHeroes: TOP_HEROES }),
    [matches],
  );

  if (weeks.length === 0) {
    return (
      <Panel title="Hero × Week">
        <p className="text-sm text-muted">
          No league weeks to plot yet — this player has no games with a week on record.
        </p>
      </Panel>
    );
  }

  const template = { gridTemplateColumns: `${LABEL_COLUMN} repeat(${weeks.length}, minmax(18px, 1fr))` };

  return (
    <Panel
      title="Hero × Week"
      subtitle={`Picks per week, NS ${weeks[0]} – NS ${weeks[weeks.length - 1]} · number shown in every cell`}
      action={
        <span className="text-[12px] tabular-nums text-muted">
          {rows.reduce((sum, row) => sum + row.games, 0)} games
        </span>
      }
    >
      <div className="flex flex-col gap-0.5 overflow-x-auto [scrollbar-color:rgb(75_85_99)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-transparent">
        {rows.map((row) => (
          <div key={row.id} className="grid items-center gap-0.5" style={template}>
            <span className="truncate pl-0.5 text-[12px] text-secondary" title={`${row.label} · ${row.games} games`}>
              {row.label}
            </span>
            {row.cells.map((count, index) => {
              const week = weeks[index];
              return (
                <span
                  key={week}
                  title={`${row.label} · NS ${week}: ${count} pick${count === 1 ? "" : "s"}`}
                  className="flex h-5 items-center justify-center rounded-[3px] text-[10px] font-semibold tabular-nums"
                  style={{
                    background: FILL[Math.min(count, 3)] ?? "var(--color-table)",
                    color: count >= 2 ? "#170a26" : "var(--color-primary)",
                  }}
                >
                  {count > 0 ? count : ""}
                </span>
              );
            })}
          </div>
        ))}

        <div className="mt-1 grid gap-0.5 text-center text-[9px] text-dim" style={template}>
          <span />
          {weeks.map((week, index) => (
            <span key={week}>
              {week % 5 === 0 || index === 0 || index === weeks.length - 1 ? week : ""}
            </span>
          ))}
        </div>
      </div>

      {unplaced > 0 && (
        <p className="mt-2 text-[11px] text-dim">
          {unplaced} pre-season game{unplaced === 1 ? "" : "s"} have no league week and are
          not on the axis.
        </p>
      )}
    </Panel>
  );
}
