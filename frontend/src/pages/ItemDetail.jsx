import React, { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import Alert from "../components/Alert";
import ErrorMessage from "../components/ErrorMessage";
import { PlaceholderPanel } from "../components/heroes/PlaceholderPanel";
import BuyTimingPanel from "../components/items/BuyTimingPanel";
import {
  ItemDamagePanel,
  ItemHeroesPanel,
  ItemPlayersPanel,
  ItemRecentMatchesPanel,
} from "../components/items/ItemBreakdownPanels";
import { MinGamesStepper } from "../components/items/ItemControls";
import ItemHeadlineTiles from "../components/items/ItemHeadlineTiles";
import ItemIdentityCard from "../components/items/ItemIdentityCard";
import useItemsView from "../components/items/useItemsView";
import usePanelData from "../components/player/usePanelData";
import StatsFilterBar from "../components/stats/StatsFilterBar";
import useStatsFilters from "../components/stats/useStatsFilters";
import { DEFAULT_MIN_GAMES, isLowSample } from "../utils/items";
import { usePageMeta } from "../utils/seo";
import { allWeeksRange, formatWeeksParam, weeksLabel } from "../utils/statsPeriod";

const EVENT_TITLE = "Night Shift";
const NONE = [];
/* The roadmap placeholders (Trend, vs Hero Baseline, Pairings, Build Path). */
const SHOW_ROADMAP = true;

/** Like usePanelData, but keeps the status so an unknown item reads as "not found". */
function useItemStats(url) {
  const [state, setState] = useState({ data: null, loading: true, error: null, notFound: false });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!url) return undefined;
    let alive = true;
    setState((current) => ({ ...current, loading: true, error: null }));
    fetch(url)
      .then(async (response) => {
        if (response.status === 404) return { notFound: true };
        if (!response.ok) throw new Error("Could not load this item");
        return { data: await response.json() };
      })
      .then((result) => {
        if (!alive) return;
        setState((current) => ({
          data: result.data ?? current.data,
          loading: false,
          error: null,
          notFound: Boolean(result.notFound),
        }));
      })
      .catch((err) => {
        if (alive) setState((current) => ({ ...current, loading: false, error: err?.message || "Could not load this item" }));
      });
    return () => {
      alive = false;
    };
  }, [url, reloadKey]);

  return { ...state, reload: () => setReloadKey((key) => key + 1) };
}

function DetailSkeleton() {
  const block = "animate-pulse rounded-xl border border-border bg-card";
  return (
    <div aria-hidden="true" className="flex flex-col gap-3.5">
      <div className={`${block} h-[172px]`} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className={`${block} h-[116px] rounded-2xl`} />
        ))}
      </div>
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
        <div className={`${block} h-[360px]`} />
        <div className={`${block} h-[300px]`} />
      </div>
    </div>
  );
}

function NoData({ item, filterText, onReset }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-5 py-12 text-center">
      <span className="font-valve-oracle text-[20px] text-primary">Not bought under these filters</span>
      <span className="max-w-[420px] text-muted">
        Nobody built {item.name} in {filterText}.
      </span>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-[var(--color-base)] transition-opacity hover:opacity-90"
      >
        Show everything
      </button>
    </div>
  );
}

