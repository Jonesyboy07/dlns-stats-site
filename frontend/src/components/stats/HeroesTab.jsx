import React, { useMemo } from "react";
import { Link } from "react-router-dom";
import Button from "../Button";
import ErrorMessage from "../ErrorMessage";
import HeroIcon from "../HeroIcon";
import SectionCard from "../SectionCard";
import usePanelData from "../player/usePanelData";
import MetaScatter from "./MetaScatter";
import { heroRows, mostBanned, nextSort, signedDelta, sortHeroes, winColor } from "../../utils/heroMeta";

const pct = (value) => `${Number(value).toFixed(1)}%`;

/* Desktop: hero + six numbers. Mobile: hero, Pick %, Contest, Win %. */
const ROW_GRID =
  "grid grid-cols-[minmax(0,1fr)_58px_62px_58px] gap-3 md:grid-cols-[minmax(170px,1.8fr)_repeat(6,minmax(56px,1fr))]";
const LOWER_GRID = "grid items-start gap-3.5 md:grid-cols-[minmax(0,1.45fr)_minmax(0,1fr)]";

const COLUMNS = [
  { key: "hero", label: "Hero", align: "left" },
  { key: "picks", label: "Picks", desktopOnly: true },
  { key: "pick", label: "Pick %" },
  { key: "bans", label: "Bans", desktopOnly: true },
  { key: "ban", label: "Ban %", desktopOnly: true },
  { key: "contest", label: "Contest %", mobileLabel: "Contest", title: "Picked or banned, % of games" },
  { key: "win", label: "Win %" },
];

const SORT_NAMES = {
  hero: "Hero",
  picks: "Picks",
  pick: "Pick %",
  bans: "Bans",
  ban: "Ban %",
  contest: "Contest %",
  win: "Win %",
};

/* ── Hero meta table ── */

function SortHeader({ column, sort, onSort }) {
  const active = sort.column === column.key;
  const arrow = active ? (sort.dir === "desc" ? " ▾" : " ▴") : "";
  return (
    <button
      type="button"
      onClick={() => onSort(nextSort(sort, column.key))}
      title={column.title}
      aria-sort={active ? (sort.dir === "desc" ? "descending" : "ascending") : undefined}
      className={`cursor-pointer uppercase transition-colors duration-200 hover:text-secondary ${
        column.align === "left" ? "text-left" : "text-right"
      } ${active ? "text-accent-light" : "text-dim"} ${column.desktopOnly ? "hidden md:block" : ""}`}
    >
      {column.mobileLabel ? (
        <>
          <span className="md:hidden">{column.mobileLabel}</span>
          <span className="hidden md:inline">{column.label}</span>
        </>
      ) : (
        column.label
      )}
      {arrow}
    </button>
  );
}

function PickCell({ value }) {
  return (
    <span className="flex flex-col items-end gap-1">
      <span>{pct(value)}</span>
      <span className="h-[3px] w-full max-w-[72px] overflow-hidden rounded-full bg-hover">
        <span className="block h-full bg-accent" style={{ width: `${value}%` }} />
      </span>
    </span>
  );
}

function WinCell({ win, picks }) {
  const color = winColor(win, picks);
  return (
    <span className="flex flex-col items-end gap-1">
      <span className="font-semibold" style={{ color }}>
        {pct(win)}
      </span>
      <span className="relative h-[3px] w-full max-w-[72px] rounded-full bg-hover">
        <span className="absolute top-[-2px] left-1/2 h-[7px] w-px bg-dim" />
        <span
          className="absolute top-0 h-full rounded-full"
          style={{
            left: `${Math.min(win, 50)}%`,
            width: `${Math.max(Math.abs(win - 50), 1)}%`,
            background: color,
          }}
        />
      </span>
    </span>
  );
}

