import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import WeekSidebar from "../components/week/WeekSidebar";
import BracketCard from "../components/week/BracketCard";
import MobileBracketCard from "../components/week/MobileBracketCard";
import MobileWeekBar from "../components/week/MobileWeekBar";
import MobileWeekLinks from "../components/week/MobileWeekLinks";
import PlayerLeaderboard from "../components/week/PlayerLeaderboard";
import MatchResultsPanel from "../components/week/MatchResultsPanel";
import HeroPicksPanel from "../components/week/HeroPicksPanel";
import { cdnImage } from "../utils/cdn";
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
  /* The whole broadcast's VOD, normalised by the endpoint from whichever shape
     matches.json recorded it in. */
  const streamVod = detail?.stream_vod || null;

  /* What a week links out to besides its bracket: the broadcast, the update its
     games were played under, and any hero who had just arrived. The desktop row
     captions them (14a) while the mobile pair runs them over two lines (16a), so
     the facts themselves are resolved once, here. */
  /* Each item is only offered when it has somewhere to go: an announcement whose
     Steam URL never resolved would otherwise render an anchor with no href, which
     looks like a link and does nothing. */
  const weekFacts = {
    stream: streamVod?.url
      ? {
          href: streamVod.url,
          title: streamVod.title || `Watch the whole ${eventTitle} #${weekNum} broadcast`,
        }
      : null,
    patch: latestUpdate?.url
      ? {
          href: latestUpdate.url,
          title: announcementTitle(latestUpdate, "update"),
          name: newsLabel(latestUpdate),
          note: latestUpdate.during_games ? "released mid-broadcast" : null,
        }
      : null,
    hero: latestHero?.url
      ? {
          href: latestHero.url,
          title: announcementTitle(latestHero, "hero"),
          name: newsLabel(latestHero),
        }
      : null,
  };

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

  /* Both bracket cards take the same selection state; the page picks one by width. */
  const bracketProps = {
    brackets,
    week: weekNum,
    scopeLabel,
    activeRegion: region,
    selectedSeries: selection.selected?.key ?? null,
    onSelectSeries: (key) => patchParams({ series: key }),
    onSelectRegion: (next) => patchParams({ region: next, series: null }),
  };

  return (
    <div className="relative flex w-full max-w-[1200px] flex-col gap-[18px] px-4 pt-5 pb-[104px] md:gap-6 md:px-6 md:py-6 lg:px-10">
      {/* The mobile frame measures its own background — 360px of the same art, no
          glow — so this covers the layers the app puts behind every page. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[620px] bg-base md:hidden"
      >
        <div
          className="h-[360px] w-full bg-cover bg-top bg-no-repeat grayscale opacity-25 [mask-image:linear-gradient(to_bottom,black_0%,black_25%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_0%,black_25%,transparent_100%)]"
          style={{ backgroundImage: `url("${cdnImage("background/background_gothic_jpg.jpeg")}")` }}
        />
      </div>

      <header className="flex flex-col gap-1.5 md:gap-2.5">
        <h1 className="font-valve-pulp text-[34px] leading-[0.95] tracking-[.02em] text-primary md:text-[44px]">
          {eventTitle} <span className="text-accent-light">#{weekNum}</span>
        </h1>
        <p className="text-[13px] text-secondary md:text-[14px]">
          {loading
            ? "Loading…"
            : `${formatLongDate(detail.stats?.first_match_time)} · ${brackets.length} region${
                brackets.length === 1 ? "" : "s"
              } · ${detail.matches?.length ?? 0} games`}
        </p>

        {!loading && <WeekLinks facts={weekFacts} />}
        {!loading && (
          <div className="md:hidden">
            <MobileWeekLinks facts={weekFacts} />
          </div>
        )}
      </header>

      <nav className="scroll-thin -mt-1 -mx-4 flex gap-1 overflow-x-auto border-b border-border-light px-4 md:-mt-1.5 md:mx-0 md:gap-7 md:px-0">
        {PAGE_TABS.map((tab) => {
          const active = pageTab === tab;
          return (
            <button
              key={tab}
              type="button"
              onClick={() => setPageTab(tab)}
              className={`flex min-h-11 items-center px-2.5 font-valve-oracle text-[14px] font-semibold whitespace-nowrap transition-colors md:min-h-0 md:px-0.5 md:pb-3 md:text-[15px] ${
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
        {/* Below 768px the week list moves into the week sheet (13b), so the
            sidebar only exists from the tablet frame up. */}
        <div className="hidden md:block">
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
              setTeamFilter((current) =>
                current.trim().toLowerCase() === team.toLowerCase() ? "" : team,
              )
            }
          />
        </div>

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
                <div className="hidden md:block">
                  <BracketCard {...bracketProps} />
                </div>
                <div className="md:hidden">
                  <MobileBracketCard {...bracketProps} />
                </div>
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

      {/* The mobile frame keeps the week controls in a fixed bar (13b); the
          desktop sidebar is hidden at that width. */}
      <MobileWeekBar
        week={weekNum}
        date={detail.stats?.first_match_time}
        weeks={index?.weeks || []}
        onSelectWeek={openWeek}
        eventOptions={index?.events || []}
        eventTitle={eventTitle}
        onEventChange={(title) => navigate(`/week?${eventQuery(title)}`)}
        teamFilter={teamFilter}
        onTeamFilter={setTeamFilter}
        teamChips={teamChips}
        onChipClick={(team) =>
          setTeamFilter((current) =>
            current.trim().toLowerCase() === team.toLowerCase() ? "" : team,
          )
        }
      />
    </div>
  );
}

