import React from "react";
import { Link } from "react-router-dom";
import ItemThumb from "./ItemThumb";
import { formatInteger } from "../../utils/format";

const pct = (value) => `${Number(value).toFixed(1)}%`;

function SummaryTile({ label, item, value, sub, valueColor }) {
  return (
    <Link
      to={`/item/${item.id}`}
      className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 text-secondary shadow transition-colors duration-200 hover:bg-panel"
    >
      <ItemThumb item={item} size="h-12 w-12" rounded="rounded-lg" />
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[11px] tracking-[0.07em] text-dim uppercase">{label}</span>
        <span className="truncate font-semibold text-primary">{item.name}</span>
        <span className="text-[13px] text-muted">
          <b className="font-semibold" style={{ color: valueColor }}>
            {value}
          </b>{" "}
          {sub}
        </span>
      </span>
    </Link>
  );
}

/** Most bought, best win rate and most often sold, from items with enough games. */
export default function ItemSummaryStrip({ picks, minGames }) {
  if (!picks) return null;
  const { mostBought, bestWin, mostSold } = picks;
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-3">
      <SummaryTile
        label="Most bought"
        item={mostBought}
        value={pct(mostBought.pick)}
        sub={`pick rate · ${formatInteger(mostBought.games)} games`}
        valueColor="var(--color-primary)"
      />
      <SummaryTile
        label={`Highest win rate · ≥${minGames} games`}
        item={bestWin}
        value={pct(bestWin.win)}
        sub={`win rate · ${formatInteger(bestWin.games)} games`}
        valueColor="var(--color-success)"
      />
      <SummaryTile
        label="Most often sold"
        item={mostSold}
        value={pct(mostSold.sell)}
        sub={`sell rate · ${formatInteger(mostSold.games)} games`}
        valueColor="var(--color-primary)"
      />
    </div>
  );
}
