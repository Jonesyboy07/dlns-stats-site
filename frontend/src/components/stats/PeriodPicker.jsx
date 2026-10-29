import React, { useState } from "react";
import Button from "../Button";
import {
  matchesInRange,
  periodPresets,
  rangeDetail,
  shortPatchName,
  weeksLabel,
} from "../../utils/statsPeriod";

const GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-dim";

/* Each patch band and the weeks under it share one flex weight and min width, so
   a patch's weeks always sit exactly under its band. */
function bandStyle(patch) {
  const custom = shortPatchName(patch.name) === patch.name;
  return {
    flex: `${patch.end_week - patch.start_week + 1} 1 0px`,
    minWidth: custom ? 112 : 58,
  };
}

function bandTone(patch, range) {
  const inside = patch.start_week >= range[0] && patch.end_week <= range[1];
  const part = patch.start_week <= range[1] && patch.end_week >= range[0];
  if (inside) return "border-accent-border-strong bg-accent-bg-strong text-accent-light";
  if (part) return "border-accent-border bg-accent-bg text-secondary";
  return "border-border bg-input text-muted";
}

/**
 * The desktop Period popover: presets, one band per patch, one bar per week
 * (height = matches played), and a footer that describes the draft range.
 * Clicking a patch selects its weeks; clicking two weeks sets a range. Nothing
 * is applied until "Show n matches".
 */
export default function PeriodPicker({ weeks, patches, range, region, onApply, onCancel }) {
  const [draft, setDraft] = useState(range);
  const [pendingWeek, setPendingWeek] = useState(null);

  const byWeek = new Map(weeks.map((entry) => [entry.week, entry]));
  const maxMatches = Math.max(1, ...weeks.map((entry) => entry.matches));
  const count = matchesInRange(draft, weeks, region);
  const presets = periodPresets(weeks);

  const choose = (next) => {
    setDraft(next);
    setPendingWeek(null);
  };

  const clickWeek = (week) => {
    if (pendingWeek == null) {
      setDraft([week, week]);
      setPendingWeek(week);
    } else {
      choose([Math.min(pendingWeek, week), Math.max(pendingWeek, week)]);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Choose a period"
      className="absolute top-[calc(100%+8px)] left-0 z-30 flex w-[min(900px,100%)] flex-col gap-4 rounded-2xl border border-border-lighter bg-panel px-5 py-[18px] shadow-[0_18px_44px_rgba(0,0,0,.45)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <span className="font-valve-oracle text-[18px] font-semibold text-primary">Period</span>
          <span className="text-[12px] text-dim">
            Pick a patch to select its weeks, or click two weeks to set a range.
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {presets.map((preset) => {
            const active = preset.range[0] === draft[0] && preset.range[1] === draft[1];
            return (
              <button
                key={preset.label}
                type="button"
                aria-pressed={active}
                onClick={() => choose(preset.range)}
                className={`rounded-full border px-3 py-[5px] text-[12px] font-semibold transition-colors active:translate-y-px ${
                  active
                    ? "border-accent-border bg-accent-bg-strong text-accent-light"
                    : "border-border-light bg-badge-bg text-secondary hover:bg-hover"
                }`}
              >
                {preset.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="scroll-thin overflow-x-auto">
        <div className="flex min-w-max flex-col gap-1.5 sm:min-w-0">
          <span className={GROUP_LABEL}>Patches · dates are Gameplay Updates</span>
          <div className="flex gap-[3px]">
            {patches.map((patch) => (
              <button
                key={`${patch.name}-${patch.start_week}`}
                type="button"
                title={`${patch.name} · weeks ${patch.start_week}–${patch.end_week}`}
                aria-label={`${patch.name}, weeks ${patch.start_week} to ${patch.end_week}`}
                onClick={() => choose([patch.start_week, patch.end_week])}
                style={bandStyle(patch)}
                className={`flex flex-col gap-px rounded-md border px-[7px] py-1.5 text-left transition-colors duration-200 hover:bg-hover ${bandTone(
                  patch,
                  draft,
                )}`}
              >
                <span className="truncate text-[11px] font-semibold">{shortPatchName(patch.name)}</span>
                <span className="truncate text-[10px] text-dim">
                  {shortPatchName(patch.name) === patch.name ? "Weeks " : "Wk "}
                  {patch.start_week === patch.end_week
                    ? patch.start_week
                    : `${patch.start_week}–${patch.end_week}`}
                </span>
              </button>
            ))}
          </div>

          <span className={`${GROUP_LABEL} mt-1.5`}>Weeks · bar height = matches played</span>
          <div className="flex gap-[3px]">
            {patches.map((patch) => (
              <div key={`${patch.name}-${patch.start_week}`} style={bandStyle(patch)} className="flex h-12 gap-px">
                {Array.from({ length: patch.end_week - patch.start_week + 1 }, (_, i) => {
                  const week = patch.start_week + i;
                  const matches = byWeek.get(week)?.matches ?? 0;
                  const on = week >= draft[0] && week <= draft[1];
                  const label = `Week ${week}, ${matches ? `${matches} matches` : "no games"}`;
                  return (
                    <button
                      key={week}
                      type="button"
                      title={`Week ${week} · ${matches ? `${matches} matches` : "no games"}`}
                      aria-label={label}
                      aria-pressed={on}
                      onClick={() => clickWeek(week)}
                      className={`flex h-full min-w-0 flex-1 items-end rounded-[2px] transition-colors hover:bg-hover ${
                        on ? "bg-accent-bg" : "bg-transparent"
                      }`}
                    >
                      <span
                        className={`block w-full rounded-[2px] ${
                          matches ? (on ? "bg-accent" : "bg-hover") : "bg-border-lighter"
                        }`}
                        style={{ height: matches ? `${(matches / maxMatches) * 100}%` : 3 }}
                      />
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
          <div className="flex gap-[3px]">
            {patches.map((patch) => (
              <span
                key={`${patch.name}-${patch.start_week}`}
                style={bandStyle(patch)}
                className="text-[10px] text-dim"
              >
                {patch.start_week}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3.5">
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-semibold text-primary">
            {weeksLabel(draft, weeks)} · {count} matches
          </span>
          <span className="text-[12px] text-muted">
            {rangeDetail(draft, patches, { pending: pendingWeek != null })}
          </span>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="accent" onClick={() => onApply(draft)}>
            Show {count} matches
          </Button>
        </div>
      </div>
    </div>
  );
}
