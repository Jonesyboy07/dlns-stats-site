import React from "react";
import { Link } from "react-router-dom";
import ItemThumb from "./ItemThumb";
import { formatDuration, formatInteger } from "../../utils/format";
import { nextItemSort, slotColor, slotLabel, winRateColor } from "../../utils/items";

const pct = (value) => `${Number(value).toFixed(1)}%`;

/*
 * Phone: #, item, pick, win, games. Tablet adds buy time and sell rate (with
 * bars on pick and win). Desktop adds slot, tier and cost as their own columns;
 * below that they move under the item name.
 */
const ROW_GRID =
  "grid gap-2 md:gap-3 grid-cols-[22px_minmax(0,1fr)_54px_58px_44px] " +
  "md:grid-cols-[28px_minmax(180px,2.4fr)_minmax(110px,1.1fr)_minmax(130px,1.2fr)_64px_72px_70px] " +
  "lg:grid-cols-[28px_minmax(180px,2.4fr)_88px_40px_60px_minmax(110px,1.1fr)_minmax(130px,1.2fr)_64px_72px_70px]";

const COLUMNS = [
  { key: null, label: "#", align: "left" },
  { key: "name", label: "Item", align: "left" },
  { key: "slot", label: "Slot", align: "left", show: "hidden lg:block" },
  { key: "tier", label: "Tier", align: "left", show: "hidden lg:block" },
  { key: "cost", label: "Cost", show: "hidden lg:block" },
  { key: "pick", label: "Pick rate", short: "Pick" },
  { key: "win", label: "Win rate", short: "Win" },
  { key: "games", label: "Games", short: "GP" },
  { key: "buy", label: "Med. buy", show: "hidden md:block", title: "Median time of the first purchase" },
  { key: "sell", label: "Sell rate", show: "hidden md:block", title: "Games where every copy was sold before the end" },
];

function HeaderCell({ column, sort, onSort }) {
  const active = column.key && sort.key === column.key;
  const align = column.align === "left" ? "text-left" : "text-right";
  const label = column.short ? (
    <>
      <span className="md:hidden">{column.short}</span>
      <span className="hidden md:inline">{column.label}</span>
    </>
  ) : (
    column.label
  );
  if (!column.key) return <span className={`${align} text-dim ${column.show ?? ""}`}>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => onSort(nextItemSort(sort, column.key))}
      title={column.title ?? `Sort by ${column.label.toLowerCase()}`}
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`cursor-pointer whitespace-nowrap uppercase transition-colors duration-200 hover:text-secondary ${align} ${
        active ? "text-primary" : "text-dim"
      } ${column.show ?? ""}`}
    >
      {label}
      {active && <span className="ml-1 text-accent-light">{sort.dir === "desc" ? "▾" : "▴"}</span>}
    </button>
  );
}

function PickCell({ value }) {
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span>{pct(value)}</span>
      <span className="hidden h-1 w-14 shrink-0 rounded-sm bg-border-light md:block">
        <span className="block h-1 rounded-sm bg-muted" style={{ width: `${Math.min(100, value * 1.5)}%` }} />
      </span>
    </span>
  );
}

function WinCell({ value, low }) {
  const color = winRateColor(value, low);
  const offset = value - 50;
  const half = Math.min(50, (Math.abs(offset) / 25) * 50);
  return (
    <span className="flex items-center justify-end gap-2.5">
      <span className="font-semibold" style={{ color }}>
        {pct(value)}
      </span>
      <span className="relative hidden h-1.5 w-14 shrink-0 rounded-[3px] bg-border-light md:block">
        <span className="absolute top-[-2px] bottom-[-2px] left-1/2 w-px bg-border-lighter" />
        <span
          className="absolute top-0 bottom-0 rounded-[3px]"
          style={{ left: offset >= 0 ? "50%" : `${50 - half}%`, width: `${half}%`, background: color }}
        />
      </span>
    </span>
  );
}