function HeroMetaTable({ rows, games, sort, onSort }) {
  const sorted = useMemo(() => sortHeroes(rows, sort), [rows, sort]);
  const subtitle = `${rows.length} heroes · ${games} games · sorted by ${SORT_NAMES[sort.column]} · click a row to open the hero`;

  return (
    <SectionCard title="Hero meta" subtitle={subtitle}>
      <div className="-mx-3 flex flex-col gap-0.5">
        <div className={`${ROW_GRID} items-center px-3 pb-2 text-[11px] font-semibold tracking-[0.05em]`}>
          {COLUMNS.map((column) => (
            <SortHeader key={column.key} column={column} sort={sort} onSort={onSort} />
          ))}
        </div>
        {sorted.map((hero) => (
          <Link
            key={hero.hero_id}
            to={`/hero/${hero.hero_id}`}
            title={`Open ${hero.name}`}
            className={`${ROW_GRID} items-center rounded-lg px-3 py-[7px] text-[14px] text-secondary tabular-nums transition-[background-color,transform] duration-200 ease-[cubic-bezier(.4,0,.2,1)] hover:translate-x-1 hover:bg-accent-bg motion-reduce:transition-none`}
          >
            <span className="flex min-w-0 items-center gap-2.5">
              <HeroIcon name={hero.name} size="h-7 w-7" className="rounded-md" />
              <span className="truncate font-medium text-primary">{hero.name}</span>
            </span>
            <span className="hidden text-right md:block">{hero.picks}</span>
            <PickCell value={hero.pick} />
            <span className="hidden text-right md:block">{hero.bans}</span>
            <span className="hidden text-right text-muted md:block">{pct(hero.ban)}</span>
            <span className="text-right font-semibold text-primary">{pct(hero.contest)}</span>
            <WinCell win={hero.win} picks={hero.picks} />
          </Link>
        ))}
      </div>
    </SectionCard>
  );
}

/* ── Risers & fallers ── */

function MoverList({ title, movers, className }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <span className={`text-[11px] font-semibold uppercase tracking-[0.05em] ${className}`}>{title}</span>
      {movers.length === 0 ? (
        <span className="text-[13px] text-dim">None</span>
      ) : (
        movers.map((mover) => (
          <Link
            key={mover.hero_id}
            to={`/hero/${mover.hero_id}`}
            title={`${mover.name}: ${pct(mover.prev_pick_pct)} → ${pct(mover.pick_pct)}`}
            className="flex min-w-0 items-center gap-2 rounded-md transition-colors hover:bg-accent-bg"
          >
            <HeroIcon name={mover.name} size="h-6 w-6" className="rounded-[5px]" />
            <span className="min-w-0 flex-1 truncate text-[13px] text-primary">{mover.name}</span>
            <span className={`text-[13px] font-semibold tabular-nums ${className}`}>{signedDelta(mover.delta)}</span>
          </Link>
        ))
      )}
    </div>
  );
}

function RisersFallers({ movers, previousWeek }) {
  return (
    <SectionCard title="Risers & fallers" subtitle={`Change in pick % vs week ${previousWeek}`}>
      {movers ? (
        <div className="grid grid-cols-2 gap-[18px]">
          <MoverList title="▲ Rising" movers={movers.rising} className="text-success" />
          <MoverList title="▼ Falling" movers={movers.falling} className="text-danger-text" />
        </div>
      ) : (
        <p className="py-4 text-center text-[13px] text-dim">Needs at least two weeks</p>
      )}
    </SectionCard>
  );
}

/* ── Most banned ── */

function MostBanned({ rows, totalBans, games }) {
  const top = mostBanned(rows);
  const max = top[0]?.bans || 1;
  return (
    <SectionCard title="Most banned" subtitle={`${totalBans} bans across ${games} games`}>
      {top.length === 0 ? (
        <p className="py-4 text-center text-[13px] text-dim">No bans recorded for these games.</p>
      ) : (
        <ol className="flex flex-col gap-2">
          {top.map((hero, i) => (
            <li key={hero.hero_id}>
              <Link
                to={`/hero/${hero.hero_id}`}
                className="grid grid-cols-[16px_24px_minmax(0,1fr)_90px_28px] items-center gap-2 rounded-md text-[13px] transition-colors hover:bg-accent-bg"
              >
                <span className="text-dim">{i + 1}</span>
                <HeroIcon name={hero.name} size="h-6 w-6" className="rounded-[5px]" />
                <span className="truncate text-primary">{hero.name}</span>
                <span className="h-1.5 overflow-hidden rounded-full bg-hover">
                  <span className="block h-full bg-danger" style={{ width: `${(hero.bans / max) * 100}%` }} />
                </span>
                <span className="text-right font-semibold text-primary tabular-nums">{hero.bans}</span>
              </Link>
            </li>
          ))}
        </ol>
      )}
    </SectionCard>
  );
}

