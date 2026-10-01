import React, { useEffect, useMemo, useState } from "react";
import heroNamesData from "../../../data/hero_names.json";
import ErrorMessage from "../components/ErrorMessage";
import HeroGridCard from "../components/heroes/HeroGridCard";
import HeroListSkeleton from "../components/heroes/HeroListSkeleton";
import TrendingStrip from "../components/heroes/TrendingStrip";

/** The sorts offered, in the order the design lays them out. Win rate is default. */
const SORTS = [
  { id: "win", label: "Win rate" },
  { id: "pick", label: "Pick rate" },
  { id: "name", label: "A–Z" },
];

const COMPARATORS = {
  win: (a, b) => (b.win ?? -1) - (a.win ?? -1),
  pick: (a, b) => (b.pick ?? -1) - (a.pick ?? -1),
  name: (a, b) => a.name.localeCompare(b.name),
};

/**
 * Heroes list (layout 1a): every released hero as a card with live pick %, win %
 * and games, a win-rate rank badge and a week-over-week trend arrow, plus a
 * "Trending This Week" strip and a search + sort bar.
 *
 * The tier-list view, the role filter and the "show unreleased" toggle from the
 * design are intentionally not built — unreleased heroes are never shown.
 */
function HeroesList() {
  const [selection, setSelection] = useState(null);
  const [overview, setOverview] = useState(null);
  const [trending, setTrending] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("win");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [selectionRes, overviewRes, trendingRes] = await Promise.all([
          fetch("/db/stats/hero-selection"),
          fetch("/db/stats/overview"),
          fetch("/db/heroes/trending"),
        ]);
        if (!selectionRes.ok || !overviewRes.ok) throw new Error("Failed to load hero stats");
        const selectionData = await selectionRes.json();
        const overviewData = await overviewRes.json();
        const trendingData = trendingRes.ok ? await trendingRes.json() : null;
        if (!alive) return;
        setSelection(selectionData.heroes ?? []);
        setOverview(overviewData.overview ?? null);
        setTrending(trendingData);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [reloadKey]);

  const released = useMemo(() => {
    const names = heroNamesData.heroes ?? {};
    return Object.entries(names)
      .filter(([, data]) => data.released)
      .map(([id, data]) => ({ id, name: data.name }));
  }, []);

  const totalGames = overview?.total_matches ?? null;

  const heroes = useMemo(() => {
    const statsById = new Map((selection ?? []).map((row) => [String(row.hero_id), row]));
    const trendById = trending?.heroes ?? {};

    const rows = released.map(({ id, name }) => {
      const stat = statsById.get(String(id));
      const games = stat?.pick_count ?? null;
      const win = stat?.win_rate ?? null;
      const pick = games != null && totalGames ? games / totalGames : null;
      const trend = trendById[String(id)];
      const delta =
        trend?.current?.win_rate != null && trend?.previous?.win_rate != null
          ? (trend.current.win_rate - trend.previous.win_rate) * 100
          : null;
      return { id, name, games, win, pick, delta };
    });

    return rows;
  }, [released, selection, trending, totalGames]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const list = needle
      ? heroes.filter((hero) => hero.name.toLowerCase().includes(needle))
      : heroes.slice();
    return list.sort(COMPARATORS[sort]);
  }, [heroes, query, sort]);

  const trendingItems = useMemo(() => {
    if (!trending?.heroes || !totalGames) return [];
    const byId = new Map(heroes.map((hero) => [hero.id, hero]));
    return Object.entries(trending.heroes)
      .map(([id, entry]) => {
        const hero = byId.get(id);
        if (!hero || entry.current?.win_rate == null || entry.previous?.win_rate == null) {
          return null;
        }
        return {
          heroId: id,
          name: hero.name,
          winRate: entry.current.win_rate,
          pickRate: entry.current.games ? entry.current.games / totalGames : null,
          delta: (entry.current.win_rate - entry.previous.win_rate) * 100,
        };
      })
      .filter(Boolean)
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
      .slice(0, 4);
  }, [trending, heroes, totalGames]);

  const clearFilters = () => setQuery("");

  if (loading) {
    return (
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8">
        <div className="h-10 w-40 animate-pulse rounded bg-hover" />
        <HeroListSkeleton />
      </div>
    );
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 font-valve-pulp text-[40px] leading-none text-primary">Heroes</h1>
        <p className="m-0 text-[14px] text-muted">
          Live meta numbers across{" "}
          {totalGames != null ? totalGames.toLocaleString() : "—"} DLNS games · All time
          {trending?.current_week != null ? ` · Updated after Week ${trending.current_week}` : ""}
        </p>
      </header>

      <TrendingStrip
        items={trendingItems}
        currentWeek={trending?.current_week}
        previousWeek={trending?.previous_week}
      />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search heroes..."
            className="min-w-0 flex-1 basis-[260px] max-w-[420px] rounded-lg border border-border-light bg-input px-3.5 py-2 text-[13px] text-secondary outline-none placeholder:text-dim focus:border-accent-secondary-border"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[12px] uppercase tracking-[.05em] text-dim">Sort</span>
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setSort(option.id)}
                aria-pressed={sort === option.id}
                className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold transition-colors ${
                  sort === option.id
                    ? "border-accent-secondary-border bg-accent-secondary-bg-strong text-accent-secondary-light"
                    : "border-border-light text-muted hover:text-secondary"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <span className="text-[13px] text-muted">
            Showing {filtered.length} of {heroes.length} heroes ·{" "}
            <span className="text-success">▲</span>
            <span className="text-danger-text">▼</span> = win-rate change vs last week
          </span>
        </div>
      </section>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-2.5 rounded-xl border border-dashed border-border-lighter bg-card px-6 py-12 text-center">
          <h3 className="m-0 font-valve-oracle text-[20px] text-primary">
            {query ? `No heroes match "${query}"` : "No heroes match these filters"}
          </h3>
          <p className="m-0 text-[14px] text-muted">Try a different name.</p>
          <button
            type="button"
            onClick={clearFilters}
            className="mt-1 rounded-md border border-border-light px-4 py-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div
          className="grid gap-3.5"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
        >
          {filtered.map((hero) => (
            <HeroGridCard key={hero.id} hero={hero} sortKey={sort} />
          ))}
        </div>
      )}
    </div>
  );
}

export default HeroesList;