function LowSampleBadge({ className = "" }) {
  return (
    <span
      className={`shrink-0 rounded-full border border-warning-border bg-warning-bg px-2 py-0.5 text-[11px] text-warning ${className}`}
    >
      Low sample
    </span>
  );
}

function ItemRow({ row, minGames }) {
  const title = row.low
    ? `${row.name} · ${row.wins} wins in ${row.games} games, below the ${minGames}-game minimum`
    : `${row.name} · ${row.wins} wins in ${row.games} games`;
  return (
    <Link
      to={`/item/${row.id}`}
      title={title}
      className={`${ROW_GRID} items-center border-b border-border px-3 py-2.5 text-[13px] text-secondary tabular-nums transition-[background-color,transform] duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:translate-x-1 hover:bg-accent-bg motion-reduce:transition-none md:px-4 ${
        row.low ? "opacity-50" : ""
      }`}
    >
      <span className="text-dim">{row.rank ?? "–"}</span>
      <span className="flex min-w-0 items-center gap-3">
        <ItemThumb item={row} size="h-8 w-8 md:h-9 md:w-9" />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate font-medium text-primary">{row.name}</span>
          <span className="text-[12px] text-dim lg:hidden">
            T{row.tier} · {formatInteger(row.cost)} souls
            {row.low && <span className="md:hidden"> · low sample</span>}
          </span>
        </span>
        {row.low && <LowSampleBadge className="hidden md:inline" />}
      </span>
      <span
        className="hidden justify-self-start rounded-md px-2 py-[3px] text-[12px] font-medium lg:block"
        style={{ color: slotColor(row.slot), background: slotColor(row.slot, "33") }}
      >
        {slotLabel(row.slot)}
      </span>
      <span className="hidden lg:block">T{row.tier}</span>
      <span className="hidden text-right text-primary lg:block">{formatInteger(row.cost)}</span>
      <PickCell value={row.pick} />
      <WinCell value={row.win} low={row.low} />
      <span className="text-right">{formatInteger(row.games)}</span>
      <span className="hidden text-right md:block">{formatDuration(row.median_buy_s) ?? "—"}</span>
      <span className="hidden text-right md:block">{pct(row.sell)}</span>
    </Link>
  );
}

function SectionHeader({ slot, count }) {
  return (
    <div className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2.5 font-valve-oracle text-[15px] text-primary md:px-4">
      <span aria-hidden="true" className="h-[9px] w-[9px] rounded-[2px]" style={{ background: slotColor(slot) }} />
      {slotLabel(slot)}
      <span className="font-fira-sans text-[12px] text-dim">{count} items</span>
    </div>
  );
}

/** The index table: sortable headers, optional slot sections, low samples last. */
export default function ItemsTable({ sections, sort, onSort, minGames }) {
  return (
    <div className="overflow-hidden rounded-xl border border-border bg-card shadow">
      <div
        className={`${ROW_GRID} border-b border-border bg-table px-3 py-3 text-[11px] font-semibold tracking-[0.06em] md:px-4`}
      >
        {COLUMNS.map((column) => (
          <HeaderCell key={column.label} column={column} sort={sort} onSort={onSort} />
        ))}
      </div>
      {sections.map((section) => (
        <React.Fragment key={section.slot ?? "all"}>
          {section.slot && <SectionHeader slot={section.slot} count={section.rows.length} />}
          {section.rows.map((row) => (
            <React.Fragment key={row.id}>
              {row.firstLow && (
                <div className="border-y border-warning-border bg-warning-bg px-3 py-2 text-[12px] text-warning md:px-4">
                  Low sample: fewer than {minGames} games under these filters. Shown for reference, not ranked.
                </div>
              )}
              <ItemRow row={row} minGames={minGames} />
            </React.Fragment>
          ))}
        </React.Fragment>
      ))}
    </div>
  );
}
