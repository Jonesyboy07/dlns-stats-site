import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import PlayerAvatar from "../PlayerAvatar";
import { formatInteger } from "../../utils/format";
import { formatPercent } from "../../utils/heroPages";

const TOP_N = 8;
const MIN_GAMES = 10;

const SORTS = {
  games: (a, b) => (b.games ?? 0) - (a.games ?? 0),
  win: (a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0) || (b.games ?? 0) - (a.games ?? 0),
  kda: (a, b) => (b.kda ?? 0) - (a.kda ?? 0),
  dmg: (a, b) => (b.damage_per_game ?? 0) - (a.damage_per_game ?? 0),
};

const COLUMNS = [
  { key: "games", label: "Games" },
  { key: "win", label: "Win %" },
  { key: "kda", label: "KDA" },
  { key: "dmg", label: "Dmg" },
];

/**
 * Top Players: the eight players with the most games on this hero (10+ games),
 * sortable by games, win rate, KDA or damage per game.
 */
function HeroTopPlayersPanel({ players = [] }) {
  const [sort, setSort] = useState("win");

  const rows = useMemo(
    () =>
      players
        .filter((player) => (player.games ?? 0) >= MIN_GAMES)
        .slice()
        .sort(SORTS[sort])
        .slice(0, TOP_N),
    [players, sort],
  );

  return (
    <Panel title="Top Players" subtitle="Most successful players on this hero">
      <div className="flex flex-col">
        <div className="grid grid-cols-[22px_minmax(0,1fr)_48px_52px_44px_54px] gap-2 px-1.5 pb-2 text-[11px]">
          <span className="text-dim">#</span>
          <span className="uppercase tracking-[.05em] text-dim">Player</span>
          {COLUMNS.map((column) => (
            <button
              key={column.key}
              type="button"
              onClick={() => setSort(column.key)}
              className={`bg-transparent p-0 text-right uppercase tracking-[.05em] transition-colors ${
                sort === column.key ? "text-accent-secondary-light" : "text-dim hover:text-secondary"
              }`}
            >
              {column.label}
              {sort === column.key ? " ↓" : ""}
            </button>
          ))}
        </div>

        {rows.map((player, index) => (
          <Link
            key={player.account_id}
            to={`/player/${player.account_id}`}
            className="grid grid-cols-[22px_minmax(0,1fr)_48px_52px_44px_54px] items-center gap-2 rounded-md border-t border-border px-1.5 py-2 text-[13px] tabular-nums text-secondary no-underline transition-[background,transform] hover:translate-x-1 hover:bg-accent-secondary-bg motion-reduce:hover:translate-x-0"
          >
            <span className="font-bold text-dim">{index + 1}</span>
            <span className="flex min-w-0 items-center gap-2">
              <PlayerAvatar player={player} size="h-6 w-6" />
              <span
                title={player.persona_name ?? String(player.account_id)}
                className="truncate font-semibold text-primary"
              >
                {player.persona_name ?? player.account_id}
              </span>
            </span>
            <span className="text-right">{player.games}</span>
            <span
              className={`text-right ${
                (player.win_rate ?? 0) >= 0.5 ? "text-success" : "text-danger-text"
              }`}
            >
              {formatPercent(player.win_rate, 0)}
            </span>
            <span className="text-right">{player.kda == null ? "—" : player.kda.toFixed(2)}</span>
            <span className="text-right">
              {player.damage_per_game == null ? "—" : formatInteger(player.damage_per_game)}
            </span>
          </Link>
        ))}

        {rows.length === 0 && (
          <p className="border-t border-border px-1.5 py-4 text-[13px] text-dim">
            No players with {MIN_GAMES}+ games in this scope.
          </p>
        )}
      </div>
    </Panel>
  );
}

export default HeroTopPlayersPanel;
