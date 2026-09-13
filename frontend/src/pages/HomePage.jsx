import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ContributeWidget from "../components/home/ContributeWidget";
import HomeHero from "../components/home/HomeHero";
import QuickSearchWidget from "../components/home/QuickSearchWidget";
import SeasonStatsWidget from "../components/home/SeasonStatsWidget";
import SeriesWeekGroup from "../components/home/SeriesWeekGroup";
import StreamWidget from "../components/home/StreamWidget";
import { getStreamStatus } from "../utils/api";
import { buildWeekGroups } from "../utils/seriesGroups";

/* /db/matches/latest/paged clamps per_page at 20, so a batch is several pages. */
const PER_PAGE = 20;
const PAGES_PER_BATCH = 3;
const WEEKS_PER_BATCH = 3;
const EVENT_TITLE = "Night Shift";

/** Fetch N consecutive pages of recent Night Shift matches and merge them. */
async function fetchMatchBatch(fromPage, pageCount = PAGES_PER_BATCH) {
  const pages = Array.from({ length: pageCount }, (_, index) => fromPage + index);

  const responses = await Promise.all(
    pages.map(async (page) => {
      const res = await fetch(
        `/db/matches/latest/paged?page=${page}&per_page=${PER_PAGE}&event_title=${encodeURIComponent(EVENT_TITLE)}&include_players=0`,
      );
      if (!res.ok) throw new Error("Failed to load recent matches");
      return res.json();
    }),
  );

  return {
    matches: responses.flatMap((data) => data.matches || []),
    totalPages: responses[0]?.total_pages || 0,
  };
}

function HomePage() {
  const [matches, setMatches] = useState([]);
  const [details, setDetails] = useState({});
  const [seriesTitle, setSeriesTitle] = useState(EVENT_TITLE);
  const [pagesLoaded, setPagesLoaded] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [visibleWeeks, setVisibleWeeks] = useState(WEEKS_PER_BATCH);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(null);
  const [loadMoreError, setLoadMoreError] = useState(null);
  const [stream, setStream] = useState(undefined);

  const loadSeries = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setLoadMoreError(null);

      const [weeksData, batch] = await Promise.all([
        fetch(`/db/weeks?event_title=${encodeURIComponent(EVENT_TITLE)}`).then(
          (res) => {
            if (!res.ok) throw new Error("Failed to load series metadata");
            return res.json();
          },
        ),
        fetchMatchBatch(1),
      ]);

      setSeriesTitle(weeksData.title || EVENT_TITLE);
      setDetails(weeksData.details || {});
      setMatches(batch.matches);
      setPagesLoaded(PAGES_PER_BATCH);
      setTotalPages(batch.totalPages);
      setVisibleWeeks(WEEKS_PER_BATCH);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSeries();
  }, [loadSeries]);

  /* Stream status is optional — a failure just leaves the widget neutral. */
  useEffect(() => {
    let cancelled = false;

    getStreamStatus()
      .then((data) => {
        if (!cancelled) setStream(data);
      })
      .catch(() => {
        if (!cancelled) setStream(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* Fold matches + week metadata into per-week series groups. */
  const weekGroups = useMemo(
    () => buildWeekGroups(matches, details),
    [matches, details],
  );

  const visibleGroups = weekGroups.slice(0, visibleWeeks);
  const hasMoreWeeks = weekGroups.length > visibleWeeks;
  const hasMorePages = pagesLoaded < totalPages;
  const canLoadMore = hasMoreWeeks || hasMorePages;

  const handleLoadMore = async () => {
    // Reveal weeks already in memory before asking for another batch.
    if (hasMoreWeeks) {
      setVisibleWeeks((count) => count + WEEKS_PER_BATCH);
      return;
    }
    if (!hasMorePages || loadingMore) return;

    try {
      setLoadingMore(true);
      setLoadMoreError(null);

      const batch = await fetchMatchBatch(pagesLoaded + 1);
      setMatches((prev) => [...prev, ...batch.matches]);
      setPagesLoaded((count) => count + PAGES_PER_BATCH);
      setTotalPages(batch.totalPages);
      setVisibleWeeks((count) => count + WEEKS_PER_BATCH);
    } catch (e) {
      setLoadMoreError(e.message);
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <div className="w-full px-4">
      <HomeHero />

      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="min-w-0">
          <div className="mb-4 flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-[.1em] text-muted">
              Recent Series
            </h2>
            <Link
              to="/week"
              className="shrink-0 text-xs font-semibold text-accent-secondary-light transition-colors hover:text-accent-secondary"
            >
              All series →
            </Link>
          </div>

          {loading && <LoadingSkeleton variant="series-list" />}

          {!loading && error && (
            <ErrorMessage message={error} onRetry={loadSeries} />
          )}

          {!loading && !error && (
            <>
              <div className="flex flex-col gap-6">
                {visibleGroups.length === 0 ? (
                  <p className="rounded-lg border border-border bg-panel px-4 py-8 text-center text-sm text-muted">
                    No series published yet. Check back after the next Night
                    Shift.
                  </p>
                ) : (
                  visibleGroups.map((group) => (
                    <SeriesWeekGroup
                      key={group.week}
                      week={group.week}
                      seriesTitle={seriesTitle}
                      entries={group.entries}
                      dateLabel={group.dateLabel}
                      totalSeries={group.totalSeries}
                    />
                  ))
                )}
              </div>

              {canLoadMore && (
                <div className="mt-6 flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="rounded-full border border-accent-border bg-accent-bg px-5 py-2 text-xs font-semibold text-accent-light transition-colors hover:bg-accent-bg-strong disabled:opacity-60"
                  >
                    {loadingMore ? "Loading…" : "Load more series"}
                  </button>
                  {loadMoreError && (
                    <p className="text-xs text-danger-text">{loadMoreError}</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <aside className="flex flex-col gap-4 lg:sticky lg:top-4">
          <QuickSearchWidget />
          <StreamWidget stream={stream} />
          <SeasonStatsWidget />
          <ContributeWidget />
        </aside>
      </div>
    </div>
  );
}

export default HomePage;
