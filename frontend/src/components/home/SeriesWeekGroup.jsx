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
    <div className="flex flex-col gap-1.5">
      {/* The group is no longer a panel: just a divider row over a card stack. */}
      <Link
        to={weekUrl}
        className="mb-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-light"
      >
        <span className="font-valve-pulp text-[22px] text-primary">
          {seriesTitle} #{week}
        </span>
        <span className="h-px flex-1 bg-border-light" aria-hidden="true" />
        {summary && <span className="text-[12px] text-dim">{summary}</span>}
      </Link>

      <div className="flex flex-col gap-1.5">
        {entries.map((entry) => (
          <SeriesRow key={entry.firstMatchId} entry={entry} />
        ))}
      </div>
    </div>
  );
}
