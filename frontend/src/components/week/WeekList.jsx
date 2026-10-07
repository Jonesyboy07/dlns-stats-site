import React from "react";
import { formatShortDate } from "../../utils/weekData";

/**
 * WeekList — the grouped week index, shared by the 13a sidebar and the 13b week
 * sheet. Both group and filter through `groupIndexWeeks`; the sheet asks for the
 * roomier rows 13b measured, which put both champions on one line.
 *
 * Props:
 *   groups       – from `groupIndexWeeks`
 *   selectedWeek – currently displayed week number
 *   filter       – the active team filter, lowercased
 *   onSelectWeek – (week) => void
 *   variant      – 'sidebar' | 'sheet'
 */
export default function WeekList({ groups, selectedWeek, filter, onSelectWeek, variant = "sidebar" }) {
  if (groups.length === 0) {
    return <p className="px-3.5 py-5 text-[13px] text-muted">No weeks match that team.</p>;
  }

  return (
    <>
      {groups.map((group) => (
        <React.Fragment key={group.label}>
          <div className="sticky top-0 z-10 border-b border-border bg-panel px-3.5 py-1.5 text-[10px] font-semibold tracking-[.12em] text-dim uppercase">
            {group.label}
          </div>
          {group.weeks.map((week) => (
            <WeekRow
              key={week.week}
              week={week}
              selected={week.week === selectedWeek}
              filter={filter}
              onSelect={onSelectWeek}
              variant={variant}
            />
          ))}
        </React.Fragment>
      ))}
    </>
  );
}

function WeekRow({ week, selected, filter, onSelect, variant }) {
  const sheet = variant === "sheet";
  const champions = ["NA", "EU"]
    .map((region) => ({ region, team: week.champions?.[region] }))
    .filter((entry) => entry.team);

  /* While a team filter is on, the row answers for that team instead of the
     champions it would otherwise show. */
  let tag = null;
  if (filter) {
    const entry = Object.entries(week.teamResults || {}).find(([team]) =>
      team.toLowerCase().includes(filter),
    );
    if (entry) {
      tag = {
        label: `${entry[1].region} · ${entry[1].result}`,
        champion: entry[1].result === "Champion",
      };
    }
  }

  return (
    <button
      type="button"
      onClick={() => onSelect(week.week)}
      aria-current={selected ? "true" : undefined}
      className={`grid gap-2 text-left text-[12px] text-muted transition-colors ${
        sheet
          ? "min-h-14 grid-cols-[48px_minmax(0,1fr)_auto] items-center px-4 py-2"
          : "grid-cols-[40px_minmax(0,1fr)_auto] items-start px-3.5 py-2"
      } ${selected ? "bg-accent-bg-strong" : "bg-transparent hover:bg-hover"}`}
    >
      <span
        className={`font-valve-pulp font-bold ${sheet ? "text-[17px]" : "text-[14px]"} ${
          selected ? "text-accent-light" : "text-primary"
        }`}
      >
        #{week.week}
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="text-[11px] text-dim">{formatShortDate(week.date)}</span>
        {sheet ? (
          champions.length > 0 && (
            <span className="truncate text-secondary">
              {champions.map(({ region, team }, index) => (
                <React.Fragment key={region}>
                  {index > 0 ? <span className="text-dim"> · </span> : null}
                  <span className="text-dim">{region} </span>
                  {team}
                </React.Fragment>
              ))}
            </span>
          )
        ) : (
          champions.map(({ region, team }) => (
            <span key={region} className="truncate text-secondary">
              <span className="text-dim">{region} </span>
              {team}
            </span>
          ))
        )}
      </span>
      {tag && (
        <span
          className={`text-[11px] font-semibold ${tag.champion ? "text-accent-light" : "text-muted"}`}
        >
          {tag.label}
        </span>
      )}
    </button>
  );
}
