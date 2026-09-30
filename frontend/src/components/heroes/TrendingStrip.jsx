import React from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import { formatPercent } from "../../utils/heroPages";

/**
 * "Trending This Week" — the four heroes with the biggest absolute win-rate move
 * between the two most recent league weeks. A link per hero into its detail page.
 */
function TrendingStrip({ items, currentWeek, previousWeek }) {
  if (!items || items.length === 0) return null;

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border-light bg-card px-5 py-4 shadow">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="font-valve-oracle text-[18px] leading-tight text-primary">
          Trending This Week
        </h2>
        {currentWeek != null && previousWeek != null && (
          <span className="text-[12px] text-dim">
            Biggest win-rate moves, Week {previousWeek} → Week {currentWeek}
          </span>
        )}
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))" }}>
        {items.map((item) => {
          const up = item.delta >= 0;
          return (
            <Link
              key={item.heroId}
              to={`/hero/${item.heroId}`}
              className="flex min-w-0 items-center gap-3 rounded-lg border border-border bg-table px-3 py-2.5 transition-colors hover:bg-hover"
            >
              <HeroIcon name={item.name} size="h-10 w-10" />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span
                  title={item.name}
                  className="truncate text-[14px] font-semibold text-primary"
                >
                  {item.name}
                </span>
                <span className="text-[12px] text-muted">
                  Win {formatPercent(item.winRate)} · Pick {formatPercent(item.pickRate)}
                </span>
              </div>
              <span
                className={`ml-auto whitespace-nowrap text-[13px] font-bold ${
                  up ? "text-success" : "text-danger-text"
                }`}
              >
                {up ? "▲ +" : "▼ −"}
                {Math.abs(item.delta).toFixed(1)} pts
              </span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

export default TrendingStrip;
