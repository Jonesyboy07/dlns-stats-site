import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import ErrorMessage from "../ErrorMessage";
import HeroIcon from "../HeroIcon";
import LoadingSkeleton from "../LoadingSkeleton";
import Panel from "./Panel";
import { RESULT_CHIP_CLASS, resultGlyph } from "./resultStyles";
import { formatCompact, formatDuration, formatKda, formatMatchDate } from "../../utils/format";
import { laneMeta, playerLane } from "../../utils/lanes";
import { kda, matchOutcome, nextSort, opponentForMatch } from "../../utils/playerStats";

const DASH = "—";

/** Header and rows share this template so the labels sit over their columns. */
const GRID =
  "grid grid-cols-[128px_minmax(120px,1fr)_76px_84px_52px_60px_52px_92px_76px_52px] items-center gap-3";

/** key === null means the column is not sortable; the header is plain text. */
const COLUMNS = [
  { label: "Hero", key: null, align: "" },
  { label: "Opponent", key: null, align: "" },
  { label: "Result", key: null, align: "" },
  { label: "K / D / A", key: null, align: "" },
  { label: "KDA", key: "kda", align: "justify-end" },
  { label: "Souls", key: "souls", align: "justify-end" },
  { label: "Dur", key: "duration", align: "justify-end" },
  { label: "Date", key: "date", align: "justify-end" },
  { label: "Week", key: null, align: "justify-end" },
  { label: "VOD", key: null, align: "justify-end" },
];
const DEFAULT_SORT = { sort: "date", order: "desc" };

/** Every reachable sort state has a matching option, so the select never lies. */
const SORT_OPTIONS = [
  { value: "date:desc", label: "Newest first" },
  { value: "date:asc", label: "Oldest first" },
  { value: "kda:desc", label: "KDA · high to low" },
  { value: "kda:asc", label: "KDA · low to high" },
  { value: "souls:desc", label: "Souls · high to low" },
  { value: "souls:asc", label: "Souls · low to high" },
  { value: "duration:desc", label: "Length · long to short" },
  { value: "duration:asc", label: "Length · short to long" },
];

const RESULT_FILTERS = [
  { value: "", label: "All" },
  { value: "win", label: "Wins" },
  { value: "loss", label: "Losses" },
];

const SIDE_FILTERS = [
  { value: "", label: "Both" },
  { value: "0", label: "Hidden King" },
  { value: "1", label: "Archmother" },
];

const SIDE_DOT_CLASS = { 0: "bg-team-amber", 1: "bg-team-sapphire" };
/** The league's two sides, as the team pages name them. */
const SIDE_NAME = { 0: "Hidden King", 1: "Archmother" };

/**
 * The native dropdown is painted by the OS, so it needs its own colours — without
 * them the options inherit nothing and land light-on-light on Windows.
 */
const OPTION_CLASS = "bg-table text-secondary";

const playerSide = (match) => (match?.team === 0 || match?.team === 1 ? match.team : null);

