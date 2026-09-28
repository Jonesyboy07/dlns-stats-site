import React from "react";
import { formatPercent } from "../../utils/format";

const RANK_BADGE =
  "flex flex-1 flex-col gap-0.5 rounded-[10px] border border-accent-secondary-border bg-accent-secondary-bg px-3 py-2.5";

/**
 * Where the player stands among everyone who played this hero.
 *
 * It only renders while the player is inside the top 10 by games or by win rate —
 * a "#47 of 49" badge is noise, and the panel column collapses instead. The strip
 * has one segment per player on the hero in games order, so the filled segment
 * shows the standing at a glance; the segment count is printed so it is not
 * hover-only information.
 */
export default function HeroRankBadges({ rank, heroName, topN = 10 }) {
  if (!rank || !rank.eligible || rank.pool.length === 0) return null;

  const badges = [
    rank.by_games && {
      id: "games",
      value: `#${rank.by_games.rank}`,
      label: `of ${rank.by_games.of} by games`,
    },
    rank.by_win_rate && {
      id: "winRate",
      value: `#${rank.by_win_rate.rank}`,
      label: `by win rate · min ${rank.by_win_rate.min_games} g`,
      title: `${formatPercent(rank.by_win_rate.value * 100, 1)} on ${heroName}`,
    },
  ].filter(Boolean);

  return (
    <div className="flex min-w-[260px] flex-col gap-2 self-end">
      <div className="flex gap-2">
        {badges.map((badge) => (
          <div key={badge.id} className={RANK_BADGE} title={badge.title}>
            <span className="font-valve-pulp text-[30px] leading-none text-accent-secondary-light">
              {badge.value}
            </span>
            <span className="text-[12px] text-secondary">{badge.label}</span>
          </div>
        ))}
      </div>

      <div
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${rank.pool.length}, minmax(0, 1fr))` }}
        title={`Players with a ${heroName} game, ranked by games`}
      >
        {rank.pool.map((entry) => (
          <span
            key={entry.account_id}
            className={`h-2 rounded-[2px] ${
              entry.is_player ? "bg-accent-secondary-light" : "bg-accent-secondary/25"
            }`}
          />
        ))}
      </div>

      <span className="text-[11px] text-dim">
        {rank.pool.length} players have played {heroName} in the league · the filled
        bar is this player
      </span>
    </div>
  );
}