/**
 * The tooltip behind a week link: what the announcement was, when it was posted,
 * and — the case worth flagging — whether the night was already underway when it
 * landed, since part of that week's games were then played on the older build.
 */
function announcementTitle(entry, kind) {
  const subject =
    kind === "hero"
      ? "the newest hero before this week"
      : "the newest Deadlock update before this week";
  return (
    `“${entry.title}” was posted ${formatLongDate(entry.published_at)}, ` +
    (entry.during_games
      ? "while this week's games were being played — part of the night played on without it."
      : `${subject}.`)
  );
}

/**
 * WeekLinks — the 14a desktop row: the same facts the mobile pair shows, captioned
 * and separated by hairlines. Desktop only; below 768px MobileWeekLinks takes over.
 */
function WeekLinks({ facts }) {
  const items = [
    facts.stream && {
      key: "stream",
      caption: "Stream",
      value: "Watch the VOD",
      lead: "▶",
      ...facts.stream,
    },
    facts.patch && { key: "patch", caption: "Patch", value: facts.patch.name, ...facts.patch },
    facts.hero && { key: "hero", caption: "New hero", value: facts.hero.name, ...facts.hero },
  ].filter(Boolean);

  if (items.length === 0) return null;

  return (
    <div className="mt-3.5 hidden flex-wrap md:flex">
      {items.map((item, index) => (
        <WeekLink key={item.key} {...item} first={index === 0} />
      ))}
    </div>
  );
}

/**
 * One fact about the week in the 14a header row: a caption over a link out, with a
 * hairline between it and its neighbour. Every link is optional, so the caller
 * passes `first` to drop the divider from whichever one ends up leading the row.
 */
function WeekLink({ caption, value, href, title, lead, note, first }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={title}
      className={`flex flex-col gap-[5px] pr-6 text-primary transition-colors hover:text-accent-light ${
        first ? "pl-0" : "border-l border-border-light pl-6"
      }`}
    >
      <span className="text-[11px] font-semibold tracking-[.12em] text-dim uppercase">
        {caption}
      </span>
      <span className="flex items-center gap-2 font-valve-oracle text-[15px] font-semibold">
        {lead ? (
          <span aria-hidden="true" className="shrink-0 text-accent-light">
            {lead}
          </span>
        ) : null}
        <span className="max-w-[320px] truncate">{value}</span>
        <span aria-hidden="true" className="shrink-0 text-accent-light">
          ↗
        </span>
        {note ? (
          <>
            <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-dim" />
            <span className="shrink-0 text-[12px] font-normal text-accent-light">{note}</span>
          </>
        ) : null}
      </span>
    </a>
  );
}