/* ── States ── */

function Pulse({ className }) {
  return <div className={`animate-pulse rounded bg-hover ${className}`} />;
}

function HeroesSkeleton({ weeksText }) {
  return (
    <div className="flex flex-col gap-3.5" aria-hidden="true">
      <SectionCard title="Hero meta" subtitle={weeksText ? `Loading ${weeksText.toLowerCase()}…` : "Loading…"}>
        <div className="flex flex-col gap-3">
          {Array.from({ length: 10 }, (_, i) => (
            <div key={i} className="flex items-center gap-3">
              <Pulse className="h-7 w-7 rounded-md" />
              <Pulse className="h-4 flex-1" />
            </div>
          ))}
        </div>
      </SectionCard>
      <div className={LOWER_GRID}>
        <SectionCard title="Pick rate vs win rate">
          <div className="flex h-[300px] items-center justify-center rounded-lg bg-table md:h-[460px]">
            <Pulse className="h-4 w-48" />
          </div>
        </SectionCard>
        <SectionCard title="Risers & fallers">
          <div className="flex flex-col gap-3">
            {Array.from({ length: 5 }, (_, i) => (
              <Pulse key={i} className="h-5 w-full" />
            ))}
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function NoMatches({ region, weeksText, onLatest, onAllRegions }) {
  const where = region === "All" ? "" : `${region} `;
  const when = weeksText ? weeksText.replace(/^W/, "w") : "this range";
  return (
    <SectionCard>
      <div className="flex flex-col items-center gap-2.5 px-3 py-12 text-center">
        <span className="font-valve-oracle text-[22px] font-semibold text-primary">No matches for these filters</span>
        <span className="max-w-[440px] text-pretty leading-normal text-muted">
          No {where}games have been processed for {when} yet.{" "}
          {region === "All" ? "Widen the week range." : "Widen the week range or switch region."}
        </span>
        <div className="mt-2 flex flex-wrap justify-center gap-2">
          <Button variant="accent" onClick={onLatest}>
            Go to latest weeks
          </Button>
          {region !== "All" && <Button onClick={onAllRegions}>Show all regions</Button>}
        </div>
      </div>
    </SectionCard>
  );
}

/**
 * Heroes: the hero meta for the filtered weeks and region. A sortable table of
 * picks, bans, contest and win rates, then pick vs win rate beside the week's
 * pick % movers and the most banned heroes.
 */
export default function HeroesTab({ query, region, weeksText, sort, onSort, onLatest, onAllRegions }) {
  const { data, loading, error, reload } = usePanelData(`/db/stats/heroes?${query}`, {
    errorMessage: "Could not load the hero stats",
  });
  const games = data?.games ?? 0;
  const rows = useMemo(() => heroRows(data?.heroes ?? [], games), [data, games]);

  if (error) return <ErrorMessage message={error} onRetry={reload} />;
  if (loading || !data) return <HeroesSkeleton weeksText={weeksText} />;
  if (!games) {
    return <NoMatches region={region} weeksText={weeksText} onLatest={onLatest} onAllRegions={onAllRegions} />;
  }

  return (
    <section className="flex flex-col gap-3.5" aria-label="Heroes">
      <HeroMetaTable rows={rows} games={games} sort={sort} onSort={onSort} />
      <div className={LOWER_GRID}>
        <div className="min-w-0">
          <MetaScatter heroes={rows} games={games} />
        </div>
        <div className="flex min-w-0 flex-col gap-3.5">
          <RisersFallers movers={data.movers} previousWeek={data.previous_week} />
          <MostBanned rows={rows} totalBans={data.total_bans ?? 0} games={games} />
        </div>
      </div>
    </section>
  );
}
