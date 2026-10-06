import React, { Fragment } from "react";
import { Link } from "react-router-dom";
import HeroIcon from "../HeroIcon";

/**
 * Heat shading for a cell, as a percentage of the accent colour mixed into the
 * cell. Derived from the token itself rather than a hard-coded rgb triplet, so the
 * matrix follows the theme (and the light-mode accent) without a second constant.
 */
const heat = (ratio) =>
  `color-mix(in oklch, var(--color-accent-secondary) ${(18 + 82 * ratio).toFixed(0)}%, transparent)`;

/**
 * One matrix cell: games picked on that hero, shaded by how busy it is, linking
 * to that player's page for that hero. Hovering reports the win rate.
 */
function UsageCell({ player, hero, cell, max }) {
  if (!cell || !cell.games) {
    return (
      <span
        title={`${player.persona_name || "Player"} · ${hero.hero_name}: no games`}
        className="h-[34px] rounded-md bg-table"
        aria-hidden="true"
      />
    );
  }

  const { games, wins } = cell;
  const ratio = max > 0 ? games / max : 0;
  const winRate = Math.round((wins / games) * 100);

  return (
    <Link
      to={`/player/${player.account_id}/hero/${hero.hero_id}`}
      title={`${hero.hero_name}: ${games} game${games === 1 ? "" : "s"}, ${winRate}% win rate`}
      style={{ backgroundColor: heat(ratio) }}
      className="flex h-[34px] items-center justify-center rounded-md text-[12px] font-semibold text-primary transition-opacity hover:opacity-80 focus:outline-none focus:ring-2 focus:ring-accent-secondary-border-strong motion-reduce:transition-none"
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
    return <p className="text-[13px] text-dim">No hero picks yet.</p>;
  }

  const max = Math.max(1, ...heroes.map((hero) => hero.picks ?? 0));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex">
        {/* Fixed name column: h-7 spacer + h-[34px] rows, matching the cell grid. */}
        <div className="flex w-24 shrink-0 flex-col gap-1 pr-2">
          <span className="h-7" aria-hidden="true" />
          {players.map((player) => (
            <span
              key={player.account_id}
              title={player.persona_name || `Player ${player.account_id}`}
              className="flex h-[34px] items-center truncate text-[13px] text-secondary"
            >
              {player.persona_name || `Player ${player.account_id}`}
            </span>
          ))}
        </div>

        <div className="flex-1 scroll-thin min-w-0 overflow-x-auto pb-1">
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

      <div className="flex items-center gap-2.5 text-[12px] text-dim">
        <span className="shrink-0">Fewer picks</span>
        <span
          className="h-1.5 flex-1 rounded-full"
          style={{
            background:
              "linear-gradient(90deg, color-mix(in oklch, var(--color-accent-secondary) 15%, transparent), var(--color-accent-secondary))",
          }}
        />
        <span className="shrink-0">More</span>
      </div>
    </div>
  );
}

export default HeroUsage;
