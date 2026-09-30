import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import HeroIcon from "../HeroIcon";
import SegmentedControl from "../player/SegmentedControl";
import { formatPercent, signedPoints } from "../../utils/heroPages";

const MIN_OPTIONS = [5, 10, 20];
const TOP_N = 8;
/** The win-rate swing that fills half of the diverging bar, as a fraction. */
const FULL_BAR = 0.15;

const MODES = [
  { id: "against", label: "Against" },
  { id: "with", label: "With" },
];

const SORTS = {
  games: (a, b) => b.games - a.games || b.winRate - a.winRate,
  win: (a, b) => b.winRate - a.winRate || b.games - a.games,
  delta: (a, b) => b.delta - a.delta,
};

/**
 * Matchups: win rate against (or alongside) every other hero, compared against
 * this hero's own overall win rate. Bars are diverging around that overall rate.
 */
function HeroMatchupsPanel({ matchups, overallWinRate, heroNames = {} }) {
  const [mode, setMode] = useState("against");
  const [minGames, setMinGames] = useState(10);
  const [sort, setSort] = useState("games");
  const [showAll, setShowAll] = useState(false);

  const rows = useMemo(() => {
    const source = (mode === "against" ? matchups?.effective_against : matchups?.effective_with) ?? [];
    return source
      .filter((row) => (row.games ?? 0) >= minGames)
      .map((row) => {
        const winRate = row.win_rate ?? 0;
        // Accept either a plain name or a hero entry ({ name, released }) so a
        // caller cannot accidentally render an object as a React child.
        const entry = heroNames[String(row.hero_id)];
        const name = (typeof entry === "string" ? entry : entry?.name) ?? `Hero ${row.hero_id}`;
        return {
          heroId: row.hero_id,
          name,
          games: row.games ?? 0,
          winRate,
          delta: winRate - (overallWinRate ?? 0),
        };
      })
      .sort(SORTS[sort]);
  }, [matchups, mode, minGames, sort, overallWinRate, heroNames]);

  const visible = showAll ? rows : rows.slice(0, TOP_N);

  const label = (key, text) => (
    <button
      type="button"
      onClick={() => setSort(key)}
      className={`bg-transparent p-0 text-left uppercase tracking-[.05em] transition-colors ${
        sort === key ? "text-accent-secondary-light" : "text-dim hover:text-secondary"
      }`}
    >
      {text}
      {sort === key ? " ↓" : ""}
    </button>
  );

  return (
    <Panel title="Matchups" subtitle="Win rate with and against other heroes, vs this hero's overall">
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <SegmentedControl options={MODES} value={mode} onChange={setMode} label="Matchup mode" />
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[12px] text-dim">Min games</span>
            {MIN_OPTIONS.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setMinGames(option)}
                aria-pressed={minGames === option}
                className={`rounded-md border px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                  minGames === option
                    ? "border-accent-secondary-border bg-accent-secondary-bg-strong text-accent-secondary-light"
                    : "border-border-light text-muted hover:text-secondary"
                }`}
              >
                {option}+
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col">
          <div className="grid grid-cols-[minmax(0,1.4fr)_56px_64px_minmax(0,1fr)] gap-2.5 px-2 pb-2 text-[11px] text-dim">
            <span className="uppercase tracking-[.05em]">Hero</span>
            {label("games", "Games")}
            {label("win", "Win %")}
            {label("delta", "Δ vs avg")}
          </div>

          {visible.map((row) => {
            const magnitude = Math.min((Math.abs(row.delta) / FULL_BAR) * 50, 50);
            const positive = row.delta >= 0;
            const tone = row.winRate >= 0.5 ? "text-success" : "text-danger-text";
            return (
              <Link
                key={row.heroId}
                to={`/hero/${row.heroId}`}
                className="grid grid-cols-[minmax(0,1.4fr)_56px_64px_minmax(0,1fr)] items-center gap-2.5 rounded-md border-t border-border px-2 py-[7px] text-[14px] no-underline transition-colors hover:bg-accent-secondary-bg"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <HeroIcon name={row.name} size="h-7 w-7" />
                  <span title={row.name} className="truncate text-primary">
                    {row.name}
                  </span>
                </span>
                <span className="tabular-nums text-muted">{row.games}</span>
                <span className={`font-semibold tabular-nums ${tone}`}>
                  {formatPercent(row.winRate)}
                </span>
                <span className="flex min-w-0 items-center gap-2">
                  <span className="relative h-2 flex-1 overflow-hidden rounded bg-table">
                    <span className="absolute bottom-[-3px] left-1/2 top-[-3px] w-px bg-border-lighter" />
                    <span
                      className={`absolute inset-y-0 rounded ${positive ? "bg-success" : "bg-danger-text"}`}
                      style={{
                        left: `${positive ? 50 : 50 - magnitude}%`,
                        width: `${magnitude}%`,
                      }}
                    />
                  </span>
                  <span className={`w-[52px] text-right text-[12px] font-semibold ${tone}`}>
                    {row.delta === 0 ? "—" : signedPoints(row.delta * 100)}
                  </span>
                </span>
              </Link>
            );
          })}

          {rows.length === 0 && (
            <p className="border-t border-border px-2 py-4 text-[14px] text-dim">
              No matchups with {minGames}+ games in this scope.
            </p>
          )}
        </div>

        {rows.length > TOP_N && (
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="rounded-md px-3 py-1.5 text-[12px] font-semibold text-accent-secondary-light transition-colors hover:bg-accent-secondary-bg"
            >
              {showAll ? "Show top 8" : `Show all ${rows.length}`}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}

export default HeroMatchupsPanel;
