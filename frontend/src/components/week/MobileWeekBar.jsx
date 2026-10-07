import React, { useEffect, useState } from "react";
import { formatShortDate } from "../../utils/weekData";
import MobileWeekSheet from "./MobileWeekSheet";

/**
 * MobileWeekBar — the 13b week controls, fixed to the bottom of the frame: step
 * back and forward a week either side, and a middle button that opens the week
 * sheet. It owns the sheet, since nothing else on the page needs to know whether
 * it is showing.
 *
 * Props:
 *   week         – currently displayed week number
 *   date         – the week's first match time, for the middle button
 *   weeks        – summarized index weeks, which bound the steps and fill the sheet
 *   onSelectWeek – (week) => void
 *   plus the WeekSidebar filter props, handed straight to the sheet
 */
export default function MobileWeekBar({
  week,
  date,
  weeks,
  onSelectWeek,
  eventOptions,
  eventTitle,
  onEventChange,
  teamFilter,
  onTeamFilter,
  teamChips,
  onChipClick,
}) {
  const [open, setOpen] = useState(false);

  const numbers = (weeks || []).map((entry) => entry.week);
  const first = numbers.length > 0 ? Math.min(...numbers) : null;
  const last = numbers.length > 0 ? Math.max(...numbers) : null;

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  const pick = (next) => {
    setOpen(false);
    onSelectWeek(next);
  };

  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-[4] border-t border-border-light bg-base-glass px-4 pt-2.5 pb-[26px] shadow-[0_-8px_24px_rgba(0,0,0,.25)] backdrop-blur-[10px] md:hidden">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] gap-1.5">
          <StepButton
            label="Previous week"
            glyph="‹"
            disabled={first != null && week <= first}
            onClick={() => pick(week - 1)}
          />
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-expanded={open}
            className="flex min-h-11 min-w-0 flex-col items-center justify-center rounded-full border border-border-light bg-card text-primary"
          >
            <span className="flex items-center gap-1.5 text-[14px] font-semibold">
              Week #{week}
              <span aria-hidden="true" className="text-dim">
                ▾
              </span>
            </span>
            <span className="text-[11px] text-muted">{formatShortDate(date)}</span>
          </button>
          <StepButton
            label="Next week"
            glyph="›"
            disabled={last != null && week >= last}
            onClick={() => pick(week + 1)}
          />
        </div>
      </div>

      <MobileWeekSheet
        open={open}
        onClose={() => setOpen(false)}
        weeks={weeks}
        selectedWeek={week}
        onSelectWeek={pick}
        eventOptions={eventOptions}
        eventTitle={eventTitle}
        onEventChange={onEventChange}
        teamFilter={teamFilter}
        onTeamFilter={onTeamFilter}
        teamChips={teamChips}
        onChipClick={onChipClick}
      />
    </>
  );
}

function StepButton({ label, glyph, disabled, onClick }) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center rounded-full border border-border-light bg-card text-[18px] text-primary transition-colors ${
        disabled ? "opacity-40" : "hover:bg-hover"
      }`}
    >
      {glyph}
    </button>
  );
}
