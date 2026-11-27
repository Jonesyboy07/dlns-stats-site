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

/** One event's grid: a row per hero, a column per week of THAT event. */
function EventMatrix({ group, showHeading }) {
  const { weeks, rows, prefix } = group;
  const template = { gridTemplateColumns: `${LABEL_COLUMN} repeat(${weeks.length}, minmax(18px, 1fr))` };

  return (
    <div className="flex flex-col gap-0.5">
      {showHeading && (
        <p className="mb-1 text-[11px] font-semibold uppercase tracking-[.05em] text-muted">
          {group.event}
          <span className="ml-1 font-normal normal-case text-dim">
            · {prefix} {weeks[0]} – {prefix} {weeks[weeks.length - 1]} · {group.games} games
          </span>
        </p>
      )}

      <div className="flex flex-col gap-0.5 scroll-thin overflow-x-auto">
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
                  title={`${row.label} · ${prefix} ${week}: ${count} pick${count === 1 ? "" : "s"}`}
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
    </div>
  );
}

/**
 * Hero × Week: picks per week, one row per hero.
 *
 * The axis runs from the player's first to last week and the count is printed in
 * every filled cell, so nothing is hover-only. A week the player sat out is an
 * empty cell rather than a skipped column — the point of the matrix is to show
 * the shape of the season, and skipping would hide the gaps. Heroes past the top
 * seven fold into an "Others" row whose cell is the total across them.
 *
 * Week numbers restart per event (Fight Night week 5 is not Night Shift week 5),
 * so each event gets its own grid, main league first.
 */
export default function HeroWeekMatrix({ matches = [] }) {
  const { events, unplaced } = useMemo(
    () => heroWeekMatrix(matches, { topHeroes: TOP_HEROES }),
    [matches],
  );

  if (events.length === 0) {
    return (
      <Panel title="Hero × Week">
        <p className="text-sm text-muted">
          No league weeks to plot yet — this player has no games with a week on record.
        </p>
      </Panel>
    );
  }

  const [lead] = events;
  const subtitle =
    events.length === 1
      ? `Picks per week, ${lead.prefix} ${lead.weeks[0]} – ${lead.prefix} ${lead.weeks[lead.weeks.length - 1]} · number shown in every cell`
      : "Picks per week, one grid per event · number shown in every cell";

  return (
    <Panel
      title="Hero × Week"
      subtitle={subtitle}
      action={
        <span className="text-[12px] tabular-nums text-muted">
          {events.reduce((sum, group) => sum + group.games, 0)} games
        </span>
      }
    >
      <div className="flex flex-col gap-5">
        {events.map((group) => (
          <EventMatrix key={group.event} group={group} showHeading={events.length > 1} />
        ))}
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
