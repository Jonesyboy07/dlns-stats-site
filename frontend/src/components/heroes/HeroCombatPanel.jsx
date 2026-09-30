import React from "react";
import Panel from "../player/Panel";
import { AddingSoon } from "./PlaceholderPanel";

const DELTA_TONE = { good: "text-success", bad: "text-danger-text" };

/**
 * Combat & Economy: per-minute and per-game averages. Tiles whose stat the API
 * cannot supply yet render an "Adding Soon" placeholder instead of a value.
 */
function HeroCombatPanel({ cells = [] }) {
  return (
    <Panel
      title="Combat & Economy"
      subtitle="Per-minute and per-game averages vs the league-average hero"
    >
      <div
        className="grid gap-2"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}
      >
        {cells.map((cell) => (
          <div
            key={cell.label}
            className="flex min-w-0 flex-col gap-1 rounded-lg border border-border bg-table px-3 py-2.5"
          >
            <span
              title={cell.label}
              className="truncate text-[11px] uppercase tracking-[.05em] text-dim"
            >
              {cell.label}
            </span>
            {cell.soon ? (
              <AddingSoon />
            ) : (
              <>
                <span className="font-valve-oracle text-[22px] leading-none text-primary">
                  {cell.value}
                </span>
                <span className="whitespace-nowrap text-[12px] text-dim">
                  avg {cell.avg}{" "}
                  <span className={`font-semibold ${DELTA_TONE[cell.tone] ?? ""}`}>
                    {cell.delta}
                  </span>
                </span>
              </>
            )}
          </div>
        ))}
      </div>
    </Panel>
  );
}

export default HeroCombatPanel;
