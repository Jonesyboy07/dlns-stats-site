import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ContributeWidget from "../components/home/ContributeWidget";
import HomeHero from "../components/home/HomeHero";
import QuickSearchWidget from "../components/home/QuickSearchWidget";
import SeasonStatsWidget from "../components/home/SeasonStatsWidget";
import SeriesWeekGroup from "../components/home/SeriesWeekGroup";
import StreamStatusStrip from "../components/home/StreamStatusStrip";
import StreamWidget from "../components/home/StreamWidget";

/* /db/matches/latest/paged clamps per_page at 20, so a batch is several pages. */
const PER_PAGE = 20;
const PAGES_PER_BATCH = 3;
const WEEKS_PER_BATCH = 3;
const EVENT_TITLE = "Night Shift";

/** "2026-08-01T18:00:00+00:00" -> "1 Aug 2026" (UTC, so everyone agrees). */
function formatWeekDate(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Fetch N consecutive pages of recent Night Shift matches and merge them. */
async function fetchMatchBatch(fromPage, pageCount = PAGES_PER_BATCH) {
  const pages = Array.from({ length: pageCount }, (_, index) => fromPage + index);

  const responses = await Promise.all(
    pages.map(async (page) => {
      const res = await fetch(
        `/db/matches/latest/paged?page=${page}&per_page=${PER_PAGE}&event_title=${encodeURIComponent(EVENT_TITLE)}`,
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
  const [stream, setStream] = useState(null);

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

  /* Stream status is optional — a failure just leaves the strip neutral. */
  useEffect(() => {
    let cancelled = false;

    fetch("/db/stream/status")
      .then((res) => (res.ok ? res.json() : null))
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
  const weekGroups = useMemo(() => {
    const seriesMap = new Map();

    for (const match of matches) {
      const detail = details[String(match.match_id)];
      if (!detail || detail.week == null) continue;

      const key = `${detail.week}_${(detail.team_a || "").toLowerCase()}_${(detail.team_b || "").toLowerCase()}`;

      let entry = seriesMap.get(key);
      if (!entry) {
        entry = {
          week: detail.week,
          series: detail.series,
          series_title: detail.series_title || "",
          team_a: detail.team_a || "TBD",
          team_b: detail.team_b || "TBD",
          wins_a: 0,
          wins_b: 0,
          games: [],
          firstMatchId: match.match_id,
          vod_url: detail.match_vod || "",
          start_time: match.start_time || match.created_at || null,
        };
        seriesMap.set(key, entry);
      }

      entry.games.push({ matchId: match.match_id });
      if (!entry.vod_url && detail.match_vod) entry.vod_url = detail.match_vod;

      const teamASide =
        match.event_team_a_ingame_side != null
          ? match.event_team_a_ingame_side
          : 0;
      if (match.winning_team === teamASide) entry.wins_a += 1;
      else if (match.winning_team != null) entry.wins_b += 1;

      const playedAt = match.start_time || match.created_at;
      if (
        playedAt &&
        (!entry.start_time ||
          new Date(playedAt) < new Date(entry.start_time))
      ) {
        entry.start_time = playedAt;
      }
    }

    const weeks = new Map();
    for (const entry of seriesMap.values()) {
      // Number the games 1, 2, 3… in the order they were played.
      entry.games.sort((a, b) => a.matchId - b.matchId);
      entry.games.forEach((game, index) => {
        game.game = index + 1;
      });

      let group = weeks.get(entry.week);
      if (!group) {
        group = { week: entry.week, entries: [], earliest: null };
        weeks.set(entry.week, group);
      }
      group.entries.push(entry);

      if (
        entry.start_time &&
        (!group.earliest || new Date(entry.start_time) < new Date(group.earliest))
      ) {
        group.earliest = entry.start_time;
      }
    }

    return [...weeks.values()]
      .map((group) => ({
        week: group.week,
        totalSeries: group.entries.length,
        dateLabel: formatWeekDate(group.earliest),
        entries: group.entries.sort((a, b) =>
          a.firstMatchId > b.firstMatchId ? -1 : 1,
        ),
      }))
      .sort((a, b) => Number(b.week) - Number(a.week));
  }, [matches, details]);

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
      <StreamStatusStrip stream={stream} />
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
