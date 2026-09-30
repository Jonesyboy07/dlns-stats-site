import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import PlayerAvatar from "../PlayerAvatar";
import { formatPercent } from "../../utils/heroPages";

const SORTS = {
  games: (a, b) => (b.games_played ?? 0) - (a.games_played ?? 0),
  win: (a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0) || (b.games_played ?? 0) - (a.games_played ?? 0),
};

const TOP_N = 8;

/**
 * Top Players: the eight players with the most games on this hero. Sortable by
 * games or win rate; the API has no per-hero KDA or damage yet, so those columns
 * are not shown.
 */
function HeroTopPlayersPanel({ players = [] }) {
  const [sort, setSort] = useState("win");

  const rows = useMemo(
    () =>
      players
        .filter((player) => (player.games_played ?? 0) >= 10)
        .slice()
        .sort(SORTS[sort])
        .slice(0, TOP_N),
    [players, sort],
  );

  const label = (key, text, align = "text-right") => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`bg-transparent p-0 ${align} uppercase tracking-[.05em] transition-colors ${
        sort === key ? "text-accent-secondary-light" : "text-dim hover:text-secondary"
      }`}
    >
      {text}
      {sort === key ? " ↓" : ""}
    </button>
  );

  return (
    <Panel title="Top Players" subtitle="Most successful players on this hero">
      <div className="flex flex-col">
        <div className="grid grid-cols-[22px_minmax(0,1fr)_52px_56px] gap-2 px-1.5 pb-2 text-[11px]">
          <span className="text-dim">#</span>
          <span className="uppercase tracking-[.05em] text-dim">Player</span>
          {label("games", "Games")}
          {label("win", "Win %")}
        </div>

        {rows.map((player, index) => (
          <Link
            key={player.account_id}
            to={`/player/${player.account_id}`}
            className="grid grid-cols-[22px_minmax(0,1fr)_52px_56px] items-center gap-2 rounded-md border-t border-border px-1.5 py-2 text-[13px] tabular-nums text-secondary no-underline transition-[background,transform] hover:translate-x-1 hover:bg-accent-secondary-bg motion-reduce:hover:translate-x-0"
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
            <span className="text-right">{player.games_played}</span>
            <span
              className={`text-right ${
                (player.win_rate ?? 0) >= 0.5 ? "text-success" : "text-danger-text"
              }`}
            >
              {formatPercent(player.win_rate, 0)}
            </span>
          </Link>
        ))}

        {rows.length === 0 && (
          <p className="border-t border-border px-1.5 py-4 text-[13px] text-dim">
            No players with 10+ games yet.
          </p>
        )}
      </div>
    </Panel>
  );
}

export default HeroTopPlayersPanel;
