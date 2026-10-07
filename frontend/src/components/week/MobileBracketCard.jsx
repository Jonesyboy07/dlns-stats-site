import React from "react";
import { BRACKET_SIZES, bracketLayout, roundColumns } from "../../utils/weekData";
import BracketBoard from "./BracketBoard";

const CARD_WIDTH = BRACKET_SIZES.mobile.card;

/**
 * MobileBracketCard — the 13b bracket: the same regions and series as the desktop
 * card, stacked one region per block with the round labels written above each
 * bracket instead of a column-header row.
 *
 * The mobile frame's gutter is too narrow for the berth caption, so the layout
 * reports the berth instead and it is named under the bracket.
 *
 * Props match BracketCard, minus the desktop grid measurements.
 */
export default function MobileBracketCard({
  brackets,
  week,
  scopeLabel,
  activeRegion,
  selectedSeries,
  onSelectSeries,
  onSelectRegion,
}) {
  const columns = roundColumns(brackets);
  const layouts = (brackets || []).map((bracket) => ({
    bracket,
    layout: bracketLayout(bracket, week, BRACKET_SIZES.mobile),
  }));

  return (
    <section className="overflow-hidden rounded-xl border border-border-light bg-card shadow">
      <div className="flex items-center justify-between gap-3 px-4 py-3.5">
        <div className="flex min-w-0 flex-col gap-[3px]">
          <span className="text-[11px] font-semibold tracking-[.1em] text-dim uppercase">
            Stats showing
          </span>
          <span className="font-valve-oracle text-[15px] text-primary">{scopeLabel}</span>
        </div>
        {selectedSeries && (
          <button
            type="button"
            onClick={() => onSelectSeries(null)}
            className="min-h-9 shrink-0 rounded-full border border-border-light bg-panel px-3.5 text-[12px] font-semibold text-secondary"
          >
            Whole week
          </button>
        )}
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
            className={`flex flex-col gap-3 border-t border-border px-3.5 pt-3.5 pb-4 transition-colors ${
              regionActive ? "bg-accent-bg" : "bg-transparent"
            }`}
          >
            <button
              type="button"
              onClick={() => onSelectRegion(regionActive ? "all" : bracket.name.toLowerCase())}
              className="flex min-h-11 items-center justify-between gap-2.5 text-left"
            >
              <span className="flex flex-col gap-0.5">
                <span
                  className={`font-valve-pulp text-[22px] tracking-[.04em] ${
                    regionActive ? "text-accent-light" : "text-primary"
                  }`}
                >
                  {bracket.name}
                </span>
                <span className="text-[12px] text-muted">
                  Won by{" "}
                  <span className="font-semibold text-primary">{bracket.champ || "—"}</span>
                </span>
              </span>
              <span className="shrink-0 text-[12px] font-semibold text-accent-light">
                {regionActive ? "Show both" : `Only ${bracket.name}`} →
              </span>
            </button>

            <div
              className="flex flex-col gap-2 transition-opacity duration-200"
              style={{ opacity: faded ? (selectedSeries ? 0.4 : 0.35) : 1 }}
            >
              <div className="flex gap-8">
                {columns.map((name, index) => (
                  <span
                    key={`${name}-${index}`}
                    className="w-[140px] shrink-0 text-center text-[11px] font-semibold tracking-[.1em] text-dim uppercase"
                  >
                    {name}
                  </span>
                ))}
              </div>

              <BracketBoard
                layout={layout}
                cardWidth={CARD_WIDTH}
                selectedSeries={selectedSeries}
                onSelectSeries={onSelectSeries}
              />

              {layout.berth && (
                <span className="text-[11px] text-dim">Final berth · {layout.berth.text}</span>
              )}
            </div>
          </div>
        );
      })}

      <div className="border-t border-border px-4 py-2.5">
        <span className="text-[12px] text-dim">
          Tap a series to narrow the stats below.
        </span>
      </div>
    </section>
  );
}
