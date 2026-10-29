import React from "react";
import ErrorMessage from "../components/ErrorMessage";
import usePanelData from "../components/player/usePanelData";
import HeadlineStrip from "../components/stats/HeadlineStrip";
import LeaderboardsTab from "../components/stats/LeaderboardsTab";
import LegacyStatsTab from "../components/stats/LegacyStatsTab";
import OverviewTab from "../components/stats/OverviewTab";
import RecordsTab from "../components/stats/RecordsTab";
import StatsFilterBar from "../components/stats/StatsFilterBar";
import useStatsFilters, { STATS_TABS } from "../components/stats/useStatsFilters";
import { formatWeeksParam, patchLabel, weeksLabel } from "../utils/statsPeriod";

const EVENT_TITLE = "Night Shift";
const NONE = [];
const TAB_LABELS = { overview: "Overview", heroes: "Heroes", records: "Records", leaderboards: "Leaderboards" };

function TabBar({ tab, onChange }) {
  return (
    <div className="scroll-thin flex overflow-x-auto pt-1">
      <div
        role="tablist"
        aria-label="Stats sections"
        className="inline-flex gap-0.5 rounded-full border border-border-light bg-card p-1"
      >
        {STATS_TABS.map((key) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => onChange(key)}
            className={`whitespace-nowrap rounded-full px-3.5 py-2 font-valve-oracle text-[15px] font-semibold transition-colors duration-200 ease-[cubic-bezier(.4,0,.2,1)] active:scale-[.97] md:px-5 ${
              tab === key ? "bg-accent-bg-strong text-accent-light" : "text-secondary hover:text-primary"
            }`}
          >
            {TAB_LABELS[key]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Headline and Overview for one range and region; mounts once the range is known. */
function SummarySections({ query, range, region, regions, tab, tabBar, weeksText, regionText }) {
  const { data, loading, error, reload } = usePanelData(`/db/stats/summary?${query}`, {
    errorMessage: "Could not load these stats",
  });
  // One row per region, or a single "All" row before any match has a region.
  const regionRows = region !== "All" ? [region] : regions.length ? regions : ["All"];

  return (
    <>
      {error ? (
        <ErrorMessage message={error} onRetry={reload} />
      ) : (
        <HeadlineStrip summary={data} loading={loading} regionRows={regionRows} weeksText={weeksText} />
      )}
      {tabBar}
      {tab === "overview" && !error && (
        <OverviewTab summary={data} loading={loading} range={range} regionText={regionText} />
      )}
    </>
  );
}

/**
 * /stats: Night Shift statistics for a week range and region. One filter state,
 * kept in the URL, drives the subtitle, the headline and every tab.
 */
function Stats() {
  const periods = usePanelData(`/db/stats/periods?event_title=${encodeURIComponent(EVENT_TITLE)}`, {
    errorMessage: "Could not load the Night Shift weeks",
  });
  const weeks = periods.data?.weeks ?? NONE;
  const patches = periods.data?.patches ?? NONE;
  const regions = periods.data?.regions ?? NONE;
  const filters = useStatsFilters({ weeks, regions });
  const { range, region, tab } = filters;

  const ready = Boolean(range && weeks.length);
  // The filter every tab's endpoint reads.
  const query = ready
    ? `event_title=${encodeURIComponent(EVENT_TITLE)}&weeks=${formatWeeksParam(range)}&region=${region}`
    : "";
  const weeksText = ready ? weeksLabel(range, weeks) : "";
  const regionText = region === "All" ? "All regions" : region;
  const tabBar = <TabBar tab={tab} onChange={filters.setTab} />;
  const subtitle = ready
    ? [EVENT_TITLE, weeksText, patchLabel(range, weeks, patches), regionText].join(" · ")
    : periods.loading
      ? "Loading…"
      : `No ${EVENT_TITLE} games yet`;

  return (
    <div className="flex w-full flex-col gap-5 px-4 pt-4 pb-10 md:px-6 md:pt-7 md:pb-14">
      <header className="flex flex-col gap-1">
        <h1 className="font-valve-pulp text-[30px] leading-[1.05] text-primary md:text-[40px]">Statistics</h1>
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
          />

          {ready ? (
            <SummarySections
              query={query}
              range={range}
              region={region}
              regions={regions}
              tab={tab}
              tabBar={tabBar}
              weeksText={weeksText}
              regionText={regionText}
            />
          ) : (
            <>
              <HeadlineStrip summary={null} loading={periods.loading} regionRows={NONE} weeksText="" />
              {tabBar}
            </>
          )}
          {tab === "heroes" && <LegacyStatsTab />}
          {ready && tab === "records" && <RecordsTab query={query} />}
          {ready && tab === "leaderboards" && <LeaderboardsTab query={query} />}
        </>
      )}
    </div>
  );
}

export default Stats;
