import React from "react";
import { delta } from "../../utils/playerStats";

const KIND_CLASS = {
  better: "border-transparent bg-success-bg text-success",
  worse: "border-transparent bg-danger-bg text-danger-text",
  flat: "border-transparent bg-badge-bg text-muted",
  none: "border-dashed border-border-lighter text-dim",
};

/**
 * Change against a league baseline.
 *
 *   unit="pts"  win rates, shown in percentage points ("+15.2 pts")
 *   unit="pct"  everything else, shown as a percentage change ("+12%")
 *   invert      metrics where lower is better (deaths, deaths/min)
 *
 * With no baseline computed yet this renders a dashed "—" rather than inventing
 * a comparison — that is the state every tile is in until the league-average
 * endpoint exists.
 */
export default function DeltaBadge({
  value,
  baseline,
  unit = "pct",
  invert = false,
  title,
  className = "",
}) {
  const result = delta(value, baseline, { unit, invert });

  return (
    <span
      className={`inline-flex items-center rounded-full border px-[7px] py-[2px] text-[11px] font-bold tabular-nums ${KIND_CLASS[result.kind]} ${className}`}
      title={title}
    >
      {result.kind === "none" ? "—" : result.label}
    </span>
  );
}
