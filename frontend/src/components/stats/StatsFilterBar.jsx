import React, { useEffect, useRef, useState } from "react";
import Button from "../Button";
import MobileFilterSheet from "./MobileFilterSheet";
import PeriodPicker from "./PeriodPicker";
import { defaultRange, matchesInRange, patchLabel, weeksLabel } from "../../utils/statsPeriod";

const GROUP_LABEL = "text-[11px] font-semibold uppercase tracking-[0.08em] text-dim";
const GLASS =
  "border border-border-light bg-[color-mix(in_oklch,var(--color-panel)_82%,transparent)] backdrop-blur-[10px] shadow-[var(--shadow-panel)]";
const COPIED_MS = 1600;

function RegionControl({ regions, value, onChange }) {
  return (
    <div className="flex gap-0.5 rounded-full border border-border-light bg-input p-[3px]">
      {["All", ...regions].map((option) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={`rounded-full px-3.5 py-[5px] text-[13px] font-semibold transition-colors duration-200 active:scale-[.97] ${
            value === option ? "bg-accent-bg-strong text-accent-light" : "text-muted hover:text-secondary"
          }`}
        >
          {option}
        </button>
      ))}
    </div>
  );
}

/**
 * The sticky filter bar: one Period control (weeks and patches merged), the
 * region, the match count and Copy link. On phones it is a single Filters pill
 * that opens the filter sheet.
 */
export default function StatsFilterBar({
  weeks,
  patches,
  regions,
  range,
  region,
  onRange,
  onRegion,
  onFilters,
  shareUrl,
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const barRef = useRef(null);

  useEffect(() => {
    if (!pickerOpen) return undefined;
    const onKey = (event) => event.key === "Escape" && setPickerOpen(false);
    const onPointer = (event) => {
      if (barRef.current && !barRef.current.contains(event.target)) setPickerOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [pickerOpen]);

  useEffect(() => {
    if (!copied) return undefined;
    const id = setTimeout(() => setCopied(false), COPIED_MS);
    return () => clearTimeout(id);
  }, [copied]);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
    } catch {
      window.prompt("Copy this link", shareUrl);
    }
  };

  const ready = Boolean(range && weeks.length);
  const count = ready ? matchesInRange(range, weeks, region) : 0;
  const weeksText = ready ? weeksLabel(range, weeks) : "Loading…";
  const patchText = ready ? patchLabel(range, weeks, patches) : "";
  const regionText = region === "All" ? "All regions" : region;
  const fallback = defaultRange(weeks);
  const changed =
    (ready && fallback && (range[0] !== fallback[0] || range[1] !== fallback[1]) ? 1 : 0) +
    (region !== "All" ? 1 : 0);

  return (
    <>
      <div
        ref={barRef}
        className={`sticky top-2 z-[5] hidden flex-wrap items-center gap-x-5 gap-y-3 rounded-2xl px-3.5 py-2.5 md:flex ${GLASS}`}
      >
        <div className="flex items-center gap-2">
          <span className={GROUP_LABEL}>Period</span>
          <button
            type="button"
            disabled={!ready}
            aria-expanded={pickerOpen}
            aria-haspopup="dialog"
            onClick={() => setPickerOpen((open) => !open)}
            className={`flex items-center gap-2.5 rounded-lg border px-3 py-[7px] text-[13px] text-primary transition-colors duration-200 active:translate-y-px ${
              pickerOpen ? "border-accent-border bg-accent-bg" : "border-border-light bg-input hover:bg-hover"
            }`}
          >
            <span className="font-semibold">{weeksText}</span>
            {patchText && (
              <>
                <span aria-hidden="true" className="h-3.5 w-px bg-border-lighter" />
                <span className="text-secondary">{patchText}</span>
              </>
            )}
            <span aria-hidden="true" className="text-dim">
              {pickerOpen ? "▴" : "▾"}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className={GROUP_LABEL}>Region</span>
          <RegionControl regions={regions} value={region} onChange={onRegion} />
        </div>

        <div className="ml-auto flex items-center gap-3">
          <span className="text-[13px] text-dim">{ready ? `${count} matches` : ""}</span>
          <Button onClick={copyLink} disabled={!ready}>
            {copied ? "Link copied" : "Copy link"}
          </Button>
        </div>

        {pickerOpen && ready && (
          <PeriodPicker
            weeks={weeks}
            patches={patches}
            range={range}
            region={region}
            onCancel={() => setPickerOpen(false)}
            onApply={(next) => {
              onRange(next);
              setPickerOpen(false);
            }}
          />
        )}
      </div>

      <div className={`sticky top-2 z-[5] flex items-center gap-2.5 rounded-2xl p-2 md:hidden ${GLASS}`}>
        <button
          type="button"
          disabled={!ready}
          onClick={() => setSheetOpen(true)}
          className="flex min-h-10 shrink-0 items-center gap-2 rounded-full border border-accent-border bg-accent-bg-strong px-3.5 text-[14px] font-semibold text-accent-light"
        >
          Filters
          {changed > 0 && (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-accent px-1.5 text-[12px] font-bold text-[#170a26]">
              {changed}
            </span>
          )}
        </button>
        <span className="min-w-0 truncate text-[13px] text-muted">
          {[weeksText, patchText, regionText].filter(Boolean).join(" · ")}
        </span>
      </div>

      {sheetOpen && ready && (
        <MobileFilterSheet
          weeks={weeks}
          patches={patches}
          range={range}
          region={region}
          regions={regions}
          onClose={() => setSheetOpen(false)}
          onApply={(nextRange, nextRegion) => {
            onFilters(nextRange, nextRegion);
            setSheetOpen(false);
          }}
        />
      )}
    </>
  );
}