function Segmented({ options, value, onChange, label }) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex items-center gap-0.5 rounded-full border border-border bg-table p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          className={`rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
            value === option.value
              ? "bg-accent-secondary-bg-strong text-accent-secondary-light"
              : "text-muted hover:text-secondary"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * P1-4: the player's games, paged and filtered SERVER-SIDE (a 400-game player
 * must not download 400 rows to show 10). Filters, sort and page can live in the
 * URL so a view is shareable, and any filter change resets to page 1.
 *
 * `firstColumn="lane"` swaps the Hero column for the lane, which is what the
 * Player × Hero page wants: every row is the same hero, so the hero column would
 * be a column of identical cells. The hero filter is hidden there too, because it
 * is already locked to the page's hero.
 */
export default function PlayerMatchTable({
  accountId,
  totalGames = null,
  heroId = null,
  heroOptions = [],
  pageSize = 10,
  title = "Matches",
  showFilters = true,
  syncUrl = false,
  firstColumn = "hero",
}) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const lockedHero = heroId == null ? "" : String(heroId);

  const [filters, setFilters] = useState(() => ({
    res: (syncUrl && searchParams.get("res")) || "",
    side: (syncUrl && searchParams.get("side")) || "",
    hero: lockedHero || (syncUrl && searchParams.get("hero")) || "",
    sort: (syncUrl && searchParams.get("sort")) || DEFAULT_SORT.sort,
    order: (syncUrl && searchParams.get("order")) || DEFAULT_SORT.order,
  }));
  const [page, setPage] = useState(() => {
    const fromUrl = syncUrl ? Number(searchParams.get("page")) : 1;
    return Number.isFinite(fromUrl) && fromUrl > 0 ? fromUrl : 1;
  });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams({
      page: String(page),
      per_page: String(pageSize),
      sort: filters.sort,
      order: filters.order,
    });
    if (filters.res) params.set("res", filters.res);
    if (filters.side) params.set("side", filters.side);
    if (filters.hero) params.set("hero", filters.hero);

    setLoading(true);
    fetch(`/db/users/${accountId}/matches/paged?${params.toString()}`)
      .then((response) => {
        if (!response.ok) throw new Error("Could not load matches");
        return response.json();
      })
      .then((json) => {
        if (!alive) return;
        setData(json);
        setError(null);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [accountId, page, pageSize, filters.res, filters.side, filters.hero, filters.sort, filters.order, reloadKey]);

  // A new player means a fresh page — but NOT on the first render, or the
  // `?page=` this table writes to the URL would be discarded on every reload.
  const lastAccount = useRef(accountId);
  useEffect(() => {
    if (lastAccount.current === accountId) return;
    lastAccount.current = accountId;
    setPage(1);
  }, [accountId]);

  useEffect(() => {
    if (!syncUrl) return;
    // Start from the params already in the URL and rewrite only the ones this
    // table owns. The player page keeps its active tab in `?tab=`, so building a
    // fresh URLSearchParams here would wipe it and bounce you back to Overview.
    const OWNED = ["res", "side", "hero", "sort", "order", "page"];
    const next = new URLSearchParams(searchParams);
    OWNED.forEach((key) => next.delete(key));
    if (filters.res) next.set("res", filters.res);
    if (filters.side) next.set("side", filters.side);
    if (!lockedHero && filters.hero) next.set("hero", filters.hero);
    if (filters.sort !== DEFAULT_SORT.sort) next.set("sort", filters.sort);
    if (filters.order !== DEFAULT_SORT.order) next.set("order", filters.order);
    if (page > 1) next.set("page", String(page));
    // Bail out when nothing moved, so this cannot ping-pong with the other
    // writer of the query string.
    if (next.toString() !== searchParams.toString()) {
      setSearchParams(next, { replace: true });
    }
  }, [syncUrl, filters, page, lockedHero, searchParams, setSearchParams]);

  const rows = data?.matches ?? [];
  const total = data?.total ?? 0;
  const totalPages = data?.total_pages ?? 1;
  const isFiltered = Boolean(filters.res || filters.side || filters.hero);
  const heroChoices = useMemo(
    () => heroOptions.filter((hero) => hero.games > 0),
    [heroOptions],
  );

  const patchFilters = (patch) => {
    setFilters((current) => ({ ...current, ...patch }));
    setPage(1); // any filter change starts again at page 1
  };

  const clearFilters = () => patchFilters({ res: "", side: "", hero: lockedHero, ...DEFAULT_SORT });

  /**
   * Highest -> lowest -> back to the default, so a column head always cycles back
   * to the newest-match view instead of trapping you in a sort.
   */
  const cycleSort = (key) => {
    if (!key) return;
    setPage(1);
    const next = nextSort(
      { key: filters.sort, direction: filters.order },
      key,
      { key: DEFAULT_SORT.sort, direction: DEFAULT_SORT.order },
    );
    setFilters((current) => ({ ...current, sort: next.key, order: next.direction }));
  };

  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const countLabel = isFiltered
    ? `${total} of ${totalGames ?? total} games`
    : `${total} game${total === 1 ? "" : "s"}`;
  // Scoped to one hero the Hero column would repeat the page title on every row,
  // so it becomes the lane instead.
  const columns =
    firstColumn === "lane"
      ? [{ label: "Lane", key: null, align: "" }, ...COLUMNS.slice(1)]
      : COLUMNS;

  return (
    <Panel title={title}>
      {/* Keyed on the player's TOTAL games, not the filtered count: a filter that
          narrows the list to one game must not take the filters away with it. */}
      {showFilters && (totalGames ?? total) > 1 && (
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Segmented
            label="Result"
            options={RESULT_FILTERS}
            value={filters.res}
            onChange={(value) => patchFilters({ res: value })}
          />
          <Segmented
            label="Side"
            options={SIDE_FILTERS}
            value={filters.side}
            onChange={(value) => patchFilters({ side: value })}
          />

          {!lockedHero && heroChoices.length > 1 && (
            <span className="flex items-center gap-1 rounded-full border border-border bg-table px-2 py-0.5">
              <select
                aria-label="Hero"
                value={filters.hero}
                onChange={(event) => patchFilters({ hero: event.target.value })}
                className="bg-transparent py-1 text-[12px] text-secondary outline-none"
              >
                <option className={OPTION_CLASS} value="">
                  All heroes
                </option>
                {heroChoices.map((hero) => (
                  <option className={OPTION_CLASS} key={hero.hero_id} value={String(hero.hero_id)}>
                    {hero.hero_name} ({hero.games})
                  </option>
                ))}
              </select>
              {filters.hero && (
                <button
                  type="button"
                  aria-label="Clear hero filter"
                  onClick={() => patchFilters({ hero: "" })}
                  className="text-dim transition-colors hover:text-secondary"
                >
                  ×
                </button>
              )}
            </span>
          )}

          <span className="flex items-center gap-1 rounded-full border border-border bg-table px-3">
            <select
              aria-label="Sort"
              value={`${filters.sort}:${filters.order}`}
              onChange={(event) => {
                const [sort, order] = event.target.value.split(":");
                patchFilters({ sort, order });
              }}
              className="bg-transparent py-1.5 text-[12px] text-secondary outline-none"
            >
              {SORT_OPTIONS.map((option) => (
                <option className={OPTION_CLASS} key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </span>

          <span className="ml-auto text-[12px] tabular-nums text-dim">{countLabel}</span>
        </div>
      )}

      {error ? (
        <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />
      ) : loading && !data ? (
        <LoadingSkeleton variant="table-row" />
      ) : rows.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm text-muted">
            {isFiltered ? "No matches for these filters." : "No matches recorded."}
          </p>
          {isFiltered && (
            <button
              type="button"
              onClick={clearFilters}
              className="rounded-lg border border-border-light bg-input px-4 py-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
        <div className={`scroll-thin overflow-x-auto transition-opacity ${loading ? "opacity-60" : ""}`}>
          <div className="min-w-[900px]">
            <div
              className={`${GRID} border-b border-border-light bg-table px-3 py-2 text-[11px] uppercase tracking-[.05em] text-muted`}
            >
              {columns.map((column, index) => (
                <span key={index} className={`flex items-center gap-1 ${column.align}`}>
                  {column.key ? (
                    <button
                      type="button"
                      onClick={() => cycleSort(column.key)}
                      title={`Sort by ${column.label}`}
                      className={`flex items-center gap-1 uppercase tracking-[.05em] transition-colors ${
                        filters.sort === column.key
                          ? "text-accent-secondary-light"
                          : "hover:text-secondary"
                      }`}
                    >
                      {column.label}
                      {filters.sort === column.key && (
                        <span aria-hidden="true">{filters.order === "desc" ? "▾" : "▴"}</span>
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </span>
              ))}
            </div>

            <div className="divide-y divide-border">
              {rows.map((match) => {
                const outcome = matchOutcome(match);
                const opponent = opponentForMatch(match);
                const side = playerSide(match);
                const date = formatMatchDate(match.start_time || match.created_at);
                const lane = laneMeta(playerLane(match));
                return (
                  <div
                    key={match.match_id}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open match ${match.match_id}`}
                    onClick={() => navigate(`/match/${match.match_id}`)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(`/match/${match.match_id}`);
                      }
                    }}
                    className={`${GRID} min-h-11 cursor-pointer px-3 py-1.5 transition-colors hover:bg-accent-secondary/[0.08]`}
                  >
                    {firstColumn === "lane" ? (
                      <span
                        className="flex min-w-0 items-center gap-2"
                        title={lane ? `${lane.name} lane` : "Lane not recorded"}
                      >
                        {lane ? (
                          <>
                            <span
                              aria-hidden="true"
                              className="h-2 w-2 shrink-0 rounded-[2px]"
                              style={{ background: lane.color }}
                            />
                            <span className="truncate text-[13px] text-secondary">{lane.name}</span>
                          </>
                        ) : (
                          <span className="text-dim">{DASH}</span>
                        )}
                      </span>
                    ) : (
                      <span className="flex min-w-0 items-center gap-2">
                        {/* The art goes to the hero, the name to the match. The whole
                            row opens the match too, so both links stop the click. */}
                        <Link
                          to={`/hero/${match.hero_id}`}
                          title={`${match.hero_name || `Hero ${match.hero_id}`} hero page`}
                          onClick={(event) => event.stopPropagation()}
                          className="shrink-0 rounded transition-opacity hover:opacity-80"
                        >
                          <HeroIcon name={match.hero_name} size="h-[26px] w-[26px]" />
                        </Link>
                        <Link
                          to={`/match/${match.match_id}`}
                          title={`Open match ${match.match_id}`}
                          onClick={(event) => event.stopPropagation()}
                          className="truncate text-[13px] text-secondary transition-colors hover:text-accent-secondary-light"
                        >
                          {match.hero_name || `Hero ${match.hero_id}`}
                        </Link>
                      </span>
                    )}

                    <span className="min-w-0 truncate text-[13px]">
                      {opponent ? (
                        <>
                          <span className="text-dim">vs </span>
                          <Link
                            to={`/team/${encodeURIComponent(opponent)}`}
                            title={`${opponent} team page`}
                            onClick={(event) => event.stopPropagation()}
                            className="text-secondary transition-colors hover:text-accent-secondary-light hover:underline"
                          >
                            {opponent}
                          </Link>
                        </>
                      ) : (
                        <span className="text-dim" title="Unknown opponent">
                          {DASH}
                        </span>
                      )}
                    </span>

                    <span className="flex items-center gap-1.5">
                      <Link
                        to={`/match/${match.match_id}`}
                        title={`Open match ${match.match_id}`}
                        onClick={(event) => event.stopPropagation()}
                        className={`inline-flex min-w-11 justify-center rounded border px-1.5 py-0.5 text-[11px] font-bold ${RESULT_CHIP_CLASS[outcome]}`}
                      >
                        {resultGlyph(outcome, { long: true })}
                      </Link>
                      <span
                        title={side == null ? "Side unknown" : SIDE_NAME[side]}
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                          side == null ? "bg-dim" : SIDE_DOT_CLASS[side]
                        }`}
                      />
                    </span>

                    <span className="text-[13px] tabular-nums text-muted">
                      {match.kills ?? 0} / {match.deaths ?? 0} / {match.assists ?? 0}
                    </span>

                    <span className="text-right text-[13px] tabular-nums text-secondary">
                      {formatKda(kda(match))}
                    </span>
                    <span className="text-right text-[13px] tabular-nums text-secondary">
                      {formatCompact(match.net_worth) ?? DASH}
                    </span>
                    <span className="text-right text-[13px] tabular-nums text-secondary">
                      {formatDuration(match.duration_s) ?? DASH}
                    </span>
                    <span className="text-right text-[13px] tabular-nums text-muted">
                      {date ?? DASH}
                    </span>

                    <span className="text-right text-[12px]">
                      {match.event_week != null ? (
                        <Link
                          to={`/week/${match.event_week}`}
                          title={`Night Shift ${match.event_week}`}
                          onClick={(event) => event.stopPropagation()}
                          className="text-dim transition-colors hover:text-secondary"
                        >
                          NS {match.event_week}
                          {match.event_game ? ` · ${match.event_game.replace(/^game\s*/i, "G")}` : ""}
                        </Link>
                      ) : (
                        <span className="text-dim">Preseason</span>
                      )}
                    </span>

                    <span className="flex justify-end">
                      {match.match_vod ? (
                        <a
                          href={match.match_vod}
                          target="_blank"
                          rel="noreferrer"
                          onClick={(event) => event.stopPropagation()}
                          className="rounded-full border border-accent-secondary-border bg-accent-secondary-bg px-3 py-0.5 text-[11px] font-bold uppercase tracking-wider text-accent-secondary-light transition-colors hover:bg-accent-secondary-bg-strong"
                        >
                          VOD
                        </a>
                      ) : (
                        <span className="text-dim">{DASH}</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>

            {totalPages > 1 && (
              <div className="mt-3 flex items-center justify-between gap-3 text-[12px] text-muted">
                <span className="tabular-nums">
                  Showing {from}–{to} of {total}
                </span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => setPage((current) => Math.max(1, current - 1))}
                    className="rounded-lg border border-border-light bg-input px-3 py-1.5 font-semibold text-secondary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Previous
                  </button>
                  <span className="tabular-nums">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
                    className="rounded-lg border border-border-light bg-input px-3 py-1.5 font-semibold text-secondary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Panel>
  );
}
