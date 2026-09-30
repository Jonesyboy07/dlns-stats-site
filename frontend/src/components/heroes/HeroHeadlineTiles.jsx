import React from "react";

const DELTA_TONE = {
  good: "border-success-border bg-success-bg text-success",
  bad: "border-danger-border bg-danger-bg text-danger-text",
};

/**
 * The five headline tiles (Win rate, Pick rate, Ban rate, Games, Wins) plus the
 * three per-minute StatCards underneath. Every tile may carry a delta pill, a
 * W–L fragment and a rank line; the caller decides which are populated.
 */
function HeroHeadlineTiles({ tiles = [], rates = [] }) {
  return (
    <>
      <div
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {tiles.map((tile) => (
          <div
            key={tile.label}
            className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border-light bg-card px-4 py-4 shadow"
          >
            <span className="text-[12px] uppercase tracking-[.05em] text-muted">
              {tile.label}
            </span>
            <div className="flex flex-wrap items-baseline gap-2.5">
              <span className="font-valve-oracle text-[34px] leading-none text-primary">
                {tile.value}
              </span>
              {tile.delta && (
                <span
                  title={tile.delta.title}
                  className={`whitespace-nowrap rounded-full border px-2 py-[3px] text-[12px] font-bold ${
                    DELTA_TONE[tile.delta.tone]
                  }`}
                >
                  {tile.delta.text}
                </span>
              )}
              {tile.wl && (
                <span className="whitespace-nowrap text-[14px] font-semibold">
                  <span className={tile.wl.wins >= tile.wl.losses ? "text-success" : "text-secondary"}>
                    {tile.wl.wins}W
                  </span>
                  <span className="text-dim"> – </span>
                  <span className={tile.wl.losses > tile.wl.wins ? "text-danger-text" : "text-secondary"}>
                    {tile.wl.losses}L
                  </span>
                </span>
              )}
            </div>
            <span className="text-[12px] text-dim">{tile.sub}</span>
            <span
              className={`text-[13px] font-semibold ${
                tile.rankDim ? "text-dim" : "text-accent-secondary-light"
              }`}
            >
              {tile.rank}
            </span>
          </div>
        ))}
      </div>

      {rates.length > 0 && (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
        >
          {rates.map((rate) => (
            <div key={rate.label} className="flex flex-col gap-1.5">
              <div className="flex flex-col gap-1 rounded-xl border border-border-light bg-card px-4 py-3.5 shadow">
                <span className="text-[12px] uppercase tracking-[.05em] text-muted">
                  {rate.label}
                </span>
                <span className="font-valve-oracle text-[28px] leading-none text-primary">
                  {rate.value}
                </span>
              </div>
              <span className="px-1 text-[12px] text-dim">{rate.caption}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

export default HeroHeadlineTiles;
