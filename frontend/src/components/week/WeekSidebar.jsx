import React from "react";
import { groupIndexWeeks } from "../../utils/weekData";
import WeekList from "./WeekList";

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
  const { groups, count } = groupIndexWeeks(weeks, teamFilter);

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
            ? `${count} week${count === 1 ? "" : "s"} with “${teamFilter.trim()}”`
            : `${weeks.length} weeks · newest first`}
        </span>
      </div>

      <div className="scroll-thin flex max-h-[760px] flex-col overflow-y-auto">
        <WeekList
          groups={groups}
          selectedWeek={selectedWeek}
          filter={filter}
          onSelectWeek={onSelectWeek}
        />
      </div>
    </aside>
  );
}
