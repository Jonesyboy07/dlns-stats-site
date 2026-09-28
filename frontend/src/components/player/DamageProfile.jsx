import React from "react";
import ErrorMessage from "../ErrorMessage";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import usePanelData from "./usePanelData";
import { formatCompact, formatPercent } from "../../utils/format";

const DASH = "—";

/**
 * Category colours, in the design's order (ability, weapon, item, melee). The
 * legend, the share bar and the source list all read the same map, so a colour
 * always means the same category.
 */
const GROUP_CLASS = {
  abilities: "bg-accent-secondary",
  weapon: "bg-accent",
  items: "bg-accent-secondary/45",
  melee: "bg-dim",
  other: "bg-muted",
};

const groupClass = (id) => GROUP_CLASS[id] ?? GROUP_CLASS.other;

/**
 * Where the player's hero damage comes from. The bar and the legend show every
 * category, the list breaks the biggest ability sources out by the hero that
 * casts them, and the rows are per-game so they add up to the header figure.
 */
export default function DamageProfile({ accountId }) {
  const { data, loading, error, reload } = usePanelData(`/db/users/${accountId}/damage`, {
    errorMessage: "Could not load the damage profile",
  });

  const groups = data?.groups ?? [];
  const sources = data?.sources ?? [];
  const games = data?.games ?? 0;
  const gamesWithDamage = data?.games_with_damage ?? 0;
  const totalPerGame = data?.total_per_game ?? null;
  const coverage =
    games > 0 && gamesWithDamage < games ? `from ${gamesWithDamage} of ${games} games` : null;

  return (
    <Panel
      title="Damage Profile"
      subtitle={
        coverage ? `Hero damage by source · avg per game · ${coverage}` : "Hero damage by source · avg per game"
      }
      action={
        <span className="text-[12px] tabular-nums text-muted">
          {totalPerGame == null ? DASH : `${formatCompact(totalPerGame)} / game`}
        </span>
      }
    >
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="list-item" count={4} />
      ) : groups.length === 0 ? (
        <p className="text-sm text-muted">
          No damage data for this player yet — the oldest matches have no snapshot data.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex h-3 gap-[2px] overflow-hidden rounded-full">
            {groups.map((group) => (
              <span
                key={group.id}
                className={`flex-none ${groupClass(group.id)}`}
                style={{ flex: `${group.damage} 0 0` }}
                title={`${group.label} ${formatPercent((group.share ?? 0) * 100)}`}
              />
            ))}
          </div>

          <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[12px]">
            {groups.map((group) => (
              <span key={group.id} className="flex min-w-0 items-center gap-1.5">
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-[2px] ${groupClass(group.id)}`}
                />
                <span className="truncate text-secondary">{group.label}</span>
                <span className="ml-auto tabular-nums text-primary">
                  {group.share == null ? DASH : formatPercent(group.share * 100)}
                </span>
              </span>
            ))}
          </div>

          <div className="flex flex-col border-t border-border pt-2">
            {sources.map((row) => (
              <div
                key={`${row.group}-${row.label}-${row.sub}`}
                className="grid h-6 grid-cols-[8px_minmax(0,1fr)_48px] items-center gap-2 text-[12px]"
              >
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 rounded-[2px] ${groupClass(row.group)}`}
                />
                <span className="truncate text-secondary" title={row.sub ? `${row.label} · ${row.sub}` : row.label}>
                  {row.label}
                  {row.sub ? <span className="text-dim"> · {row.sub}</span> : null}
                </span>
                <span className="text-right tabular-nums text-primary">
                  {row.per_game == null ? DASH : formatCompact(row.per_game)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}
