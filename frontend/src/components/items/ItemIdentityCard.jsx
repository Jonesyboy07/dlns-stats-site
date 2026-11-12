import React from "react";
import ItemThumb from "./ItemThumb";
import { formatInteger } from "../../utils/format";
import { slotColor, slotLabel } from "../../utils/items";

const CHIP = "rounded-full px-2.5 py-1 text-[12px] font-semibold";

/**
 * The item's own text: its description and stat bonuses from the game data.
 * Kept separate so the in-game tooltip component can replace it later.
 */
export function ItemDescription({ item }) {
  if (!item.description && !item.bonuses?.length) return null;
  return (
    <>
      {item.description && (
        <p className="rounded-lg border border-border bg-table px-3.5 py-3 leading-[1.55] text-secondary">{item.description}</p>
      )}
      {item.bonuses?.length > 0 && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2">
          {item.bonuses.map((bonus) => (
            <div key={bonus.label} className="flex flex-col gap-0.5 rounded-lg border border-border bg-table px-3 py-2.5">
              <span className="font-valve-oracle text-[20px] leading-[1.1] text-primary">{bonus.value}</span>
              <span className="text-[12px] text-muted">{bonus.label}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Icon, name, slot / tier / cost chips, the description and the Trend placeholder. */
export default function ItemIdentityCard({ item, showRoadmap = true }) {
  return (
    <section className="flex flex-wrap gap-6 rounded-xl border border-border-light bg-card px-5 py-5 shadow md:px-6">
      <ItemThumb
        item={item}
        size="h-24 w-24 md:h-[132px] md:w-[132px]"
        rounded="rounded-xl"
        borderAlpha="99"
        className="border-2 shadow-[0_0_0_4px_var(--color-table)]"
      />
      <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-3.5">
        <div className="flex flex-col gap-2.5">
          <h1 className="font-valve-pulp text-[38px] leading-[0.95] text-primary md:text-[56px]">{item.name}</h1>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={CHIP} style={{ color: slotColor(item.slot), background: slotColor(item.slot, "33") }}>
              {slotLabel(item.slot)}
            </span>
            {item.tier != null && <span className={`${CHIP} border border-badge-border bg-badge-bg text-secondary`}>Tier {item.tier}</span>}
            {item.cost != null && (
              <span className={`${CHIP} border border-badge-border bg-badge-bg text-primary`}>{formatInteger(item.cost)} souls</span>
            )}
            {!item.shopable && (
              <span className={`${CHIP} border border-warning-border bg-warning-bg text-warning`} title="No longer in the shop">
                Legacy
              </span>
            )}
            {showRoadmap && (
              <span
                title="Rising / falling badge, needs week-over-week data"
                className={`${CHIP} border border-dashed border-border-lighter text-dim`}
              >
                Trend · Adding Soon
              </span>
            )}
          </div>
        </div>
        <ItemDescription item={item} />
      </div>
      {showRoadmap && (
        <div className="hidden min-w-[220px] flex-[0_1_260px] flex-col gap-1.5 md:flex rounded-xl border border-dashed border-border-lighter bg-table px-[18px] py-4">
          <span className="font-valve-oracle text-[17px] text-primary">Trend</span>
          <span className="text-[13px] text-muted">Pick and win rate by week or patch</span>
          <span className="text-[13px] font-semibold text-dim">Adding Soon</span>
        </div>
      )}
    </section>
  );
}
