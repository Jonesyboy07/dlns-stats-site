import React from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import { scatterPoints, winColor } from "../../utils/heroMeta";

const QUADRANTS = [
  { label: "Popular & winning", className: "top-2.5 right-3 text-success" },
  { label: "Popular & losing", className: "bottom-2.5 right-3 text-danger-text" },
  { label: "Niche & winning", className: "top-2.5 left-3 text-muted" },
  { label: "Niche & losing", className: "bottom-2.5 left-3 text-dim" },
];

const pct = (value) => `${Number(value).toFixed(1)}%`;

/**
 * Pick rate vs win rate: one portrait per hero, ringed in its win % colour and
 * linking to the hero page. Shared by Overview (a taller plot beside two cards)
 * and Heroes; `plotClassName` sets the plot's height.
 *
 * `heroes` are `{ hero_id, name, picks, wins }`; `games` is the denominator for
 * pick %.
 */
export default function MetaScatter({
  heroes,
  games,
  subtitle = "Each portrait is a hero. Midlines at 50%.",
  plotClassName = "h-[300px] md:h-[460px]",
}) {
  const points = scatterPoints(heroes ?? [], games ?? 0);

  return (
    <SectionCard title="Pick rate vs win rate" subtitle={subtitle}>
      {points.length === 0 ? (
        <p className="py-6 text-center text-[13px] text-dim">No games in range.</p>
      ) : (
        <div className="flex gap-2">
          <div className="rotate-180 text-center text-[11px] uppercase tracking-[0.05em] text-dim [writing-mode:vertical-rl]">
            Win %
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className={`relative overflow-hidden rounded-lg bg-table ${plotClassName}`}>
              <div className="absolute top-0 bottom-0 left-1/2 w-px bg-border-light" />
              <div className="absolute top-1/2 right-0 left-0 h-px bg-border-light" />
              {QUADRANTS.map((quadrant) => (
                <span
                  key={quadrant.label}
                  className={`absolute text-[11px] font-semibold uppercase tracking-[0.05em] ${quadrant.className}`}
                >
                  {quadrant.label}
                </span>
              ))}
              {points.map((point) => (
                <Link
                  key={point.hero_id}
                  to={`/hero/${point.hero_id}`}
                  title={`${point.name} · pick ${pct(point.pick)} · win ${pct(point.win)}`}
                  aria-label={`${point.name}, pick ${pct(point.pick)}, win ${pct(point.win)}`}
                  className="absolute h-[22px] w-[22px] -translate-x-1/2 translate-y-1/2 overflow-hidden rounded-full border-2 bg-card transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:z-[3] hover:scale-[1.35] motion-reduce:transition-none md:h-[30px] md:w-[30px]"
                  style={{
                    left: `calc(18px + (100% - 36px) * ${point.x / 100})`,
                    bottom: `calc(18px + (100% - 36px) * ${point.y / 100})`,
                    borderColor: winColor(point.win, point.picks),
                  }}
                >
                  <HeroIcon name={point.name} size="h-full w-full" className="rounded-none" />
                </Link>
              ))}
            </div>
            <div className="flex justify-between text-[11px] text-dim">
              <span>0%</span>
              <span className="uppercase tracking-[0.05em]">Pick %</span>
              <span>100%</span>
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}
