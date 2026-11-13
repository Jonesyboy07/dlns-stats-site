import React from "react";
import { Link } from "react-router-dom";
import ItemThumb from "./ItemThumb";
import { formatInteger } from "../../utils/format";
import { slotColor, slotLabel, winRateColor } from "../../utils/items";

const pct = (value) => `${Number(value).toFixed(1)}%`;

function ItemCard({ row, minGames }) {
  return (
    <Link
      to={`/item/${row.id}`}
      title={
        row.low
          ? `${row.name} · ${row.wins} wins in ${row.games} games, below the ${minGames}-game minimum`
          : `${row.name} · ${row.wins} wins in ${row.games} games`
      }
      className={`flex flex-col gap-2.5 rounded-xl border border-border bg-card p-3 text-secondary transition-[border-color,transform] duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:-translate-y-0.5 hover:border-accent-border motion-reduce:transition-none ${
        row.low ? "opacity-50" : ""
      }`}
    >
      <span className="relative">
        <ItemThumb item={row} size="aspect-square w-full" rounded="rounded-lg" />
        {row.low && (
          <span className="absolute top-1.5 left-1.5 rounded-full border border-warning-border bg-table/90 px-[7px] py-0.5 text-[10px] text-warning">
            Low sample
          </span>
        )}
        <span
          className="absolute top-1.5 right-1.5 rounded-md bg-table/90 px-[7px] py-0.5 text-[11px] font-semibold"
          style={{ color: slotColor(row.slot) }}
        >
          {row.rank ?? "–"}
        </span>
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="truncate font-semibold text-primary">{row.name}</span>
        <span className="text-[12px] text-dim">
          T{row.tier} · {formatInteger(row.cost)} souls
        </span>
      </span>
      <span className="flex justify-between border-t border-border pt-2 text-[12px] tabular-nums">
        <span>
          Pick <b className="font-semibold text-secondary">{pct(row.pick)}</b>
        </span>
        <span>
          Win{" "}
          <b className="font-semibold" style={{ color: winRateColor(row.win, row.low) }}>
            {pct(row.win)}
          </b>
        </span>
      </span>
    </Link>
  );
}

/** The index's card view, one grid per section. */
export default function ItemsGrid({ sections, minGames }) {
  return (
    <div className="flex flex-col gap-5">
      {sections.map((section) => (
        <div key={section.slot ?? "all"} className="flex flex-col gap-2.5">
          {section.slot && (
            <div className="flex items-center gap-2 font-valve-oracle text-[16px] text-primary">
              <span aria-hidden="true" className="h-[9px] w-[9px] rounded-[2px]" style={{ background: slotColor(section.slot) }} />
              {slotLabel(section.slot)}
              <span className="font-fira-sans text-[12px] text-dim">{section.rows.length} items</span>
            </div>
          )}
          <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 md:grid-cols-[repeat(auto-fill,minmax(168px,1fr))]">
            {section.rows.map((row) => (
              <ItemCard key={row.id} row={row} minGames={minGames} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
