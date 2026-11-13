import React, { useMemo } from "react";
import ErrorMessage from "../components/ErrorMessage";
import ItemControls from "../components/items/ItemControls";
import ItemSummaryStrip from "../components/items/ItemSummaryStrip";
import ItemsGrid from "../components/items/ItemsGrid";
import ItemsTable from "../components/items/ItemsTable";
import useItemsView from "../components/items/useItemsView";
import usePanelData from "../components/player/usePanelData";
import StatsFilterBar from "../components/stats/StatsFilterBar";
import useStatsFilters from "../components/stats/useStatsFilters";
import { formatInteger } from "../utils/format";
import { filterItems, itemRows, itemSections, summaryPicks } from "../utils/items";
import { allWeeksRange, formatWeeksParam, patchLabel, weeksLabel } from "../utils/statsPeriod";

const EVENT_TITLE = "Night Shift";
const NONE = [];

function Toggle({ value, options, onChange, label }) {
  return (
    <div role="group" aria-label={label} className="flex gap-0.5 rounded-full border border-border-light bg-input p-[3px]">
      {options.map(([key, text]) => (
        <button
          key={key}
          type="button"
          aria-pressed={value === key}
          onClick={() => onChange(key)}
          className={`rounded-full px-3 py-[5px] text-[13px] font-medium transition-colors duration-200 ${
            value === key ? "bg-hover text-primary" : "text-muted hover:text-secondary"
          }`}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

function TableSkeleton() {
  const widths = ["34%", "26%", "40%", "22%", "30%", "36%", "24%", "32%"];
  return (
    <div aria-hidden="true" className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="h-10 bg-table" />
      {widths.map((width, index) => (
        <div
          key={width + index}
          className="flex animate-pulse items-center gap-3.5 border-t border-border px-4 py-3"
          style={{ opacity: 1 - index * 0.09 }}
        >
          <div className="h-[34px] w-[34px] rounded-md bg-hover" />
          <div className="h-[11px] rounded bg-hover" style={{ width }} />
          <span className="flex-1" />
          <div className="h-[11px] w-[60px] rounded bg-hover" />
          <div className="h-[11px] w-[60px] rounded bg-hover" />
          <div className="h-[11px] w-10 rounded bg-hover" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ title, body, action, onAction }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-border bg-card px-6 py-14 text-center">
      <span className="font-valve-oracle text-[20px] text-primary">{title}</span>
      <span className="max-w-[420px] text-muted">{body}</span>
      {action && (
        <button
          type="button"
          onClick={onAction}
          className="mt-2.5 rounded-full bg-primary px-4 py-2 text-[14px] font-semibold text-[var(--color-base)] transition-opacity hover:opacity-90"
        >
          {action}
        </button>
      )}
    </div>
  );
}

/** Everything under the filter bar, once the week range is known. */
function ItemsResults({ query, view, filters, weeks, regionText, weeksText }) {
  const { data, loading, error, reload } = usePanelData(`/db/items/stats?${query}`, {
    errorMessage: "Could not load item stats",
  });
  const { minGames, sort, group, layout } = view;

  const rows = useMemo(() => itemRows(data?.items ?? NONE, data?.player_games ?? 0), [data]);
  const visible = useMemo(
    () => filterItems(rows, { slot: view.slot, tiers: view.tiers, q: view.q }),
    [rows, view.slot, view.tiers, view.q],
  );
  const sections = useMemo(() => itemSections(visible, { group, sort, minGames }), [visible, group, sort, minGames]);
  const picks = useMemo(() => summaryPicks(rows, minGames), [rows, minGames]);

  if (error && !data) return <ErrorMessage message={error} onRetry={reload} />;

  const firstLoad = loading && !data;
  const matches = data?.matches ?? 0;
  const searching = view.q.trim();
  const countLabel = firstLoad
    ? "Loading…"
    : `${visible.length} items · ${formatInteger(matches)} matches · ${formatInteger(data?.player_games ?? 0)} player-games`;

  let body;
  if (firstLoad) {
    body = <TableSkeleton />;
  } else if (matches === 0) {
    body = (
      <EmptyState
        title="No matches for these filters"
        body={`No ${EVENT_TITLE} matches were played in ${weeksText}${regionText === "All regions" ? "" : ` in ${regionText}`}.`}
        action="Show everything"
        onAction={() => filters.setFilters([weeks[0].week, weeks[weeks.length - 1].week], "All")}
      />
    );
  } else if (visible.length === 0) {
    body = (
      <EmptyState
        title="No items match"
        body={
          searching
            ? `Nothing matches “${searching}” with the current slot and tier filters.`
            : "No items were bought under these filters."
        }
        action="Reset filters"
        onAction={view.resetView}
      />
    );
  } else if (layout === "grid") {
    body = <ItemsGrid sections={sections} minGames={minGames} />;
  } else {
    body = <ItemsTable sections={sections} sort={sort} onSort={view.setSort} minGames={minGames} />;
  }

  return (
    <>
      {!firstLoad && matches > 0 && <ItemSummaryStrip picks={picks} minGames={minGames} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-[13px] text-muted">{countLabel}</span>
        <div className="flex items-center gap-2.5">
          <Toggle label="Grouping" value={group} options={[["flat", "Flat"], ["slot", "By slot"]]} onChange={view.setGroup} />
          <Toggle label="Layout" value={layout} options={[["table", "Table"], ["grid", "Grid"]]} onChange={view.setLayout} />
        </div>
      </div>

      {body}

      {loading && data && (
        <div className="fixed top-3 left-1/2 z-40 -translate-x-1/2 rounded-full border border-border-lighter bg-panel px-3.5 py-2 text-[13px] text-muted shadow-heavy">
          Updating…
        </div>
      )}
    </>
  );
}

/**
 * /items: every shop item's pick rate, win rate, buy time and sell rate for a
 * Night Shift week range and region. The Period and Region filter is the stats
 * page's own (same URL params), but it opens on every match rather than on the
 * latest two weeks; slot, tier, search, min games, sort and layout are applied
 * in the browser.
 */
export default function ItemsList() {
  const periods = usePanelData(`/db/stats/periods?event_title=${encodeURIComponent(EVENT_TITLE)}`, {
    errorMessage: "Could not load the Night Shift weeks",
  });
  const weeks = periods.data?.weeks ?? NONE;
  const patches = periods.data?.patches ?? NONE;
  const regions = periods.data?.regions ?? NONE;
  const filters = useStatsFilters({ weeks, regions, defaultRange: allWeeksRange });
  const view = useItemsView();
  const { range, region } = filters;

  const ready = Boolean(range && weeks.length);
  const query = ready
    ? `event_title=${encodeURIComponent(EVENT_TITLE)}&weeks=${formatWeeksParam(range)}&region=${region}`
    : "";
  const weeksText = ready ? weeksLabel(range, weeks) : "";
  const regionText = region === "All" ? "All regions" : region;
  const subtitle = ready
    ? `Which items get bought and which items win · ${[EVENT_TITLE, weeksText, patchLabel(range, weeks, patches), regionText].join(" · ")}`
    : periods.loading
      ? "Loading…"
      : `No ${EVENT_TITLE} games yet`;

  return (
    <div className="flex w-full flex-col gap-4 px-4 pt-4 pb-10 md:px-6 md:pt-7 md:pb-14">
      <header className="flex flex-col gap-1">
        <h1 className="font-valve-pulp text-[30px] leading-[1.05] text-primary md:text-[40px]">Items</h1>
        <p className="text-[14px] text-muted">{subtitle}</p>
      </header>

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
            defaultRange={allWeeksRange}
          >
            <ItemControls view={view} />
          </StatsFilterBar>

          {ready ? (
            <ItemsResults
              query={query}
              view={view}
              filters={filters}
              weeks={weeks}
              regionText={regionText}
              weeksText={weeksText}
            />
          ) : (
            periods.loading && <TableSkeleton />
          )}
        </>
      )}
    </div>
  );
}
