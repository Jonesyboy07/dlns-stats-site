import React, { useState } from "react";
import Panel from "../player/Panel";
import { cdnImage } from "../../utils/cdn";
import { formatPercent } from "../../utils/heroPages";

const SLOT_META = {
  weapon: { label: "Weapon", color: "var(--color-team-amber)", dot: "bg-team-amber" },
  vitality: { label: "Vitality", color: "var(--color-success)", dot: "bg-success" },
  spirit: { label: "Spirit", color: "var(--color-accent-secondary)", dot: "bg-accent-secondary" },
};

/** Item art path, matching the convention the older hero page used. */
function itemIconPath(item) {
  const folder = item.item_tier === 5 ? "legendaries" : item.item_slot_type;
  if (!folder) return null;
  return `items/${folder}/${String(item.name).toLowerCase().replace(/ /g, "_")}_psd.png`;
}

function ItemRow({ item, dot }) {
  const [failed, setFailed] = useState(false);
  const path = itemIconPath(item);
  const rate = item.pick_rate ?? 0;

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      {path && !failed ? (
        <img
          src={cdnImage(path)}
          alt={item.name}
          title={item.name}
          onError={() => setFailed(true)}
          className="h-[34px] w-[34px] shrink-0 rounded bg-input object-contain"
        />
      ) : (
        <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded border-[1.5px] border-dashed border-border-lighter text-[11px] font-bold text-dim">
          {String(item.name || "?").slice(0, 2).toUpperCase()}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2 text-[13px]">
          <span title={item.name} className="truncate text-primary">
            {item.name}
          </span>
          <span className="whitespace-nowrap text-[12px] font-semibold text-dim">
            Adding Soon
          </span>
        </div>
        <div className="relative h-1 overflow-hidden rounded bg-hover">
          <div
            className={`absolute inset-y-0 left-0 rounded ${dot}`}
            style={{ width: `${Math.min(rate * 100, 100)}%` }}
          />
        </div>
        <span className="text-[11px] text-dim">
          Bought in {formatPercent(rate)} of games
        </span>
      </div>
    </div>
  );
}

/**
 * Item Builds: the most-bought items per slot. The API has purchase counts and
 * frequency but no average purchase time yet, so the timing position reads
 * "Adding Soon" and the rail shows the buy frequency instead.
 */
function HeroItemBuildPanel({ items = [] }) {
  const bySlot = { weapon: [], vitality: [], spirit: [] };
  for (const item of items) {
    if (bySlot[item.item_slot_type]) bySlot[item.item_slot_type].push(item);
  }

  const columns = ["weapon", "vitality", "spirit"].map((key) => ({
    key,
    ...SLOT_META[key],
    items: bySlot[key].slice(0, 5),
  }));

  return (
    <Panel
      title="Item Builds"
      subtitle="Most-bought items with average purchase time, by slot"
    >
      {items.length === 0 ? (
        <p className="text-[13px] text-dim">Adding Soon</p>
      ) : (
        <div
          className="grid gap-4"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}
        >
          {columns.map((column) => (
            <div key={column.key} className="flex min-w-0 flex-col gap-2">
              <div className="flex items-center gap-2 border-b border-border pb-1.5">
                <span className={`h-2 w-2 rounded-sm ${column.dot}`} />
                <span className="font-valve-oracle text-[15px] text-primary">
                  {column.label}
                </span>
              </div>
              {column.items.length === 0 ? (
                <span className="text-[12px] text-dim">Adding Soon</span>
              ) : (
                column.items.map((item) => (
                  <ItemRow key={item.id ?? item.name} item={item} dot={column.dot} />
                ))
              )}
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

export default HeroItemBuildPanel;
