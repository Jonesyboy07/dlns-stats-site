import React from "react";
import { BRACKET_SIZES, bracketLayout, roundColumns } from "../../utils/weekData";
import BracketBoard from "./BracketBoard";

const CARD_WIDTH = BRACKET_SIZES.desktop.card;

/**
 * BracketCard — one row per region: the region summary on the left and that
 * region's bracket on the right.
 *
 * Props:
 *   brackets         – per-region brackets from `buildBrackets`
 *   week             – the Night Shift number, for the berth captions
 *   scopeLabel       – text under "STATS SHOWING"
 *   activeRegion     – 'all' | 'na' | 'eu'
 *   selectedSeries   – the selected series' key, or null
 *   onSelectSeries   – (key | null) => void
 *   onSelectRegion   – (region | 'all') => void
 */
export default function BracketCard({
  brackets,
  week,
  scopeLabel,
  activeRegion,
  selectedSeries,
  onSelectSeries,
  onSelectRegion,
}) {
  const columns = roundColumns(brackets);
  /* One grid for the whole card: every region shares the widest bracket, so the
     round headers sit over the columns they name. */
  const layouts = (brackets || []).map((bracket) => ({
    bracket,
    layout: bracketLayout(bracket, week, BRACKET_SIZES.desktop),
  }));
  const gridStyle = {
    gridTemplateColumns: `200px ${layouts.reduce(
      (widest, entry) => Math.max(widest, entry.layout.width),
      0,
    )}px`,
  };
  /* The headers follow the cards' column pitch, which the three-team shape widens
     to fit the berth caption. */
  const headerStyle = {
    gridTemplateColumns: `repeat(${columns.length}, ${CARD_WIDTH}px)`,
    columnGap: Math.max(
      0,
      layouts.reduce((widest, entry) => Math.max(widest, entry.layout.pitch), 0) - CARD_WIDTH,
    ),
  };

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

      <div
        className="grid gap-x-8 border-t border-border bg-table px-5 py-2"
        style={gridStyle}
      >
        <span className="text-[11px] font-semibold tracking-[.1em] text-dim uppercase">Region</span>
        <div className="grid" style={headerStyle}>
          {columns.map((name, index) => (
            <span
              key={`${name}-${index}`}
              className="w-[160px] shrink-0 text-center text-[11px] font-semibold tracking-[.1em] text-dim uppercase"
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      {layouts.map(({ bracket, layout }) => {
        const regionActive = !selectedSeries && activeRegion === bracket.name.toLowerCase();
        const faded = selectedSeries
          ? bracket.series.some((series) => series.key === selectedSeries)
            ? false
            : true
          : activeRegion !== "all" && activeRegion !== bracket.name.toLowerCase();

        return (
          <div
            key={bracket.name}
            className={`grid items-center gap-8 border-t border-border px-5 py-4 transition-colors ${
              regionActive ? "bg-accent-bg" : "bg-transparent"
            }`}
            style={gridStyle}
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
              <BracketBoard
                layout={layout}
                cardWidth={CARD_WIDTH}
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
