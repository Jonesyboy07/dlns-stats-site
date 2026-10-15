/**
 * The laning tab's build table: each lane's opponents mirrored across a row, with their
 * items on the outside and their ability order beside their names.
 *
 * The table is built from the same rows the head-to-head uses, so a player's name, lane
 * and K/D/A cannot disagree with the panel above it. Everything the clock gates is drawn
 * from `time`: an item appears when it was bought, and an ability point when it was
 * spent, so scrubbing replays the build in the order it happened.
 */

import { Fragment } from "react";
import { cdnImage, staticImagePathToCdn } from "../../utils/cdn";
import { clock } from "../../utils/matchTimeline";

const TEAM_TEXT = {
  0: "text-team-amber",
  1: "text-blue-300",
};

const TEAM_BORDER = {
  0: "oklch(0.8016 0.1705 73.27 / .45)",
  1: "oklch(0.5542 0.2465 261.44 / .6)",
};

const ROW_GRID =
  "grid grid-cols-[176px_minmax(0,1fr)_150px_100px_150px_minmax(0,1fr)_176px] items-center gap-3 px-5 py-3";

const ITEM_GRID = { gridTemplateColumns: "repeat(6, 26px)", gap: "4px" };
const ABILITY_GRID = { gridTemplateColumns: "18px repeat(10, minmax(0, 1fr))", gap: "1px" };

/** One item slot: empty slots keep the dashed placeholder so the row stays aligned. */
function ItemSlot({ slot }) {
  const src = slot.image ? staticImagePathToCdn(slot.image) : slot.icon ? cdnImage(slot.icon) : null;
  return (
    <span
      title={slot.empty ? "Empty" : slot.name ?? "Item"}
      className="relative flex h-[26px] w-[26px] overflow-hidden rounded-[5px] border border-border-light bg-panel"
    >
      {src ? (
        <img src={src} alt={slot.name ?? ""} className="h-full w-full object-cover" />
      ) : (
        <span className="absolute inset-1 rounded-[3px] border border-dashed border-border-dashed" />
      )}
    </span>
  );
}

/** The ability tile: the shipped frame with the ability's own art inside it. */
function AbilityTile({ ability }) {
  return (
    <span
      title={ability.name ?? "Ability"}
      className="relative flex h-[18px] w-[18px] items-center justify-center overflow-hidden rounded border border-border-light bg-hover"
    >
      <img
        src={cdnImage("abilities/ability_frame_standard.svg")}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-60"
      />
      {ability.image ? (
        <img
          src={staticImagePathToCdn(ability.image)}
          alt=""
          className="relative h-2/5 w-2/5 object-contain"
        />
      ) : null}
    </span>
  );
}

/**
 * A player's point order: one row per ability, and one column per point spent in the
 * game. A point lights up in the row of the ability it bought, so reading left to right
 * is reading the build the player actually went for.
 */
function AbilityGrid({ abilities }) {
  if (!abilities.length) {
    return <span className="text-[11px] text-dim">No ability data</span>;
  }
  return (
    <div className="grid min-w-0" style={ABILITY_GRID}>
      {abilities.map((ability) => (
        <Fragment key={ability.key}>
          <AbilityTile ability={ability} />
          {ability.cells.map((cell, column) => (
            <span
              key={`${ability.key}-${column}`}
              title={
                cell
                  ? `${ability.name ?? "Ability"} — ${
                      cell.kind === "unlock" ? "unlocked" : `tier ${cell.cost} AP`
                    } at ${clock(cell.timeS)}`
                  : undefined
              }
              className="flex h-[18px] items-center justify-center border-b border-dashed border-border-dashed"
            >
              {cell?.kind === "unlock" ? (
                <span className="text-[10px] leading-none text-accent-light">◆</span>
              ) : null}
              {cell?.kind === "upgrade" ? (
                <span className="rounded border border-accent-border bg-accent-bg-strong px-[3px] py-0.5 text-[10px] font-bold leading-none text-accent-light">
                  {cell.cost}
                </span>
              ) : null}
            </span>
          ))}
        </Fragment>
      ))}
    </div>
  );
}

