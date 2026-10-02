import React from "react";
import { Link } from "react-router-dom";
import Widget from "./Widget";

/**
 * SeasonStatsWidget — placeholder for the season totals panel.
 *
 * The real Series / Matches / Players aggregates are still being scoped, so
 * this deliberately renders an empty state rather than numbers that would go
 * stale or mislead.
 */
export default function SeasonStatsWidget() {
  return (
    <Widget title="This Season">
      <p className="text-sm text-muted leading-relaxed">
        Season totals are being reworked.
      </p>
      <p className="mt-1 text-xs text-dim">Check back soon.</p>
      <Link
        to="/stats"
        className="mt-3 inline-block text-[12px] font-semibold text-accent-light hover:text-accent transition-colors"
      >
        Browse site stats →
      </Link>
    </Widget>
  );
}
