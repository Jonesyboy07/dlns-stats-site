import React from "react";
import Panel from "../player/Panel";
import { formatInteger } from "../../utils/format";
import { formatPercent } from "../../utils/heroPages";

const DASH = "—";

/** The Combat & Economy cells, in the design's order. */
const CELLS = [
  { label: "Kills", key: "kills", digits: 1 },
  { label: "Deaths", key: "deaths", digits: 1, lower: true },
  { label: "Assists", key: "assists", digits: 1 },
  { label: "Last hits", key: "last_hits", digits: 1 },
  { label: "Denies", key: "denies", digits: 1 },
  { label: "Hit %", key: "hit_pct", percent: true },
  { label: "Objective dmg", key: "obj_damage", integer: true },
  { label: "Healing", key: "healing", integer: true },
  { label: "Pings / game", key: "pings", digits: 1 },
  { label: "Avg level", key: "level", digits: 1 },
];

function formatCell(cell, value) {
  if (value == null) return DASH;
  if (cell.percent) return formatPercent(value);
  if (cell.integer) return formatInteger(value);
  return Number(value).toFixed(cell.digits);
}

/**
 * Combat & Economy: per-game averages, each against the league average. A missing
 * stat reads "—" rather than a fake zero.
 */
function HeroCombatPanel({ combat, league }) {
  return (
    <Panel title="Combat & Economy" subtitle="Per-game averages vs the league-average hero">
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {CELLS.map((cell) => {
          const value = combat?.[cell.key];
          const average = league?.[cell.key];
          const diff = value != null && average != null ? value - average : null;
          const good = diff == null ? null : cell.lower ? diff < 0 : diff > 0;
          return (
            <div
              key={cell.key}
              className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-table px-3 py-2.5"
            >
              <span
                title={cell.label}
                className="truncate text-[11px] uppercase tracking-[.05em] text-dim"
              >
                {cell.label}
              </span>
              <span className="font-valve-oracle text-[22px] leading-none text-primary">
                {formatCell(cell, value)}
              </span>
              <span className="whitespace-nowrap text-[12px] text-dim">
                avg {formatCell(cell, average)}{" "}
                <span
                  className={`font-semibold ${
                    good == null ? "" : good ? "text-success" : "text-danger-text"
                  }`}
                >
                  {diff == null
                    ? ""
                    : `${diff >= 0 ? "+" : "−"}${formatCell(cell, Math.abs(diff))}`}
                </span>
              </span>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

export default HeroCombatPanel;
