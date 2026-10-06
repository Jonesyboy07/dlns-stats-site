import React, { useMemo } from "react";
import { formatShortDate, monthLabel } from "../../utils/weekData";

/**
 * WeekSidebar — the week index that used to be its own `/week` page, merged into
 * the week page as a sticky aside. Weeks arrive oldest first; they are grouped by
 * month and rendered newest first.
 *
 * Props:
 *   weeks          – summarized index weeks (see `summarizeIndexWeek`)
 *   selectedWeek   – currently displayed week number
 *   onSelectWeek   – (week) => void
 *   eventOptions   – selectable event titles
 *   eventTitle     – active event title
 *   onEventChange  – (title) => void
 *   teamFilter     – raw text in the team filter input
 *   onTeamFilter   – (value) => void
 *   teamChips      – quick-filter team names
 *   onChipClick    – (team) => void
 */
export default function WeekSidebar({
  weeks,
  selectedWeek,
  onSelectWeek,
  eventOptions,
  eventTitle,
  onEventChange,
  teamFilter,
  onTeamFilter,
  teamChips,
  onChipClick,
}) {
  const filter = teamFilter.trim().toLowerCase();

  const groups = useMemo(() => {
    const matching = weeks.filter((week) => {
      if (!filter) return true;
      return Object.keys(week.teamResults || {}).some((team) =>
        team.toLowerCase().includes(filter),
      );
    });

    const byMonth = new Map();
    for (const week of matching) {
      const label = monthLabel(week.date);
      if (!byMonth.has(label)) byMonth.set(label, []);
      byMonth.get(label).push(week);
    }

    return [...byMonth.values()]
      .map((entries) => {
        const sorted = [...entries].sort((left, right) => right.week - left.week);
        return { label: monthLabel(sorted[0]?.date), weeks: sorted };
      })
      .sort((left, right) => (right.weeks[0]?.week ?? 0) - (left.weeks[0]?.week ?? 0));
  }, [weeks, filter]);

  const matchCount = groups.reduce((total, group) => total + group.weeks.length, 0);

  return (
    <aside className="flex flex-col overflow-hidden rounded-xl border border-border-light bg-panel shadow-panel lg:sticky lg:top-4">
      <div className="flex flex-col gap-2.5 border-b border-border px-3.5 pt-3.5 pb-3">
        {eventOptions.length > 0 && (
          <label className="sr-only" htmlFor="week-event">
            Event
          </label>
        )}
        {eventOptions.length > 0 && (
          <select
            id="week-event"
            value={eventTitle}
            onChange={(event) => onEventChange(event.target.value)}
            className="w-full rounded-lg border border-border-light bg-input px-3.5 py-2 text-[13px] text-primary outline-none focus:border-accent-border-strong"
          >
            {eventOptions.map((title) => (
              <option key={title} value={title}>
                {title}
              </option>
            ))}
          </select>
        )}

        <input
          type="search"
          value={teamFilter}
          onChange={(event) => onTeamFilter(event.target.value)}
          placeholder="Filter by team…"
          aria-label="Filter weeks by team"
          className="rounded-full border border-border-light bg-input px-3.5 py-2 text-[13px] text-primary outline-none placeholder:text-dim focus:border-accent-border-strong"
        />

        {teamChips.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {teamChips.map((team) => {
              const active = filter === team.toLowerCase();
              return (
                <button
                  key={team}
                  type="button"
                  onClick={() => onChipClick(team)}
                  className={`rounded-full border border-border-light px-2.5 py-[3px] text-[11px] font-medium transition-colors ${
                    active
                      ? "bg-accent-bg-strong text-accent-light"
                      : "bg-transparent text-muted hover:bg-hover"
                  }`}
                >
                  {team}
                </button>
              );
            })}
          </div>
        )}

        <span className="text-[11px] text-dim">
          {filter
            ? `${matchCount} week${matchCount === 1 ? "" : "s"} with “${teamFilter.trim()}”`
            : `${weeks.length} weeks · newest first`}
        </span>
      </div>

      <div className="scroll-thin flex max-h-[760px] flex-col overflow-y-auto">
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
              />
            ))}
          </React.Fragment>
        ))}

        {groups.length === 0 && (
          <p className="px-3.5 py-5 text-[13px] text-muted">No weeks match that team.</p>
        )}
      </div>
    </aside>
  );
}

function WeekRow({ week, selected, filter, onSelect }) {
  const champions = ["NA", "EU"]
    .map((region) => ({ region, team: week.champions?.[region] }))
    .filter((entry) => entry.team);

  const tag = useMemo(() => {
    if (!filter) return null;
    const entry = Object.entries(week.teamResults || {}).find(([team]) =>
      team.toLowerCase().includes(filter),
    );
    if (!entry) return null;
    return {
      label: `${entry[1].region} · ${entry[1].result}`,
      champion: entry[1].result === "Champion",
    };
  }, [week.teamResults, filter]);

  return (
    <button
      type="button"
      onClick={() => onSelect(week.week)}
      aria-current={selected ? "true" : undefined}
      className={`grid grid-cols-[40px_minmax(0,1fr)_auto] items-start gap-2 px-3.5 py-2 text-left text-[12px] text-muted transition-colors ${
        selected ? "bg-accent-bg-strong" : "bg-transparent hover:bg-hover"
      }`}
    >
      <span
        className={`font-valve-pulp text-[14px] font-bold ${
          selected ? "text-accent-light" : "text-primary"
        }`}
      >
        #{week.week}
      </span>
      <span className="flex min-w-0 flex-col gap-px">
        <span className="text-[11px] text-dim">{formatShortDate(week.date)}</span>
        {champions.map(({ region, team }) => (
          <span key={region} className="truncate text-secondary">
            <span className="text-dim">{region} </span>
            {team}
          </span>
        ))}
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
