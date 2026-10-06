import React from "react";
import { bracketLayout, roundColumns, teamInitials } from "../../utils/weekData";

/**
 * BracketCard — one row per region: the region summary on the left and that
 * region's semifinal/grand-final bracket on the right.
 *
 * Props:
 *   brackets         – per-region brackets from `buildRegionBrackets`
 *   scopeLabel       – text under "STATS SHOWING"
 *   activeRegion     – 'all' | 'na' | 'eu'
 *   selectedSeries   – the selected series' key, or null
 *   onSelectSeries   – (key | null) => void
 *   onSelectRegion   – (region | 'all') => void
 */
export default function BracketCard({
  brackets,
  scopeLabel,
  activeRegion,
  selectedSeries,
  onSelectSeries,
  onSelectRegion,
}) {
  const columns = roundColumns(brackets);

  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-card shadow">
      <div className="flex items-end justify-between gap-4 px-5 py-4">
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-semibold tracking-[.12em] text-dim uppercase">
            Stats showing
          </span>
          <span className="font-valve-oracle text-[18px] text-primary">{scopeLabel}</span>
        </div>
        {selectedSeries && (
          <button
            type="button"
            onClick={() => onSelectSeries(null)}
            className="rounded-full border border-border-light bg-panel px-3 py-1.5 text-[12px] font-semibold text-secondary transition-colors hover:bg-hover"
          >
            Whole week
          </button>
        )}
      </div>

      <div className="grid grid-cols-[200px_356px] gap-x-8 border-t border-border bg-table px-5 py-2">
        <span className="text-[11px] font-semibold tracking-[.1em] text-dim uppercase">Region</span>
        <div className="flex gap-9">
          <span className="w-[160px] text-center text-[11px] font-semibold tracking-[.1em] text-dim uppercase">
            {columns[0]}
          </span>
          <span className="w-[160px] text-center text-[11px] font-semibold tracking-[.1em] text-dim uppercase">
            {columns[1]}
          </span>
        </div>
      </div>

      {brackets.map((bracket) => {
        const regionActive = !selectedSeries && activeRegion === bracket.name.toLowerCase();
        const faded = selectedSeries
          ? bracket.series.some((series) => series.key === selectedSeries)
            ? false
            : true
          : activeRegion !== "all" && activeRegion !== bracket.name.toLowerCase();

        return (
          <div
            key={bracket.name}
            className={`grid grid-cols-[200px_356px] items-center gap-8 border-t border-border px-5 py-4 transition-colors ${
              regionActive ? "bg-accent-bg" : "bg-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() =>
                onSelectRegion(regionActive ? "all" : bracket.name.toLowerCase())
              }
              className="flex flex-col items-start gap-1 text-left"
            >
              <span
                className={`font-valve-pulp text-[26px] tracking-[.04em] ${
                  regionActive ? "text-accent-light" : "text-primary"
                }`}
              >
                {bracket.name}
              </span>
              <span className="text-[12px] text-muted">
                Won by{" "}
                <span className="font-semibold text-primary">{bracket.champ || "—"}</span>
              </span>
              <span className="text-[12px] font-semibold text-accent-light">
                {regionActive ? "Show both" : `Only ${bracket.name}`} →
              </span>
            </button>

            <div
              className="scroll-thin overflow-x-auto transition-opacity duration-200"
              style={{ opacity: faded ? (selectedSeries ? 0.4 : 0.35) : 1 }}
            >
              <Bracket
                bracket={bracket}
                selectedSeries={selectedSeries}
                onSelectSeries={onSelectSeries}
              />
            </div>
          </div>
        );
      })}

      <div className="border-t border-border px-5 py-2.5">
        <span className="text-[12px] text-dim">
          Click a series to narrow every stat below to it. Click it again to go back.
        </span>
      </div>
    </section>
  );
}

const CARD_WIDTH = 160;
const ROW_HEIGHT = 25;

function Bracket({ bracket, selectedSeries, onSelectSeries }) {
  const layout = bracketLayout(bracket);

  return (
    <div className="relative" style={{ width: layout.width, height: layout.height }}>
      {layout.lines.map((line, index) => (
        <div
          key={`line-${index}`}
          className="absolute bg-border-lighter"
          style={{ left: line.left, top: line.top, width: line.width, height: line.height }}
        />
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
            title={`Best of ${series.games.length > 2 ? 3 : 1} · ${series.teamA} ${series.scoreA}–${series.scoreB} ${series.teamB}`}
            className={`absolute cursor-pointer rounded-md border transition-colors hover:border-accent-border-strong ${
              selected ? "border-accent-border-strong bg-accent-bg-strong" : "border-border-light bg-card"
            }`}
            style={{ left, top, width: CARD_WIDTH }}
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
        {name}
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
