import React, { useState } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import ItemIcon from "../ItemIcon";
import SteamAvatar from "./SteamAvatar";
import { formatCompact, formatInteger } from "../../utils/format";
import { DASH, recordOf } from "../../utils/team";

/**
 * Header and rows share this template so the labels sit over their columns.
 * The trailing 16px column is the chevron.
 */
const GRID =
  "grid grid-cols-[minmax(150px,1.4fr)_48px_64px_132px_minmax(150px,1fr)_64px_64px_16px] items-center gap-4";

/** "5.1 / 3.4 / 8.9" — the per-game K/D/A averages behind the KDA ratio. */
const kdaSplit = (player) => {
  const parts = [player.avg_kills, player.avg_deaths, player.avg_assists];
  if (parts.every((value) => value == null)) return null;
  return parts.map((value) => (value == null ? DASH : Number(value).toFixed(1))).join(" / ");
};

/** Win-rate cell: 6px track, then the percentage in a fixed column. */
function WinRateCell({ record }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-table">
        <span
          className="block h-full rounded-full bg-success"
          style={{ width: `${record.barPct}%` }}
        />
      </span>
      <span className="w-[38px] shrink-0 text-[14px] font-semibold tabular-nums text-primary">
        {record.pct ?? DASH}
      </span>
    </span>
  );
}

function IconGroup({ label, items, emptyText, renderIcon }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[12px] uppercase tracking-[.05em] text-muted">{label}</span>
      {items.length === 0 ? (
        <span className="text-[12px] text-dim">{emptyText}</span>
      ) : (
        <span className="flex gap-1.5">{items.map(renderIcon)}</span>
      )}
    </div>
  );
}

/** Expanded detail for one roster player. */
function PlayerPanel({ player, span }) {
  const heroes = player.signature_heroes ?? [];
  const items = player.items ?? [];

  return (
    <div className="flex flex-wrap items-end gap-8 bg-table px-4 pb-5 pt-4 pl-14">
      <IconGroup
        label="Heroes played"
        items={heroes}
        emptyText="No hero data."
        renderIcon={(hero) => (
          <HeroIcon key={hero.hero_id} name={hero.hero_name} size="h-10 w-10" />
        )}
      />
      <IconGroup
        label="Signature items"
        items={items}
        emptyText="No item data."
        renderIcon={(item) => (
          <ItemIcon
            key={item.item_id}
            icon={item.icon}
            name={item.item_name}
            size="h-10 w-10"
          />
        )}
      />

      {span && <span className="pb-2.5 text-[13px] text-dim">{span}</span>}

      <Link
        to={`/player/${player.account_id}`}
        className="ml-auto rounded-lg border border-accent-secondary-border bg-accent-secondary-bg-strong px-3.5 py-1.5 text-[13px] font-semibold text-accent-secondary-light transition-colors hover:bg-accent-secondary-bg motion-reduce:transition-none"
      >
        Full player page →
      </Link>
    </div>
  );
}

function RosterRow({ player, expanded, onToggle }) {
  const games = player.appearances ?? 0;
  const record = recordOf(player.wins, player.losses);
  const split = kdaSplit(player);
  const kda = player.kda == null ? DASH : Number(player.kda).toFixed(2);

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`${GRID} border-b border-border px-4 py-3 text-left transition-colors motion-reduce:transition-none ${
        expanded ? "bg-hover" : "hover:bg-hover"
      }`}
    >
      <span className="flex min-w-0 items-center gap-3">
        <SteamAvatar player={player} size="h-8 w-8" />
        <span className="truncate text-[15px] font-bold text-accent-secondary-light">
          {player.persona_name || `Player ${player.account_id}`}
        </span>
      </span>

      <span className="text-right text-[14px] font-semibold tabular-nums text-secondary">
        {games}
      </span>

      <span className="flex items-center justify-center gap-1.5 text-[14px] font-semibold tabular-nums">
        <span className={record.winsTone}>{record.wins}</span>
        <span className="text-dim">–</span>
        <span className={record.lossesTone}>{record.losses}</span>
      </span>

      <WinRateCell record={record} />

      <span className="flex items-baseline gap-1.5 whitespace-nowrap">
        <span className="text-[15px] font-bold tabular-nums text-primary">{kda}</span>
        {split && <span className="text-[12px] tabular-nums text-dim">{split}</span>}
      </span>

      <span className="text-right text-[14px] font-semibold tabular-nums text-secondary">
        {formatCompact(player.nw_per_min) ?? DASH}
      </span>

      <span className="text-right text-[14px] font-semibold tabular-nums text-secondary">
        {formatInteger(player.dmg_per_min) ?? DASH}
      </span>

      <span
        aria-hidden="true"
        className={`text-[11px] text-dim transition-transform duration-200 motion-reduce:transition-none ${
          expanded ? "rotate-180" : ""
        }`}
      >
        ▼
      </span>
    </button>
  );
}

/**
 * Roster list where exactly one player's detail panel is open at a time.
 *
 * Rows are the design's dense table style: the metrics sit in the row itself, so
 * comparing players needs no clicking — the accordion only adds the hero and item
 * detail that would not fit.
 */
function RosterAccordion({ players = [], maxWeek }) {
  // The first player opens by default so the panel is discoverable.
  const [openId, setOpenId] = useState(() => players[0]?.account_id ?? null);

  if (players.length === 0) {
    return (
      <div className="flex flex-col">
        <div
          className={`${GRID} border-b border-border px-4 pb-2.5 text-[12px] uppercase tracking-[.05em] text-muted`}
        >
          <span>Player</span>
          <span className="text-right">GP</span>
          <span className="text-center">W–L</span>
          <span>Win rate</span>
          <span>KDA</span>
          <span className="text-right">Souls/min</span>
          <span className="text-right">DMG/min</span>
          <span />
        </div>
        <p className="py-6 text-center text-[13px] text-dim">No roster data available.</p>
      </div>
    );
  }

  return (
    <div className="-mx-2 overflow-x-auto">
      <div className="flex min-w-[780px] flex-col">
        <div
          className={`${GRID} border-b border-border px-4 pb-2.5 text-[12px] uppercase tracking-[.05em] text-muted`}
        >
          <span>Player</span>
          <span className="text-right">GP</span>
          <span className="text-center">W–L</span>
          <span>Win rate</span>
          <span>KDA</span>
          <span className="text-right">Souls/min</span>
          <span className="text-right">DMG/min</span>
          <span />
        </div>

        {players.map((player) => {
          const expanded = openId === player.account_id;
          const first = player.first_week;
          const last = player.last_week;
          const span =
            first == null && last == null
              ? null
              : `Rostered ${
                  first == null || first === last ? `NS ${last ?? first}` : `NS ${first}–${last}`
                }`;

          return (
            <div key={player.account_id} className="flex flex-col">
              <RosterRow
                player={player}
                expanded={expanded}
                onToggle={() => setOpenId(expanded ? null : player.account_id)}
              />
              {expanded && <PlayerPanel player={player} span={span} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default RosterAccordion;
