import React from "react";
import { groupIndexWeeks } from "../../utils/weekData";
import WeekList from "./WeekList";

/**
 * MobileWeekSheet — the 13b week picker that replaces the desktop sidebar: a
 * 78%-height panel over a blurred backdrop, with the same event select, team
 * filter, chips and grouped week list the sidebar shows.
 *
 * Props:
 *   open         – whether the sheet is showing
 *   onClose      – () => void
 *   weeks        – summarized index weeks
 *   selectedWeek – currently displayed week number
 *   onSelectWeek – (week) => void, which also closes the sheet
 *   plus the WeekSidebar filter props
 */
export default function MobileWeekSheet({
  open,
  onClose,
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
  if (!open) return null;

  const filter = teamFilter.trim().toLowerCase();
  const { groups, count } = groupIndexWeeks(weeks, teamFilter);

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close the week list"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[4px]"
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="All weeks"
        className="absolute inset-x-0 bottom-0 flex h-[78vh] flex-col rounded-t-2xl border-t border-border-light bg-panel shadow-[0_-20px_60px_rgba(0,0,0,.4)]"
      >
        <div className="flex justify-center pt-2.5">
          <span aria-hidden="true" className="h-1 w-9 rounded-full bg-border-lighter" />
        </div>

        <div className="flex items-center justify-between gap-3 px-4 pt-2 pb-3">
          <h2 className="font-valve-oracle text-[18px] text-primary">All weeks</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 items-center px-2 text-[14px] font-semibold text-accent-light"
          >
            Done
          </button>
        </div>

        <div className="flex flex-col gap-2.5 border-b border-border px-4 pb-3">
          {eventOptions.length > 0 && (
            <label className="sr-only" htmlFor="sheet-event">
              Event
            </label>
          )}
          {eventOptions.length > 0 && (
            <select
              id="sheet-event"
              value={eventTitle}
              onChange={(event) => onEventChange(event.target.value)}
              className="w-full rounded-lg border border-border-light bg-input px-3.5 py-2 text-[15px] text-primary outline-none focus:border-accent-border-strong"
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
            className="min-h-11 rounded-full border border-border-light bg-input px-4 text-[15px] text-primary outline-none placeholder:text-dim focus:border-accent-border-strong"
          />

          {teamChips.length > 0 && (
            <div className="scroll-thin flex gap-1.5 overflow-x-auto">
              {teamChips.map((team) => {
                const active = filter === team.toLowerCase();
                return (
                  <button
                    key={team}
                    type="button"
                    onClick={() => onChipClick(team)}
                    className={`min-h-[34px] shrink-0 rounded-full border border-border-light px-3 text-[12px] font-medium transition-colors ${
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

        <div className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto">
          <WeekList
            groups={groups}
            selectedWeek={selectedWeek}
            filter={filter}
            onSelectWeek={onSelectWeek}
            variant="sheet"
          />
        </div>
      </div>
    </div>
  );
}
