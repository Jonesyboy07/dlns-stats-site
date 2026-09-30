import React from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import HeroIcon from "../HeroIcon";
import { formatPercent, signedPoints } from "../../utils/heroPages";

/**
 * Best Duo: the standout partner hero on the same team, from the "effective with"
 * matchup list, with the two runner-ups below.
 */
function HeroBestDuoPanel({ heroName, duos = [] }) {
  if (duos.length === 0) {
    return (
      <Panel title="Best Duo" subtitle="Standout partner hero on the same team">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }

  const [top, ...rest] = duos;

  return (
    <Panel title="Best Duo" subtitle="Standout partner hero on the same team">
      <div className="flex flex-col gap-3">
        <Link
          to={`/hero/${top.heroId}`}
          className="flex items-center gap-3.5 rounded-lg border border-accent-secondary-border bg-accent-secondary-bg p-3 no-underline"
        >
          <HeroIcon name={heroName} size="h-12 w-12" />
          <span className="font-valve-pulp text-[20px] text-accent-secondary-light">+</span>
          <HeroIcon name={top.name} size="h-12 w-12" />
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="font-valve-oracle text-[18px] text-primary">{top.name}</span>
            <span className="text-[13px] text-secondary">
              {formatPercent(top.winRate)} together · {top.games} games
            </span>
            <span className="text-[12px] font-bold text-success">
              {signedPoints(top.delta * 100)} pts vs {heroName} overall
            </span>
          </div>
        </Link>

        {rest.map((duo) => (
          <Link
            key={duo.heroId}
            to={`/hero/${duo.heroId}`}
            className="flex items-center gap-2.5 text-[13px] no-underline"
          >
            <HeroIcon name={duo.name} size="h-7 w-7" />
            <span className="text-primary">{duo.name}</span>
            <span className="ml-auto text-muted">
              {formatPercent(duo.winRate)} · {duo.games}g
            </span>
            <span className="w-[62px] text-right font-semibold text-success">
              {signedPoints(duo.delta * 100)}
            </span>
          </Link>
        ))}
      </div>
    </Panel>
  );
}

export default HeroBestDuoPanel;
