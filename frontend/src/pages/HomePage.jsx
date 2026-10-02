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

      <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <section className="flex min-w-0 flex-col gap-7">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-valve-oracle text-[14px] font-semibold uppercase tracking-[.16em] text-muted">
              Recent Series
            </h2>
            <Link
              to="/week"
              className="shrink-0 text-[12px] font-semibold text-accent-light transition-colors hover:text-accent"
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
              <div className="flex flex-col gap-7">
                {visibleGroups.length === 0 ? (
                  <p className="rounded-xl bg-card px-4 py-8 text-center text-[14px] text-muted">
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
                <div className="flex flex-col items-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadMore}
                    disabled={loadingMore}
                    className="rounded-xl bg-accent px-4 py-[10px] text-[14px] font-bold text-[#170a26] transition-opacity hover:opacity-90 disabled:opacity-50"
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

        <aside className="lg:sticky lg:top-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border-light bg-table p-4">
            <QuickSearchWidget />
            <StreamWidget stream={stream} />
            <SeasonStatsWidget />
            <ContributeWidget />
          </div>
        </aside>
      </div>
    </div>
  );
}

export default HomePage;
