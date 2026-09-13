import React from "react";
import { Link } from "react-router-dom";
import SeriesRow from "./SeriesRow";

/**
 * SeriesWeekGroup — one week panel: a linked header (week number, date and
 * series count) plus every series played that week.
 *
 * Props:
 *   week         – week number
 *   seriesTitle  – event title, e.g. "Night Shift"
 *   entries      – series groups for the week
 *   dateLabel    – preformatted "1 Aug 2026" (or null when unknown)
 *   totalSeries  – number of series in the week
 */
export default function SeriesWeekGroup({
  week,
  seriesTitle,
  entries,
  dateLabel,
  totalSeries,
}) {
  const weekUrl = `/week/${week}?event_title=${encodeURIComponent(seriesTitle)}`;
  const summary = [dateLabel, `${totalSeries} series`]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-panel">
      <Link
        to={weekUrl}
        className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-accent-secondary-border bg-accent-secondary-bg px-5 py-3 transition-colors hover:bg-accent-secondary-bg-strong focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-secondary-light"
      >
        <span className="text-sm font-semibold text-accent-secondary-light">
          {seriesTitle} #{week}
        </span>
        {summary && <span className="text-[11px] text-dim">{summary}</span>}
      </Link>

      <div className="divide-y divide-border-dashed">
        {entries.map((entry) => (
          <SeriesRow key={entry.firstMatchId} entry={entry} />
        ))}
      </div>
    </div>
  );
}
