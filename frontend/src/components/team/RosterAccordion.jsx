import React, { useState } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";
import ItemIcon from "../ItemIcon";
import PlayerAvatar from "../PlayerAvatar";
import { formatCompact, formatInteger, formatKda } from "../../utils/format";

/** "WK 47–55", or a single week when the player only appeared once. */
const weekRange = (player) => {
  const { first_week: first, last_week: last } = player;
  if (first == null && last == null) return null;
  if (first == null || first === last) return `WK ${last ?? first}`;
  return `WK ${first}\u2013${last}`;
};

function StatTile({ label, value }) {
  return (
    <div className="rounded-lg border border-gray-700/60 bg-gray-800/40 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-white">{value ?? "\u2014"}</p>
    </div>
  );
}

function IconGroup({ label, items, renderIcon, emptyText }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-500">{label}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-xs text-gray-600">{emptyText}</p>
      ) : (
        <div className="mt-1.5 flex items-center gap-1.5">
          {items.map(renderIcon)}
        </div>
      )}
    </div>
  );
}

/** Expanded detail for one roster player. */
function PlayerPanel({ player }) {
  const heroes = player.signature_heroes ?? [];
  const items = player.items ?? [];

  return (
    <div className="mt-2 rounded-lg border border-gray-700/60 bg-gray-800/40 p-3">
      <div className="grid grid-cols-3 gap-2">
        <StatTile label="KDA" value={formatKda(player.kda)} />
        <StatTile label="NW/min" value={formatCompact(player.nw_per_min)} />
        <StatTile label="DMG/min" value={formatInteger(player.dmg_per_min)} />
      </div>

      <div className="mt-4 space-y-3">
        <IconGroup
          label="Heroes played"
          items={heroes}
          emptyText="No hero data."
          renderIcon={(hero) => (
            <HeroIcon
              key={hero.hero_id}
              name={hero.hero_name}
              size="h-10 w-10"
            />
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
      </div>

      <Link
        to={`/player/${player.account_id}`}
        className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-purple-500"
      >
        Full player page
        <span aria-hidden="true">&rarr;</span>
      </Link>
    </div>
  );
}

function RosterRow({ player, expanded, onToggle }) {
  const games = player.appearances ?? 0;
  const kda = formatKda(player.kda);
  const meta = [
    `${games} gp`,
    kda ? `${kda} KDA` : null,
    weekRange(player),
  ]
    .filter(Boolean)
    .join(" \u00b7 ");

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
        expanded
          ? "border-purple-500/60 bg-gray-800/70"
          : "border-gray-700/60 bg-gray-800/40 hover:border-purple-500/40 hover:bg-gray-700/40"
      }`}
    >
      <PlayerAvatar player={player} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-100">
          {player.persona_name || `Player ${player.account_id}`}
        </p>
        <p className="truncate text-xs text-gray-500">{meta}</p>
      </div>
      <span
        aria-hidden="true"
        className={`shrink-0 text-gray-500 transition-transform ${expanded ? "rotate-180" : ""}`}
      >
        &#9662;
      </span>
    </button>
  );
}

/** Roster list where exactly one player's detail panel is open at a time. */
function RosterAccordion({ players = [] }) {
  const [openId, setOpenId] = useState(null);

  if (players.length === 0) {
    return <p className="text-sm text-gray-600">No roster data available.</p>;
  }

  return (
    <div className="space-y-2">
      {players.map((player) => {
        const expanded = openId === player.account_id;
        return (
          <div key={player.account_id}>
            <RosterRow
              player={player}
              expanded={expanded}
              onToggle={() =>
                setOpenId(expanded ? null : player.account_id)
              }
            />
            {expanded && <PlayerPanel player={player} />}
          </div>
        );
      })}
    </div>
  );
}

export default RosterAccordion;
