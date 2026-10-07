import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import WeekSidebar from "../components/week/WeekSidebar";
import BracketCard from "../components/week/BracketCard";
import PlayerLeaderboard from "../components/week/PlayerLeaderboard";
import MatchResultsPanel from "../components/week/MatchResultsPanel";
import HeroPicksPanel from "../components/week/HeroPicksPanel";
import {
  LEADERBOARD_PREVIEW,
  WEEK_STATS,
  buildBrackets,
  buildHeroPicks,
  buildLeaderboard,
  buildSeries,
  formatLongDate,
  newsLabel,
  scopeGames,
  scopeSeries,
  summarizeIndexWeek,
} from "../utils/weekData";

const DEFAULT_EVENT = "Night Shift";
const PAGE_TABS = ["o", "2", "3", "4"];
const TAB_LABELS = { o: "Overview", 2: "Tab 2", 3: "Tab 3", 4: "Tab 4" };

/**
 * WeekPage — the merged Night Shift week page (design 13a).
 *
 * The week list that used to live at `/week` is now the sticky sidebar of the
 * week detail, `/week` resolves to the newest week, and `/week/:n` keeps the
 * region and series selection in the URL so links can be shared.
 */
export default function WeekPage() {
  const { week } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const weekNum = week != null ? Number.parseInt(week, 10) : null;
  const eventTitle = (searchParams.get("event_title") || "").trim() || DEFAULT_EVENT;
  const region = (searchParams.get("region") || "").toLowerCase() || "all";
  const seriesKey = searchParams.get("series") || null;

  const [index, setIndex] = useState(null);
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [pageTab, setPageTab] = useState("o");
  const [statKey, setStatKey] = useState(WEEK_STATS[0].key);
  const [pbMode, setPbMode] = useState("all");
  const [teamFilter, setTeamFilter] = useState("");
  const [expanded, setExpanded] = useState(false);

  const eventQuery = useCallback(
    (title) => `event_title=${encodeURIComponent(title)}`,
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetch(`/db/nightshift/index?${eventQuery(eventTitle)}`)
      .then((response) => {
        if (!response.ok) throw new Error("Failed to load the Night Shift week index");
        return response.json();
      })
      .then((payload) => {
        if (cancelled) return;
        setIndex({
          event: eventTitle,
          weeks: (payload.weeks || []).map(summarizeIndexWeek).reverse(),
          events: payload.available_event_titles || [],
        });
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      });
    return () => {
      cancelled = true;
    };
  }, [eventTitle, eventQuery, reloadToken]);

  useEffect(() => {
    if (weekNum == null || Number.isNaN(weekNum)) return undefined;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/db/nightshift/${weekNum}?${eventQuery(eventTitle)}`)
      .then((response) => {
        if (!response.ok) throw new Error(`Night Shift week ${weekNum} could not be loaded`);
        return response.json();
      })
      .then((payload) => {
        if (!cancelled) setDetail(payload);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [weekNum, eventTitle, eventQuery, reloadToken]);

  /* `/week` on its own has no week to show: fall through to the newest one. The
     index must belong to the current event, or an event switch would bounce back
     to the previous event's newest week. */
  const latestWeek = index && index.event === eventTitle ? (index.weeks[0]?.week ?? null) : null;
  useEffect(() => {
    if (weekNum != null || latestWeek == null) return;
    navigate(`/week/${latestWeek}?${eventQuery(eventTitle)}`, { replace: true });
  }, [weekNum, latestWeek, eventTitle, eventQuery, navigate]);

  /* `brackets` is the authored structure from `data/brackets.json` (served with
     the week) and `seriesList` is the raw match grouping the sidebar and the
     team chips use. Scoping runs off the bracket series so the panels, the
     cards and the URL all agree on what a series is. */
  const seriesList = useMemo(() => buildSeries(detail?.matches || []), [detail]);
  const brackets = useMemo(
    () => buildBrackets(detail?.matches || [], detail?.brackets),
    [detail],
  );
  const bracketSeries = useMemo(() => brackets.flatMap((bracket) => bracket.series), [brackets]);
  const selection = useMemo(
    () => scopeSeries(bracketSeries, seriesKey, region),
    [bracketSeries, seriesKey, region],
  );
  const games = useMemo(() => scopeGames(selection.series), [selection]);

  const scopedKeys = useMemo(
    () => new Set(selection.series.map((series) => series.key)),
    [selection],
  );
  const scopedBrackets = useMemo(
    () =>
      brackets
        .map((bracket) => ({
          ...bracket,
          series: bracket.series.filter((series) => scopedKeys.has(series.key)),
        }))
        .filter((bracket) => bracket.series.length > 0),
    [brackets, scopedKeys],
  );

  const leaderboard = useMemo(() => buildLeaderboard(games, statKey), [games, statKey]);
  const picks = useMemo(() => buildHeroPicks(games, pbMode), [games, pbMode]);

  /* The Steam announcements this week's games came after, from the endpoint. The
     week links out to Steam instead of showing build numbers, which mean nothing
     to a reader. A game update stays relevant however old it is; a hero reveal is
     only shown while it is recent, which the endpoint already enforces. */
  const latestUpdate = detail?.latest_update || null;
  const latestHero = detail?.latest_hero || null;

  const patchParams = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === "" || value === "all") next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const openWeek = useCallback(
    (next) => {
      setExpanded(false);
      navigate(`/week/${next}?${eventQuery(eventTitle)}`);
    },
    [navigate, eventTitle, eventQuery],
  );

  if (error) {
    return <ErrorMessage message={error} onRetry={() => setReloadToken((token) => token + 1)} />;
  }
  if (week != null && Number.isNaN(weekNum)) {
    return <ErrorMessage message={`“${week}” is not a Night Shift week number`} />;
  }
  if (weekNum == null || !detail) {
    return <LoadingSkeleton variant="detail" />;
  }

  const teamChips = [...new Set(seriesList.flatMap((series) => series.teams))].slice(0, 6);
  const visibleRows = expanded
    ? leaderboard.rows
    : leaderboard.rows.slice(0, LEADERBOARD_PREVIEW);
  const statLabel = leaderboard.stat.label.toLowerCase();
  const picksMode = picks.anyBans ? pbMode : "picks";
  const picksVerb =
    picksMode === "bans"
      ? "Times banned"
      : picksMode === "picks"
        ? "Times picked"
        : "Times picked or banned";
  const gameLabel = `${games.length} game${games.length === 1 ? "" : "s"}`;
  const scopeLabel = selection.selected
    ? selection.scopeLabel
    : `Week #${weekNum} · ${selection.scopeLabel}`;
  const url = `${window.location.pathname}${window.location.search}`;

  return (
    <div className="flex w-full max-w-[1200px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex flex-col gap-2.5">
          <h1 className="font-valve-pulp text-[36px] leading-[0.95] tracking-[.02em] text-primary sm:text-[44px]">
            {eventTitle} <span className="text-accent-light">#{weekNum}</span>
          </h1>
          <p className="text-[14px] text-secondary">
            {loading
              ? "Loading…"
              : `${formatLongDate(detail.stats?.first_match_time)} · ${brackets.length} region${
                  brackets.length === 1 ? "" : "s"
                } · ${detail.matches?.length ?? 0} games`}
          </p>
        </div>

        {!loading && (latestUpdate || latestHero) && (
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            {latestUpdate && <NewsChip entry={latestUpdate} />}
            {latestHero && <NewsChip entry={latestHero} prefix="New hero" />}
            {latestUpdate?.during_games && (
              <span className="text-[12px] text-muted">released mid-broadcast</span>
            )}
          </div>
        )}
      </header>

      <nav className="scroll-thin -mt-1.5 flex gap-7 overflow-x-auto border-b border-border-light">
        {PAGE_TABS.map((tab) => {
          const active = pageTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setPageTab(tab)}
              className={`px-0.5 pb-3 font-valve-oracle text-[15px] font-semibold whitespace-nowrap transition-colors ${
                active
                  ? "text-primary shadow-[inset_0_-2px_0_var(--color-accent)]"
                  : "text-muted hover:text-secondary"
              }`}
            >
              {TAB_LABELS[tab]}
            </button>
          );
        })}
      </nav>

      <div className="grid items-start gap-6 lg:grid-cols-[250px_minmax(0,1fr)]">
        <WeekSidebar
          weeks={index?.weeks || []}
          selectedWeek={weekNum}
          onSelectWeek={openWeek}
          eventOptions={index?.events || []}
          eventTitle={eventTitle}
          onEventChange={(title) => navigate(`/week?${eventQuery(title)}`)}
          teamFilter={teamFilter}
          onTeamFilter={setTeamFilter}
          teamChips={teamChips}
          onChipClick={(team) =>
            setTeamFilter((current) => (current.trim().toLowerCase() === team.toLowerCase() ? "" : team))
          }
        />

        <main className="flex min-w-0 flex-col gap-5">
          {loading ? (
            <LoadingSkeleton variant="detail" />
          ) : pageTab === "o" ? (
            brackets.length === 0 ? (
              <section className="rounded-xl border border-border-light bg-card px-5 py-16 text-center shadow">
                <p className="font-valve-oracle text-[18px] text-primary">
                  No matches recorded yet
                </p>
                <p className="mt-1.5 text-[13px] text-muted">
                  {eventTitle} #{weekNum} has no processed games.
                </p>
              </section>
            ) : (
              <>
                <BracketCard
                  brackets={brackets}
                  scopeLabel={scopeLabel}
                  activeRegion={region}
                  selectedSeries={selection.selected?.key ?? null}
                  onSelectSeries={(key) => patchParams({ series: key })}
                  onSelectRegion={(next) => patchParams({ region: next, series: null })}
                />
                <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                  <PlayerLeaderboard
                    statKey={statKey}
                    onStatChange={(key) => {
                      setStatKey(key);
                      setExpanded(false);
                    }}
                    subline={`Best single-game ${statLabel}, ${scopeLabel}`}
                    rows={visibleRows}
                    total={leaderboard.total}
                    expanded={expanded}
                    onToggle={() => setExpanded((value) => !value)}
                  />
                  <MatchResultsPanel
                    brackets={scopedBrackets}
                    subline={`${gameLabel} · ${scopeLabel}`}
                  />
                </div>
                <HeroPicksPanel
                  mode={picksMode}
                  onModeChange={setPbMode}
                  board={picks.board}
                  anyBans={picks.anyBans}
                  subline={`${picksVerb} across ${picks.totalGames} game${
                    picks.totalGames === 1 ? "" : "s"
                  } · ${scopeLabel}`}
                />
              </>
            )
          ) : (
            <section className="flex min-h-[520px] flex-col items-center justify-center gap-1.5 rounded-xl border border-border-light bg-card p-6 text-center shadow">
              <span className="font-valve-oracle text-[18px] text-primary">
                {TAB_LABELS[pageTab]}
              </span>
              <span className="text-[13px] text-muted">
                Placeholder. Saved for a future feature.
              </span>
            </section>
          )}
        </main>
      </div>
    </div>
  );
}

/**
 * One Steam announcement as a chip: the game update a week was played under, or a
 * hero who had recently arrived. Amber when it landed while games were being
 * played, since that is when it explains a shift in the night's stats.
 */
function NewsChip({ entry, prefix }) {
  const posted = formatLongDate(entry.published_at);
  const subject = prefix ? "the newest hero before this week" : "the newest Deadlock update before this week";
  return (
    <a
      href={entry.url}
      target="_blank"
      rel="noopener noreferrer"
      title={
        `“${entry.title}” was posted ${posted}, ` +
        (entry.during_games
          ? "while this week's games were being played — part of the night played on without it."
          : `${subject}.`)
      }
      className={`flex min-w-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors ${
        entry.during_games
          ? "border-accent-border-strong bg-accent-bg-strong text-accent-light hover:bg-accent-bg"
          : "border-border-light bg-panel text-secondary hover:bg-hover"
      }`}
    >
      {prefix && <span className="shrink-0 font-normal text-dim">{prefix} ·</span>}
      <span className="max-w-[280px] truncate">{newsLabel(entry)}</span>
      <span className="shrink-0 text-accent-light">↗</span>
    </a>
  );
}
