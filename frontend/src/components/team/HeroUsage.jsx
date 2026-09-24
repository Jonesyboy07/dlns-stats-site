import React, { Fragment } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";

/** Tailwind purple-600 as an rgb triplet, so the heat shading can vary alpha. */
const HEAT_RGB = "147 51 234";

/**
 * One matrix cell: games picked on that hero, shaded by how busy it is, linking
 * to that player's page for that hero. Hovering reports the win rate.
 */
function UsageCell({ player, hero, cell, max }) {
  if (!cell || !cell.games) {
    return <span className="h-9 rounded bg-gray-800/70" aria-hidden="true" />;
  }

  const { games, wins } = cell;
  const ratio = max > 0 ? games / max : 0;
  const alpha = 0.2 + 0.8 * ratio;
  const winRate = Math.round((wins / games) * 100);

  return (
    <Link
      to={`/player/${player.account_id}/hero/${hero.hero_id}`}
      title={`${hero.hero_name}: ${games} game${games === 1 ? "" : "s"}, ${winRate}% win rate`}
      className="flex h-9 items-center justify-center rounded text-xs font-semibold text-white transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-purple-400"
      style={{ backgroundColor: `rgb(${HEAT_RGB} / ${alpha.toFixed(2)})` }}
    >
      {games}
    </Link>
  );
}

/**
 * Player x hero matrix. Columns are the team's most-picked heroes, cells are
 * shaded by pick volume. The names sit in a fixed column beside a horizontally
 * scrolling cell grid, so rows stay identifiable without any overlap.
 */
function HeroUsage({ usage, players = [] }) {
  const heroes = usage?.heroes ?? [];
  const cellsByPlayer = new Map(
    (usage?.rows ?? []).map((row) => [row.account_id, row.cells ?? {}]),
  );

  if (heroes.length === 0) {
    return <p className="text-sm text-gray-600">No hero picks yet.</p>;
  }

  const max = Math.max(1, ...heroes.map((hero) => hero.picks ?? 0));

  return (
    <div className="space-y-3">
      <div className="flex">
        {/* Fixed name column: h-7 spacer + h-9 rows, matching the cell grid. */}
        <div className="flex w-24 shrink-0 flex-col gap-1 pr-2">
          <span className="h-7" aria-hidden="true" />
          {players.map((player) => (
            <span
              key={player.account_id}
              title={player.persona_name || `Player ${player.account_id}`}
              className="flex h-9 items-center truncate text-sm text-gray-200"
            >
              {player.persona_name || `Player ${player.account_id}`}
            </span>
          ))}
        </div>

        <div className="min-w-0 flex-1 overflow-x-auto pb-1 [scrollbar-color:rgb(75_85_99)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-gray-700 [&::-webkit-scrollbar-track]:bg-transparent hover:[&::-webkit-scrollbar-thumb]:bg-gray-600">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `repeat(${heroes.length}, minmax(2rem, 1fr))`,
            }}
          >
            {heroes.map((hero) => (
              <HeroIcon
                key={hero.hero_id}
                name={hero.hero_name}
                size="h-7 w-7"
                className="place-self-center"
              />
            ))}

            {players.map((player) => {
              const cells = cellsByPlayer.get(player.account_id) ?? {};
              return (
                <Fragment key={player.account_id}>
                  {heroes.map((hero) => (
                    <UsageCell
                      key={hero.hero_id}
                      player={player}
                      hero={hero}
                      cell={cells[hero.hero_id]}
                      max={max}
                    />
                  ))}
                </Fragment>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-gray-500">
        <span className="shrink-0">fewer picks</span>
        <span
          className="h-2 flex-1 rounded-full"
          style={{
            background: `linear-gradient(90deg, rgb(${HEAT_RGB} / 0.2), rgb(${HEAT_RGB} / 1))`,
          }}
        />
        <span className="shrink-0">more</span>
      </div>
    </div>
  );
}

export default HeroUsage;
