import React, { useMemo, useState } from "react";
import SectionCard from "../SectionCard";
import { formatDuration } from "../../utils/format";
import { buyTimingBars, earlyLateSplit, slotColor, winRateColor } from "../../utils/items";

const pct = (value) => `${Number(value).toFixed(1)}%`;
const CHART_H = 220;

function Legend({ slot }) {
  return (
    <div className="flex gap-3.5 pt-1 text-[12px] text-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-2.5 w-2.5 rounded-[2px]" style={{ background: slotColor(slot, "66") }} />
        Purchases
      </span>
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-3.5 bg-primary" />
        Win rate
      </span>
    </div>
  );
}

function SplitCell({ side, label, minGames }) {
  const enough = side.games >= minGames;
  return (
    <div className="flex items-baseline gap-2.5 rounded-lg border border-border bg-table px-3.5 py-2.5">
      <span
        className="font-valve-oracle text-[26px] leading-none"
        style={{ color: side.win == null ? "var(--color-muted)" : winRateColor(side.win, !enough) }}
      >
        {side.win == null ? "—" : pct(side.win)}
      </span>
      <span className="text-[13px] text-muted">
        {label} · {side.games} game{side.games === 1 ? "" : "s"}
      </span>
    </div>
  );
}

function BucketTooltip({ bar, minGames }) {
  return (
    <div
      className="pointer-events-none absolute left-1/2 z-[5] flex w-[170px] -translate-x-1/2 flex-col gap-[3px] rounded-lg border border-border-lighter bg-panel px-3 py-2.5 text-[12px] text-secondary shadow-[0_20px_60px_rgba(0,0,0,.4)]"
      style={{ bottom: `calc(${bar.y}% + 14px)` }}
    >
      <span className="font-semibold text-primary">{bar.label} min</span>
      <span>
        {bar.purchases} purchase{bar.purchases === 1 ? "" : "s"} · {pct(bar.share)} of all
      </span>
      <span style={{ color: winRateColor(bar.win, bar.low) }}>
        {pct(bar.win)} win ({bar.wins}–{bar.purchases - bar.wins}){bar.low ? " · low sample" : ""}
      </span>
      {bar.low && <span className="sr-only">Fewer than {minGames} purchases</span>}
    </div>
  );
}

function Chart({ bars, slot, minGames }) {
  const [hover, setHover] = useState(null);
  const points = bars
    .map((bar, index) => (bar.y == null ? null : `${((index + 0.5) / bars.length) * 700},${CHART_H - (bar.y / 100) * CHART_H}`))
    .filter(Boolean)
    .join(" ");

  return (
    <div className="grid grid-cols-[34px_minmax(0,1fr)] gap-2">
      <div className="relative text-right text-[10px] text-dim" style={{ height: CHART_H }}>
        <span className="absolute -top-1.5 right-0">80%</span>
        <span className="absolute top-[calc(50%-6px)] right-0">50%</span>
        <span className="absolute right-0 -bottom-1.5">20%</span>
      </div>
      <div
        className="relative border-b border-l border-border-light"
        style={{ height: CHART_H }}
        onMouseLeave={() => setHover(null)}
      >
        <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-border-lighter" />
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
          {bars.map((bar, index) => {
            const active = hover === index && bar.purchases > 0;
            return (
              <div
                key={bar.label}
                className="relative flex h-full items-end px-1.5 md:px-2"
                onMouseEnter={() => setHover(index)}
                onClick={() => setHover((current) => (current === index ? null : index))}
              >
                {bar.purchases > 0 && (
                  <>
                    <div
                      className="w-full rounded-t transition-colors duration-200"
                      style={{
                        height: `${bar.height}%`,
                        background: active
                          ? slotColor(slot, "99")
                          : bar.low
                            ? `repeating-linear-gradient(45deg, ${slotColor(slot, "40")} 0 3px, transparent 3px 7px)`
                            : slotColor(slot, "59"),
                        border: bar.low ? `1px dashed ${slotColor(slot, "80")}` : "1px solid transparent",
                        borderBottom: 0,
                      }}
                    />
                    <span
                      className="absolute inset-x-0 text-center text-[11px] text-dim"
                      style={{ bottom: `calc(${bar.height}% + 4px)` }}
                    >
                      {bar.purchases}
                    </span>
                    <span
                      className="absolute left-1/2 z-[2] -mb-[5px] -ml-[5px] h-[9px] w-[9px] rounded-full border-2 border-primary"
                      style={{ bottom: `${bar.y}%`, background: bar.low ? "var(--color-card)" : "var(--color-primary)" }}
                    />
                  </>
                )}
                {active && <BucketTooltip bar={bar} minGames={minGames} />}
              </div>
            );
          })}
        </div>
        <svg
          viewBox={`0 0 700 ${CHART_H}`}
          preserveAspectRatio="none"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[1] h-full w-full"
        >
          <polyline
            points={points}
            fill="none"
            stroke="white"
            strokeOpacity="0.85"
            strokeWidth="2"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
      <span />
      <div
        className="grid text-center text-[11px] text-dim"
        style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}
      >
        {bars.map((bar) => (
          <span key={bar.label}>{bar.label}</span>
        ))}
      </div>
    </div>
  );
}

function BuyList({ buys }) {
  if (!buys?.length) return <p className="text-[13px] text-dim">No purchases under these filters.</p>;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] text-muted">Not enough purchases to chart. Showing each buy instead:</span>
      <div className="flex flex-wrap gap-2 text-[12px] tabular-nums">
        {buys.map((buy, index) => (
          <span key={`${buy.match_id}-${index}`} className="rounded-md bg-table px-2 py-[3px] text-secondary">
            {formatDuration(buy.buy_s)} · <b className={buy.won ? "text-success" : "text-danger-text"}>{buy.won ? "W" : "L"}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * When the item gets bought (first purchase, 5-minute buckets) and how often
 * those games are won. Under the min-games threshold the chart gives way to
 * the individual buys, which say more than a chart of two or three points.
 */
export default function BuyTimingPanel({ buckets, buys, slot, minGames, low }) {
  const bars = useMemo(() => buyTimingBars(buckets, minGames), [buckets, minGames]);
  const split = useMemo(() => earlyLateSplit(buckets), [buckets]);

  return (
    <SectionCard
      title="Buy Timing"
      subtitle="When it gets bought, and how often those games are won"
      action={!low && <Legend slot={slot} />}
    >
      {low && buys ? (
        <BuyList buys={buys} />
      ) : (
        <div className="flex flex-col gap-3.5">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">
            <SplitCell side={split.early} label="win when bought before 15:00" minGames={minGames} />
            <SplitCell side={split.late} label="win when bought after 25:00" minGames={minGames} />
          </div>
          <Chart bars={bars} slot={slot} minGames={minGames} />
          <span className="text-[12px] text-dim">
            Minutes of game time, 5-minute buckets. Hollow points have fewer than {minGames} purchases.
          </span>
        </div>
      )}
    </SectionCard>
  );
}