function ItemBody({ itemId, query, minGames, filterText, onShowEverything }) {
  const { data, loading, error, notFound, reload } = useItemStats(`/db/items/${itemId}/stats?${query}`);
  const item = data?.item;

  usePageMeta({
    title: item ? `${item.name} Stats — Deadlock Night Shift` : undefined,
    description: item
      ? `${item.name} win rate, pick rate, buy timing and the heroes and players who build it in the Deadlock Night Shift league.`
      : undefined,
    canonicalPath: `/item/${itemId}`,
    breadcrumbs: item
      ? [
          { name: "Home", path: "/" },
          { name: "Items", path: "/items" },
          { name: item.name, path: `/item/${itemId}` },
        ]
      : undefined,
  });

  if (notFound) {
    return (
      <div className="flex flex-col items-start gap-3">
        <ErrorMessage message="Item not found" />
        <Link to="/items" className="text-[14px] text-accent-light hover:text-primary">
          ‹ Back to all items
        </Link>
      </div>
    );
  }
  if (error && !data) return <ErrorMessage message={error} onRetry={reload} />;
  if (!data) return <DetailSkeleton />;

  const { totals } = data;
  const low = isLowSample(totals.games, minGames);

  return (
    <>
      <ItemIdentityCard item={item} showRoadmap={SHOW_ROADMAP} />

      {totals.games === 0 ? (
        <NoData item={item} filterText={filterText} onReset={onShowEverything} />
      ) : (
        <>
          {low && (
            <Alert variant="warning" title="Low sample">
              Only {totals.games} game{totals.games === 1 ? "" : "s"} with {item.name} under these filters (minimum{" "}
              {minGames}). Treat these numbers as anecdotes, not trends.
            </Alert>
          )}

          <ItemHeadlineTiles
            totals={totals}
            playerGames={data.player_games}
            matches={data.matches}
            minGames={minGames}
            low={low}
            showRoadmap={SHOW_ROADMAP}
          />

          <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <div className="flex min-w-0 flex-col gap-3.5">
              <BuyTimingPanel buckets={data.buy_timing} buys={data.buys} slot={item.slot} minGames={minGames} low={low} />
              <ItemRecentMatchesPanel matches={data.recent} />
            </div>
            <div className="flex min-w-0 flex-col gap-3.5">
              <ItemHeroesPanel heroes={data.heroes} minGames={minGames} />
              <ItemPlayersPanel players={data.players} minGames={minGames} />
              <ItemDamagePanel damage={data.damage} itemName={item.name} />
            </div>
          </div>
        </>
      )}

      {SHOW_ROADMAP && (
        <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] gap-3.5">
          <PlaceholderPanel title="Common Pairings" subtitle="Items most often built alongside this one" />
          <PlaceholderPanel title="Build Path" subtitle="What usually comes before and after it" />
        </div>
      )}

      {loading && (
        <div className="fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border-lighter bg-panel px-3.5 py-2 text-[13px] text-muted shadow-heavy">
          Updating…
        </div>
      )}
    </>
  );
}

/**
 * /item/:itemId: one item's win rate, pick rate, buy timing and who builds it,
 * for a Night Shift week range and region. The filter is the stats page's
 * (same URL params), plus the index's min-games threshold, so the link back to
 * /items keeps all three.
 */
export default function ItemDetail() {
  const { itemId } = useParams();
  const periods = usePanelData(`/db/stats/periods?event_title=${encodeURIComponent(EVENT_TITLE)}`, {
    errorMessage: "Could not load the Night Shift weeks",
  });
  const weeks = periods.data?.weeks ?? NONE;
  const patches = periods.data?.patches ?? NONE;
  const regions = periods.data?.regions ?? NONE;
  const filters = useStatsFilters({ weeks, regions });
  const { minGames, setMinGames } = useItemsView();
  const { range, region } = filters;

  const ready = Boolean(range && weeks.length);
  const query = ready
    ? `event_title=${encodeURIComponent(EVENT_TITLE)}&weeks=${formatWeeksParam(range)}&region=${region}`
    : "";
  const back = new URLSearchParams();
  if (ready) back.set("weeks", formatWeeksParam(range));
  if (region !== "All") back.set("region", region.toLowerCase());
  if (minGames !== DEFAULT_MIN_GAMES) back.set("min", String(minGames));
  const backHref = `/items${back.toString() ? `?${back}` : ""}`;
  const filterText = ready
    ? [weeksLabel(range, weeks), region === "All" ? null : region].filter(Boolean).join(" in ")
    : "";

  return (
    <div className="flex w-full flex-col gap-3.5 px-4 pt-4 pb-10 md:px-6 md:pt-7 md:pb-14">
      {periods.error ? (
        <ErrorMessage message={periods.error} onRetry={periods.reload} />
      ) : (
        <>
          <StatsFilterBar
            weeks={weeks}
            patches={patches}
            regions={regions}
            range={range}
            region={region}
            onRange={filters.setRange}
            onRegion={filters.setRegion}
            onFilters={filters.setFilters}
            shareUrl={filters.shareUrl}
          >
            <div className="flex flex-wrap items-center gap-3 pt-3 md:pt-0">
              <Link to={backHref} className="text-[13px] text-muted transition-colors hover:text-primary">
                ‹ All items
              </Link>
              <span aria-hidden="true" className="h-6 w-px bg-border-light" />
              <MinGamesStepper value={minGames} onChange={setMinGames} title="Rows with fewer games than this are greyed out" />
            </div>
          </StatsFilterBar>

          {ready ? (
            <ItemBody
              key={itemId}
              itemId={itemId}
              query={query}
              minGames={minGames}
              filterText={filterText}
              onShowEverything={() => filters.setFilters(allWeeksRange(weeks), "All")}
            />
          ) : (
            periods.loading && <DetailSkeleton />
          )}
        </>
      )}
    </div>
  );
}