/** One side's identity: hero art, name and laning K/D/A. The left side is mirrored. */
function PlayerCell({ side, mirror = false, heroIcon, heroName }) {
  if (!side) return <span />;
  const icon = (
    <img
      src={heroIcon?.(side.heroId)}
      alt=""
      title={heroName?.(side.heroId) ?? undefined}
      className="h-[34px] w-[34px] shrink-0 rounded-lg object-cover"
      style={{ border: `1px solid ${TEAM_BORDER[side.team === 1 ? 1 : 0]}` }}
    />
  );
  const identity = (
    <div className={`flex min-w-0 flex-col gap-0.5 ${mirror ? "items-end text-right" : "items-start"}`}>
      <span className="break-words font-valve-pulp text-[15px] leading-tight text-primary">
        {side.name}
      </span>
      <span className="flex gap-[3px] text-[12px] font-semibold tabular-nums">
        <span className="text-success">{side.kda.kills ?? 0}</span>
        <span className="text-dim">/</span>
        <span className="text-danger-text">{side.kda.deaths ?? 0}</span>
        <span className="text-dim">/</span>
        <span className="text-warning">{side.kda.assists ?? 0}</span>
      </span>
    </div>
  );
  return (
    <div className={`flex min-w-0 items-center gap-2.5 ${mirror ? "justify-end" : ""}`}>
      {mirror ? identity : icon}
      {mirror ? icon : identity}
    </div>
  );
}

export default function LaningBuildTable({
  rows = [],
  time = 0,
  teamNames = [],
  heroIcon = null,
  heroName = () => null,
  className = "",
}) {
  const teamLabel = (side) => teamNames[side] || (side === 0 ? "Amber" : "Sapphire");

  return (
    <div
      className={`overflow-hidden rounded-xl border border-border-light bg-card shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] ${className}`}
    >
      <div className="overflow-x-auto">
        <div className="min-w-[1080px]">
          <div
            className={`${ROW_GRID} border-b border-border-light bg-table font-valve-oracle text-[12px] font-semibold uppercase tracking-[.08em] text-muted`}
          >
            <span className={TEAM_TEXT[0]}>Items</span>
            <span>Ability order</span>
            <span className={`text-right ${TEAM_TEXT[0]}`}>{teamLabel(0)}</span>
            <span className="text-center tabular-nums">@{clock(time)}</span>
            <span className={TEAM_TEXT[1]}>{teamLabel(1)}</span>
            <span>Ability order</span>
            <span className={`text-right ${TEAM_TEXT[1]}`}>Items</span>
          </div>

          {rows.length === 0 ? (
            <p className="px-5 py-4 text-[13px] text-dim">
              No laning build data recorded for this match yet.
            </p>
          ) : (
            rows.map((row) => (
              <div
                key={row.key}
                className={`${ROW_GRID} border-b border-border transition-colors duration-200 hover:bg-accent-bg motion-reduce:transition-none ${
                  row.alternate ? "bg-table" : "bg-card"
                } ${row.groupStart ? "border-t border-border-lighter" : ""}`}
              >
                <div className="grid" style={ITEM_GRID}>
                  {(row.left?.items ?? []).map((slot) => (
                    <ItemSlot key={`l-${slot.key}`} slot={slot} />
                  ))}
                </div>

                <AbilityGrid abilities={row.left?.abilities ?? []} />

                <PlayerCell side={row.left} mirror heroIcon={heroIcon} heroName={heroName} />

                <div
                  className="flex items-center justify-center gap-1.5 self-stretch border-x border-border text-[13px] text-secondary"
                  style={{ backgroundColor: "oklch(100% 0 none / 0.025)" }}
                >
                  <span
                    aria-hidden="true"
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: row.laneColor ?? "var(--color-dim)" }}
                  />
                  {row.laneName ?? "Unknown"}
                </div>

                <PlayerCell side={row.right} heroIcon={heroIcon} heroName={heroName} />

                <AbilityGrid abilities={row.right?.abilities ?? []} />

                <div className="grid justify-end" style={ITEM_GRID}>
                  {(row.right?.items ?? []).map((slot) => (
                    <ItemSlot key={`r-${slot.key}`} slot={slot} />
                  ))}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
