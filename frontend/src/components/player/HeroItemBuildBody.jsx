import React from "react";
import ItemIcon from "../ItemIcon";
import { formatDuration } from "../../utils/format";

const DASH = "—";
const COLUMNS = "grid grid-cols-[18px_30px_minmax(0,1fr)_48px_44px] items-center gap-2.5";

/**
 * The build order on this hero: the items bought in at least two games, in the
 * order their median buy time puts them. `share` is the fraction of the hero's
 * games the item was bought in, so a core item and a situational one are easy to
 * tell apart without hovering.
 */
export default function HeroItemBuildBody({ items, heroName }) {
  const build = items?.build ?? [];
  const games = items?.games_with_items ?? 0;

  if (build.length === 0) {
    return (
      <p className="text-[12px] text-dim">
        No repeated purchases on {heroName} yet — nothing is bought often enough to
        call it part of the build.
      </p>
    );
  }

  return (
    <div className="flex flex-col">
      {build.map((item, index) => (
        <div key={item.item_id} className={`${COLUMNS} min-h-9 border-b border-border text-[13px]`}>
          <span className="text-right text-[11px] tabular-nums text-dim">{index + 1}</span>
          <ItemIcon icon={item.icon} name={item.item_name} size="h-[30px] w-[30px]" />
          <span
            className="truncate text-primary"
            title={`${item.item_name} · tier ${item.tier ?? DASH}`}
          >
            {item.item_name}
          </span>
          <span className="text-right tabular-nums text-muted">
            {formatDuration(item.median_time_s) ?? DASH}
          </span>
          <span
            className="text-right text-[12px] tabular-nums text-dim"
            title={`${item.games} of ${games} games`}
          >
            {item.share == null ? DASH : `${Math.round(item.share * 100)}%`}
          </span>
        </div>
      ))}
      <span className="pt-2 text-[11px] text-dim">
        Median buy time · right column: share of {heroName} games where it was bought.
      </span>
    </div>
  );
}
