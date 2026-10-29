import React, { useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../ErrorMessage";
import HeroIcon from "../HeroIcon";
import usePanelData from "../player/usePanelData";

const STATS = [
  { key: "kills", label: "Kills" },
  { key: "assists", label: "Assists" },
  { key: "player_damage", label: "Damage", big: true },
  { key: "obj_damage", label: "Obj damage", big: true },
  { key: "player_healing", label: "Healing", big: true },
  { key: "net_worth", label: "Souls", big: true },
  { key: "last_hits", label: "Last hits", whole: true },
  { key: "denies", label: "Denies" },
  { key: "kda", label: "KDA", ratio: true },
];

const MODES = [
  { key: "avg", label: "Average" },
  { key: "total", label: "Total" },
];

// Desktop: rank, player, games, primary, secondary, top hero. Phones drop games and
// the secondary column (they move under the name) and show the hero as an icon.
const COLS =
  "grid-cols-[24px_minmax(0,1fr)_64px_30px] md:grid-cols-[40px_minmax(0,1.8fr)_70px_120px_110px_minmax(0,1fr)]";

function formatAverage(stat, value) {
  if (stat.ratio) return value.toFixed(2);
  if (stat.big || stat.whole) return Math.round(value).toLocaleString("en-GB");
  return value.toFixed(1);
}

function formatTotal(stat, value) {
  return stat.ratio ? value.toFixed(2) : Math.round(value).toLocaleString("en-GB");
}

function rankColor(index) {
  if (index === 0) return "text-accent-light";
  if (index < 3) return "text-primary";
  return "text-dim";
}

function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium transition-colors duration-200 active:scale-[.97] ${
        active
          ? "border-accent-border bg-accent-bg-strong text-accent-light"
          : "border-border-light bg-badge-bg text-secondary hover:bg-hover"
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Leaderboards: players ranked on one stat over the filtered weeks and region,
 * by average per game or by total. Only players with the minimum games (5) are
 * ranked, in both modes.
 */
export default function LeaderboardsTab({ query }) {
  const { data, loading, error, reload } = usePanelData(`/db/stats/leaderboards?${query}`, {
    errorMessage: "Could not load the leaderboards",
  });
  const [statKey, setStatKey] = useState("kills");
  const [mode, setMode] = useState("avg");

  const stat = STATS.find((entry) => entry.key === statKey);
  const rows = data?.stats?.[statKey]?.[mode] ?? [];
  const minGames = data?.min_games ?? 5;
  const statName = stat.ratio ? stat.label : stat.label.toLowerCase();
  const primaryLabel = `${mode === "avg" ? "Avg" : "Total"} ${statName}`;
  const secondaryLabel = mode === "avg" ? "Total" : "Avg / game";

  if (error) return <ErrorMessage message={error} onRetry={reload} />;

  return (
    <section
      aria-label="Leaderboards"
      className="flex flex-col gap-4 rounded-xl border border-border-light bg-card px-5 py-[18px] shadow-[var(--shadow-panel)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {STATS.map((entry) => (
            <Chip key={entry.key} active={entry.key === statKey} onClick={() => setStatKey(entry.key)}>
              {entry.label}
            </Chip>
          ))}
        </div>
        <div className="flex gap-0.5 rounded-full border border-border-light bg-input p-[3px]">
          {MODES.map((entry) => (
            <button
              key={entry.key}
              type="button"
              aria-pressed={mode === entry.key}
              onClick={() => setMode(entry.key)}
              className={`rounded-full px-4 py-[5px] text-[13px] font-semibold transition-colors duration-200 ${
                mode === entry.key ? "bg-accent-bg-strong text-accent-light" : "text-muted hover:text-secondary"
              }`}
            >
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="-mx-3 flex flex-col gap-0.5">
        <div
          className={`grid ${COLS} items-center gap-3 px-3 pb-2 text-[11px] font-semibold uppercase tracking-[0.05em] text-dim`}
        >
          <span>#</span>
          <span>Player</span>
          <span className="hidden text-right md:block">Games</span>
          <span className="text-right text-accent-light">{primaryLabel}</span>
          <span className="hidden text-right md:block">{secondaryLabel}</span>
          <span className="text-right md:text-left">
            <span className="md:hidden">Hero</span>
            <span className="hidden md:inline">Top hero</span>
          </span>
        </div>

        {loading ? (
          Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="mx-3 my-1 h-8 animate-pulse rounded-md bg-hover/50" aria-hidden="true" />
          ))
        ) : rows.length === 0 ? (
          <p className="px-3 py-6 text-center text-[13px] text-dim">
            No players with {minGames}+ games in these weeks.
          </p>
        ) : (
          rows.map((row, i) => {
            const primary = mode === "avg" ? formatAverage(stat, row.avg) : formatTotal(stat, row.total);
            const secondary = mode === "avg" ? formatTotal(stat, row.total) : formatAverage(stat, row.avg);
            const name = row.persona_name || "Unknown player";
            return (
              <Link
                key={row.account_id}
                to={`/player/${row.account_id}`}
                className={`grid ${COLS} items-center gap-3 rounded-lg px-3 py-2 text-secondary tabular-nums transition-[background-color,transform] duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:translate-x-1 hover:bg-accent-bg motion-reduce:hover:translate-x-0`}
              >
                <span className={`font-valve-oracle text-[16px] font-semibold ${rankColor(i)}`}>{i + 1}</span>
                <span className="flex min-w-0 flex-col">
                  <span title={name} className="truncate font-semibold text-primary">
                    {name}
                  </span>
                  <span className="text-[12px] text-dim md:hidden">
                    {row.games} games · {secondary} {mode === "avg" ? "total" : "avg"}
                  </span>
                </span>
                <span className="hidden text-right text-muted md:block">{row.games}</span>
                <span className="text-right font-valve-oracle text-[20px] font-bold text-accent-light">{primary}</span>
                <span className="hidden text-right text-[13px] text-dim md:block">{secondary}</span>
                <span className="flex min-w-0 items-center justify-end gap-2 md:justify-start">
                  <HeroIcon name={row.top_hero_name} size="h-[26px] w-[26px]" className="rounded-[5px]" />
                  <span className="hidden truncate text-[13px] md:inline">{row.top_hero_name}</span>
                </span>
              </Link>
            );
          })
        )}
      </div>

      <p className="text-[12px] text-dim">
        Only players with {minGames}+ games in the selected weeks are ranked, in both Average and Total.
      </p>
    </section>
  );
}
