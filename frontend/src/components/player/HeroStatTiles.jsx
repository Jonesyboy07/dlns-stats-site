import React from "react";
import DeltaBadge from "./DeltaBadge";
import { formatInteger, formatKda, formatPercent } from "../../utils/format";

const DASH = "—";

/** A pill used where a tile line is a fact rather than a comparison. */
function NotePill({ children, title }) {
  return (
    <span
      className="rounded-full border border-transparent bg-badge-bg px-[7px] py-[2px] text-[11px] font-bold tabular-nums text-muted"
      title={title}
    >
      {children}
    </span>
  );
}

/**
 * The six Player × Hero tiles: the hero's own numbers, each with TWO baselines —
 * this player's all-hero average and the league's average on the same hero. Both
 * are shown as the baseline in the key plus a DeltaBadge, so a reader can see what
 * the comparison is against without hovering.
 */
export default function HeroStatTiles({ pool, own, league, rank, heroName, totalGames = 0 }) {
  if (!pool) return null;

  const share = totalGames > 0 ? pool.games / totalGames : null;

  const tiles = [
    {
      id: "games",
      label: "Games",
      value: String(pool.games),
      notes: [
        share == null ? null : { key: "share of own games", value: formatPercent(share * 100) },
        rank?.by_games
          ? {
              key: "league rank",
              value: `#${rank.by_games.rank} / ${rank.by_games.of}`,
              title: `${rank.by_games.rank} of ${rank.by_games.of} players by games on ${heroName}`,
            }
          : null,
      ].filter(Boolean),
    },
    {
      id: "record",
      label: "W – L",
      value: (
        <>
          <span className={pool.wins >= pool.losses ? "text-success" : "text-dim"}>{pool.wins}</span>
          <span className="text-dim"> – </span>
          <span className={pool.losses > pool.wins ? "text-danger-text" : "text-dim"}>{pool.losses}</span>
        </>
      ),
      notes: [
        pool.unknown > 0
          ? { key: `${pool.unknown} unknown result${pool.unknown === 1 ? "" : "s"}`, value: "excluded" }
          : { key: "all results known", value: String(pool.decided) },
      ],
    },
    {
      id: "winRate",
      label: "Win rate",
      value: pool.winRate == null ? DASH : formatPercent(pool.winRate * 100, 1),
      deltas: [
        {
          key: `vs own ${own.winRate == null ? DASH : formatPercent(own.winRate * 100, 1)}`,
          value: pool.winRate,
          baseline: own.winRate,
          unit: "pts",
        },
        {
          key: `vs league ${heroName} ${league.win_rate == null ? DASH : formatPercent(league.win_rate * 100, 1)}`,
          value: pool.winRate,
          baseline: league.win_rate,
          unit: "pts",
        },
      ],
    },
    {
      id: "kda",
      label: "Avg KDA",
      value: pool.kda == null ? DASH : formatKda(pool.kda),
      deltas: [
        {
          key: `vs own ${own.kda == null ? DASH : formatKda(own.kda)}`,
          value: pool.kda,
          baseline: own.kda,
        },
        {
          key: `vs league ${heroName} ${league.kda == null ? DASH : formatKda(league.kda)}`,
          value: pool.kda,
          baseline: league.kda,
        },
      ],
    },
    {
      id: "souls",
      label: "Souls / min",
      value: pool.soulsPerMin == null ? DASH : formatInteger(pool.soulsPerMin),
      deltas: [
        {
          key: `vs own ${own.soulsPerMin == null ? DASH : formatInteger(own.soulsPerMin)}`,
          value: pool.soulsPerMin,
          baseline: own.soulsPerMin,
        },
        {
          key: `vs league ${heroName} ${league.souls_per_min == null ? DASH : formatInteger(league.souls_per_min)}`,
          value: pool.soulsPerMin,
          baseline: league.souls_per_min,
        },
      ],
    },
    {
      id: "damage",
      label: "Dmg / min",
      value: pool.damagePerMin == null ? DASH : formatInteger(pool.damagePerMin),
      deltas: [
        {
          key: `vs own ${own.damagePerMin == null ? DASH : formatInteger(own.damagePerMin)}`,
          value: pool.damagePerMin,
          baseline: own.damagePerMin,
        },
        {
          key: `vs league ${heroName} ${league.damage_per_min == null ? DASH : formatInteger(league.damage_per_min)}`,
          value: pool.damagePerMin,
          baseline: league.damage_per_min,
        },
      ],
    },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
      {tiles.map((tile) => (
        <div
          key={tile.id}
          className="flex min-w-0 flex-col gap-2 rounded-2xl border border-border-light bg-card px-4 py-3.5"
        >
          <span className="text-[11px] uppercase tracking-[.05em] text-muted">{tile.label}</span>
          <span className="whitespace-nowrap font-valve-pulp text-[28px] leading-[1.05] text-primary">
            {tile.value}
          </span>
          <div className="flex flex-col gap-1 text-[11px]">
            {tile.deltas?.map((delta) => (
              <span key={delta.key} className="flex items-center justify-between gap-2">
                <span className="whitespace-nowrap text-dim">{delta.key}</span>
                <DeltaBadge
                  value={delta.value}
                  baseline={delta.baseline}
                  unit={delta.unit ?? "pct"}
                  title={`${delta.key} → ${delta.value == null ? DASH : delta.value}`}
                />
              </span>
            ))}
            {tile.notes?.map((note) => (
              <span key={note.key} className="flex items-center justify-between gap-2">
                <span className="truncate text-dim" title={note.title ?? note.key}>
                  {note.key}
                </span>
                <NotePill title={note.title}>{note.value}</NotePill>
              </span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
