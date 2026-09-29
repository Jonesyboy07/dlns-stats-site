import React from "react";
import { formStrip } from "../../utils/playerStats";
import { RESULT_SQUARE_CLASS, resultGlyph } from "./resultStyles";

/**
 * Last-N form, oldest → newest, with the letter printed in every square (no
 * hover-only information). A short history pads on the left so the most recent
 * game is always the rightmost square.
 */
export default function FormStrip({
  matches = [],
  size = 10,
  showSummary = true,
  label = null,
  direction = "column",
  className = "",
}) {
  const { slots, summary } = formStrip(matches, size);

  return (
    <div
      className={`flex gap-1.5 ${
        direction === "row" ? "flex-row items-center" : "flex-col items-end"
      } ${className}`}
    >
      <span className="text-[10px] uppercase tracking-[.06em] text-dim">
        {label ?? `Last ${size} · oldest → newest`}
      </span>
      <div className="flex gap-[3px]">
        {slots.map((slot, index) =>
          slot ? (
            <span
              key={index}
              title={slot.title}
              className={`flex h-5 w-5 items-center justify-center rounded text-[10px] font-bold ${RESULT_SQUARE_CLASS[slot.outcome]}`}
            >
              {resultGlyph(slot.outcome)}
            </span>
          ) : (
            <span
              key={index}
              aria-hidden="true"
              className="h-5 w-5 rounded border border-dashed border-border-dashed"
            />
          ),
        )}
      </div>
      {showSummary && <span className="text-xs text-muted">{summary}</span>}
    </div>
  );
}
