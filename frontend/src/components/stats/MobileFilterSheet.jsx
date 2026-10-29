import React, { useState } from "react";
import Button from "../Button";
import { defaultRange, matchesInRange, weeksLabel } from "../../utils/statsPeriod";

const GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-dim";
const CHIP_WEEKS = 8;

/**
 * The phone's filter sheet: the latest weeks as chips (tap a start and an end
 * week), the patches as a radio list, and the region. Weeks and Patch edit one
 * draft range, the same state the desktop Period picker edits, and nothing is
 * applied until "Show n matches".
 */
export default function MobileFilterSheet({ weeks, patches, range, region, regions, onApply, onClose }) {
  const [draft, setDraft] = useState(range);
  const [draftRegion, setDraftRegion] = useState(region);
  const [pendingWeek, setPendingWeek] = useState(null);

  const chips = weeks.slice(-CHIP_WEEKS);
  const count = matchesInRange(draft, weeks, draftRegion);

  const tapWeek = (week) => {
    if (pendingWeek == null) {
      setDraft([week, week]);
      setPendingWeek(week);
    } else {
      setDraft([Math.min(pendingWeek, week), Math.max(pendingWeek, week)]);
      setPendingWeek(null);
    }
  };

  const reset = () => {
    setDraft(defaultRange(weeks));
    setDraftRegion("All");
    setPendingWeek(null);
  };

  return (
    <div className="fixed inset-0 z-50 md:hidden">
      <button
        type="button"
        aria-label="Close filters"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/40 backdrop-blur-[4px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Filters"
        className="scroll-thin absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col gap-[18px] overflow-y-auto rounded-t-2xl border-t border-border-lighter bg-panel px-4 pt-2.5 pb-5 shadow-[0_20px_60px_rgba(0,0,0,.3)]"
      >
        <span aria-hidden="true" className="h-1 w-10 self-center rounded-full bg-border-lighter" />
        <div className="flex items-center justify-between">
          <h2 className="font-valve-oracle text-[22px] font-semibold text-primary">Filters</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex min-h-11 min-w-11 items-center justify-end text-[14px] text-muted"
          >
            Close
          </button>
        </div>

        <div className="flex flex-col gap-2">
          <div className={`flex justify-between ${GROUP_LABEL}`}>
            <span>Weeks</span>
            <span className="text-accent-light">{weeksLabel(draft, weeks)}</span>
          </div>
          <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${chips.length}, minmax(0, 1fr))` }}>
            {chips.map(({ week, matches }) => {
              const on = week >= draft[0] && week <= draft[1];
              return (
                <button
                  key={week}
                  type="button"
                  aria-pressed={on}
                  aria-label={`Week ${week}, ${matches ? `${matches} matches` : "no games"}`}
                  onClick={() => tapWeek(week)}
                  className={`flex min-h-11 items-center justify-center rounded-md border text-[14px] font-semibold ${
                    on
                      ? "border-accent-border bg-accent-bg-strong text-accent-light"
                      : "border-border-light bg-input text-secondary"
                  }`}
                >
                  {week}
                </button>
              );
            })}
          </div>
          <span className="text-[12px] text-dim">
            {pendingWeek != null ? "Now tap an end week." : "Tap a start and end week."}
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className={GROUP_LABEL}>Patch</span>
          <div className="flex flex-col overflow-hidden rounded-xl border border-border-light">
            {[...patches].reverse().map((patch) => {
              const on = patch.start_week === draft[0] && patch.end_week === draft[1];
              return (
                <button
                  key={`${patch.name}-${patch.start_week}`}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => {
                    setDraft([patch.start_week, patch.end_week]);
                    setPendingWeek(null);
                  }}
                  className={`flex min-h-[52px] items-center gap-3 border-b border-border px-3.5 py-2 text-left last:border-b-0 ${
                    on ? "bg-accent-bg" : "bg-transparent"
                  }`}
                >
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-2 ${
                      on ? "border-accent" : "border-border-lighter"
                    }`}
                  >
                    <span className={`h-2 w-2 rounded-full ${on ? "bg-accent" : "bg-transparent"}`} />
                  </span>
                  <span className="flex flex-col gap-px">
                    <span className="font-semibold text-primary">{patch.name}</span>
                    <span className="text-[12px] text-dim">
                      {patch.start_week === patch.end_week
                        ? `Week ${patch.start_week}`
                        : `Weeks ${patch.start_week}–${patch.end_week}`}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className={GROUP_LABEL}>Region</span>
          <div
            className="grid gap-0.5 rounded-full border border-border-light bg-input p-[3px]"
            style={{ gridTemplateColumns: `repeat(${regions.length + 1}, 1fr)` }}
          >
            {["All", ...regions].map((option) => (
              <button
                key={option}
                type="button"
                aria-pressed={draftRegion === option}
                onClick={() => setDraftRegion(option)}
                className={`flex min-h-10 items-center justify-center rounded-full text-[14px] font-semibold ${
                  draftRegion === option ? "bg-accent-bg-strong text-accent-light" : "text-muted"
                }`}
              >
                {option}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2.5">
          <Button onClick={reset} className="min-h-11">
            Reset
          </Button>
          <Button variant="accent" onClick={() => onApply(draft, draftRegion)} className="min-h-11">
            Show {count} matches
          </Button>
        </div>
      </div>
    </div>
  );
}
