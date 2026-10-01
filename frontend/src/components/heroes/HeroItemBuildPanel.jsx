import React from "react";
import Panel from "../player/Panel";
import ItemIcon from "../ItemIcon";
import { clockDuration, formatPercent } from "../../utils/heroPages";

const DASH = "—";
/** The timing rail spans the first 40 minutes, like the design. */
const RAIL_SECONDS = 2400;

const SLOTS = [
  { id: "weapon", label: "Weapon", dot: "bg-team-amber" },
  { id: "vitality", label: "Vitality", dot: "bg-success" },
  { id: "spirit", label: "Spirit", dot: "bg-accent-secondary" },
];

/**
 * Item Builds: the most-bought items per slot with their median purchase time on
 * a 0-40 min rail. Slots come pre-grouped from the hero profile endpoint.
 */
function HeroItemBuildPanel({ slots }) {
  const hasAny = SLOTS.some((slot) => (slots?.[slot.id] ?? []).length > 0);

  if (!hasAny) {
    return (
      <Panel title="Item Builds" subtitle="Most-bought items with average purchase time, by slot">
        <p className="text-[13px] text-dim">Adding Soon</p>
      </Panel>
    );
  }

  return (
    <Panel title="Item Builds" subtitle="Most-bought items with average purchase time, by slot">
      <div
        className="grid gap-4"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
      >
        {SLOTS.map((slot) => {
          const items = slots?.[slot.id] ?? [];
          return (
            <div key={slot.id} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2 border-b border-border pb-1.5">
                <span className={`h-2 w-2 rounded-sm ${slot.dot}`} />
                <span className="font-valve-oracle text-[15px] text-primary">{slot.label}</span>
              </div>
              {items.length === 0 ? (
                <span className="text-[12px] text-dim">Adding Soon</span>
              ) : (
                items.map((item) => {
                  const position =
                    item.median_time_s == null
                      ? null
                      : Math.min(item.median_time_s / RAIL_SECONDS, 1) * 100;
                  return (
                    <div key={item.item_id} className="flex min-w-0 items-center gap-2.5">
                      <ItemIcon icon={item.icon} name={item.item_name} size="h-[34px] w-[34px]" />
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-baseline justify-between gap-2 text-[13px]">
                          <span title={item.item_name} className="truncate text-primary">
                            {item.item_name}
                          </span>
                          <span className="whitespace-nowrap tabular-nums text-muted">
                            {item.median_time_s == null ? DASH : clockDuration(item.median_time_s)}
                          </span>
                        </div>
                        <div className="relative h-1 rounded bg-hover">
                          {position != null && (
                            <span
                              className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ${slot.dot}`}
                              style={{ left: `${position}%` }}
                            />
                          )}
                        </div>
                        <span className="text-[11px] text-dim">
                          Bought in {formatPercent(item.share)} of games
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex justify-between text-[11px] text-dim">
        <span>Timing rail: 0 min</span>
        <span>40 min</span>
      </div>
    </Panel>
  );
}

export default HeroItemBuildPanel;
