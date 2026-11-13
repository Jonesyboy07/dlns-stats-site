import React from "react";
import { DEFAULT_MIN_GAMES, MIN_GAMES_LIMITS, SLOTS, SLOT_ORDER, TIERS, slotColor } from "../../utils/items";

const PILL_GROUP = "flex gap-0.5 rounded-full border border-border-light bg-input p-[3px]";

function SlotControl({ value, onChange }) {
  return (
    <div className={`${PILL_GROUP} scroll-thin max-w-full overflow-x-auto`} role="group" aria-label="Slot">
      {["all", ...SLOT_ORDER].map((slot) => (
        <button
          key={slot}
          type="button"
          aria-pressed={value === slot}
          onClick={() => onChange(slot)}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3 py-[5px] text-[13px] font-medium transition-colors duration-200 active:scale-[.97] ${
            value === slot ? "bg-hover text-primary" : "text-muted hover:text-secondary"
          }`}
        >
          {slot !== "all" && (
            <span aria-hidden="true" className="h-[7px] w-[7px] rounded-[2px]" style={{ background: slotColor(slot) }} />
          )}
          {slot === "all" ? "All" : SLOTS[slot].label}
        </button>
      ))}
    </div>
  );
}

function TierControl({ value, onChange }) {
  const toggle = (tier) => onChange(value.includes(tier) ? value.filter((t) => t !== tier) : [...value, tier].sort());
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Tier">
      <span className="mr-0.5 text-[13px] text-dim">Tier</span>
      {TIERS.map((tier) => {
        const on = value.includes(tier);
        return (
          <button
            key={tier}
            type="button"
            aria-pressed={on}
            title={`Tier ${tier}`}
            onClick={() => toggle(tier)}
            className={`h-[30px] w-[30px] rounded-md border text-[13px] font-semibold transition-colors duration-200 active:scale-[.97] ${
              on
                ? "border-accent-border-strong bg-accent-bg-strong text-primary"
                : "border-border-light text-muted hover:text-secondary"
            }`}
          >
            {tier}
          </button>
        );
      })}
    </div>
  );
}

function SearchBox({ value, onChange }) {
  return (
    <label className="flex h-[34px] min-w-[180px] flex-[1_1_200px] items-center gap-2 rounded-full border border-border-light bg-input px-3.5 focus-within:border-accent-border">
      <span aria-hidden="true" className="text-dim">
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search items"
        aria-label="Search items"
        className="min-w-0 flex-1 bg-transparent text-[13px] text-primary placeholder:text-dim focus:outline-none"
      />
    </label>
  );
}

/** − n + stepper for the low-sample threshold; shared with the item page. */
export function MinGamesStepper({ value, onChange, title = "Items with fewer games than this are greyed out and sorted last" }) {
  const [low, high] = MIN_GAMES_LIMITS;
  const step = (delta) => onChange(Math.min(high, Math.max(low, value + delta)));
  const button =
    "h-8 w-7 text-[16px] text-muted transition-colors hover:text-primary disabled:cursor-not-allowed disabled:opacity-40";
  return (
    <div title={title} className="flex h-[34px] items-center rounded-md border border-border-light bg-input">
      <span className="pr-1 pl-2.5 text-[13px] text-dim">Min games</span>
      <button type="button" aria-label="Fewer games" disabled={value <= low} onClick={() => step(-1)} className={button}>
        −
      </button>
      <span aria-live="polite" className="min-w-5 text-center font-semibold text-primary tabular-nums">
        {value}
      </span>
      <button type="button" aria-label="More games" disabled={value >= high} onClick={() => step(1)} className={button}>
        +
      </button>
    </div>
  );
}

function Chip({ label, onRemove }) {
  return (
    <button
      type="button"
      onClick={onRemove}
      aria-label={`Remove ${label}`}
      className="flex items-center gap-1.5 rounded-full border border-badge-border bg-badge-bg py-[3px] pr-1.5 pl-2.5 text-[12px] text-secondary transition-colors hover:bg-hover"
    >
      {label}
      <span aria-hidden="true" className="text-[13px] text-dim">
        ×
      </span>
    </button>
  );
}

/**
 * The index's own filters, under the stats Period and Region: slot, tiers,
 * name search and the min-games threshold, then a row of removable chips for
 * whichever of them are set.
 */
export default function ItemControls({ view }) {
  const { slot, tiers, q, minGames, setSlot, setTiers, setQuery, setMinGames, resetView } = view;
  const chips = [];
  if (slot !== "all") chips.push({ label: SLOTS[slot].label, onRemove: () => setSlot("all") });
  if (tiers.length) chips.push({ label: `Tier ${tiers.join(", ")}`, onRemove: () => setTiers([]) });
  if (q.trim()) chips.push({ label: `“${q.trim()}”`, onRemove: () => setQuery("") });
  if (minGames !== DEFAULT_MIN_GAMES) chips.push({ label: `Min ${minGames} games`, onRemove: () => setMinGames(DEFAULT_MIN_GAMES) });

  return (
    <div className="flex flex-col gap-2.5 pt-3 md:pt-0">
      <div className="flex flex-wrap items-center gap-2">
        <SlotControl value={slot} onChange={setSlot} />
        <TierControl value={tiers} onChange={setTiers} />
        <SearchBox value={q} onChange={setQuery} />
        <MinGamesStepper value={minGames} onChange={setMinGames} />
      </div>
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12px]">
          <span className="text-dim">Active:</span>
          {chips.map((chip) => (
            <Chip key={chip.label} {...chip} />
          ))}
          <button type="button" onClick={resetView} className="px-1 text-muted underline hover:text-primary">
            Reset all
          </button>
        </div>
      )}
    </div>
  );
}
