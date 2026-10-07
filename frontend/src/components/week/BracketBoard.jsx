import React from "react";
import { teamInitials } from "../../utils/weekData";

const ROW_HEIGHT = 25;

/**
 * BracketBoard — the absolutely positioned bracket itself: the connector lines,
 * any berth captions and one card per series, drawn from a `bracketLayout`. Shared
 * by the 13a desktop card and the 13b mobile one, which differ only in the card
 * width they draw at.
 *
 * Props:
 *   layout         – from `bracketLayout`
 *   cardWidth      – the width the layout was measured at
 *   selectedSeries – the selected series' key, or null
 *   onSelectSeries – (key | null) => void
 */
export default function BracketBoard({ layout, cardWidth, selectedSeries, onSelectSeries }) {
  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      {layout.lines.map((line, index) => (
        <div
          key={`line-${index}`}
          className="absolute bg-border-lighter"
          style={{ left: line.left, top: line.top, width: line.width, height: line.height }}
        />
      ))}

      {(layout.labels || []).map((label, index) => (
        <span
          key={`${label.text}-${index}`}
          className="pointer-events-none absolute whitespace-nowrap text-[10px] font-semibold text-dim"
          style={{ left: label.left, top: label.top, transform: "translate(-100%, -50%)" }}
        >
          {label.text}
        </span>
      ))}

      {layout.cards.map(({ series, left, top }) => {
        const selected = selectedSeries === series.key;
        return (
          <div
            key={series.key}
            role="button"
            tabIndex={0}
            onClick={() => onSelectSeries(selected ? null : series.key)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onSelectSeries(selected ? null : series.key);
              }
            }}
            title={`Best of ${series.bestOf || (series.games.length > 2 ? 3 : 1)} · ${
              series.teamA || "TBD"
            } ${series.scoreA}–${series.scoreB} ${series.teamB || "TBD"}`}
            className={`absolute cursor-pointer rounded-md border transition-colors hover:border-accent-border-strong ${
              selected
                ? "border-accent-border-strong bg-accent-bg-strong"
                : "border-border-light bg-card"
            }`}
            style={{ left, top, width: cardWidth }}
          >
            <TeamRow
              name={series.teamA}
              score={series.scoreA}
              won={series.winner === "a"}
              first
            />
            <TeamRow name={series.teamB} score={series.scoreB} won={series.winner === "b"} />
          </div>
        );
      })}
    </div>
  );
}

function TeamRow({ name, score, won, first = false }) {
  return (
    <div
      className={`grid items-center gap-[7px] pl-1.5 ${first ? "" : "border-t border-border"}`}
      style={{ gridTemplateColumns: "18px minmax(0,1fr) 24px", height: ROW_HEIGHT }}
    >
      <span className="grid h-[18px] w-[18px] place-items-center rounded-[4px] bg-input text-[8px] font-bold text-muted">
        {teamInitials(name)}
      </span>
      <span
        className={`truncate text-[12px] ${
          won ? "font-bold text-primary" : "font-normal text-muted"
        }`}
      >
        {name || "TBD"}
      </span>
      <span
        className={`grid place-items-center self-stretch bg-input text-[13px] font-bold ${
          won ? "text-primary" : "text-dim"
        }`}
      >
        {score}
      </span>
    </div>
  );
}
