import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import HeroCard from "../HeroCard";
import HeroIcon from "../HeroIcon";
import Panel from "./Panel";
import ScoreChip from "./ScoreChip";
import { RESULT_SQUARE_CLASS, resultGlyph } from "./resultStyles";
import { formatInteger, formatKda, formatPercent } from "../../utils/format";
import {
  MIN_HERO_GAMES,
  heroPool,
  kda,
  lastNOn,
  matchOutcome,
  opponentForMatch,
  pickShare,
  poolCallouts,
  sortPool,
  summarise,
} from "../../utils/playerStats";

const DASH = "—";
const RECENT_ON_HERO = 5;

/** One template for the header and every row, so labels sit over their columns. */
const GRID =
  "grid grid-cols-[minmax(150px,1.3fr)_56px_64px_minmax(130px,1fr)_128px_76px_76px_24px] items-center gap-3";

/** key === null means the column is not sortable (the hero name and chevron). */
const COLUMNS = [
  { label: "Hero", key: null, align: "" },
  { label: "Games", key: "games", align: "text-right" },
  { label: "W–L", key: "record", align: "justify-end" },
  { label: "Win rate", key: "winRate", align: "" },
  { label: "Avg KDA", key: "kda", align: "" },
  { label: "Souls/min", key: "soulsPerMin", align: "text-right" },
  { label: "Dmg/min", key: "damagePerMin", align: "text-right" },
  { label: "", key: null, align: "justify-end" },
];

const DEFAULT_SORT = { key: "games", direction: "desc" };

/** The top three heroes get progressively lighter bars; everyone else is one lump. */
const TOP_SEGMENT_CLASS = [
  "bg-accent-secondary",
  "bg-accent-secondary/70",
  "bg-accent-secondary/45",
];

const winRateLabel = (value) => (value == null ? DASH : formatPercent(value * 100));
const perMinuteLabel = (value) => (value == null ? DASH : formatInteger(Math.round(value)));

const percentOf = (share) => formatPercent(share * 100);

/** How concentrated the pool is: top 3 picks vs everyone else. */
function PickShareBar({ share }) {
  const segments = share.top.map((hero, index) => ({
    key: `hero-${hero.hero_id}`,
    label: hero.hero_name,
    games: hero.games,
    share: hero.share,
    className: TOP_SEGMENT_CLASS[index] ?? TOP_SEGMENT_CLASS[TOP_SEGMENT_CLASS.length - 1],
  }));

  if (share.others.games > 0) {
    segments.push({
      key: "others",
      label: `${share.others.count} other${share.others.count === 1 ? "" : "s"}`,
      games: share.others.games,
      share: share.others.share,
      className: "bg-hover",
    });
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex h-2.5 w-full gap-[2px]">
        {segments.map((segment) => (
          <span
            key={segment.key}
            style={{ flexGrow: segment.games }}
            title={`${segment.label} — ${percentOf(segment.share)} of games`}
            className={`h-full rounded-sm ${segment.className}`}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12px]">
        {segments.map((segment) => (
          <span key={segment.key} className="flex items-center gap-1.5">
            <span className={`h-2.5 w-2.5 rounded-sm ${segment.className}`} aria-hidden="true" />
            <span className="text-secondary">{segment.label}</span>
            <span className="tabular-nums text-dim">{percentOf(segment.share)}</span>
          </span>
        ))}
        <span className="ml-auto text-dim">Top 3 = {percentOf(share.topShare)} of games</span>
      </div>
    </div>
  );
}

function Callout({ label, hero, value }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-table px-4 py-3">
      {hero ? (
        <HeroIcon name={hero.hero_name} size="h-[34px] w-[34px]" />
      ) : (
        <span
          aria-hidden="true"
          className="h-[34px] w-[34px] shrink-0 rounded border border-dashed border-border-lighter"
        />
      )}
      <div className="min-w-0">
        <span className="block text-[11px] uppercase tracking-[.05em] text-muted">{label}</span>
        <span className="block truncate text-[13px] font-semibold text-secondary" title={hero?.hero_name}>
          {hero ? hero.hero_name : DASH}
        </span>
      </div>
      <span className="ml-auto shrink-0 font-valve-pulp text-[20px] tabular-nums text-primary">
        {value}
      </span>
    </div>
  );
}

/**
 * P1-3: pick share, best/worst callouts and the sortable hero table. Rows expand
 * in place into the last five games on that hero plus a link to its own page —
 * no nested scroll boxes, the page is the only scroll container.
 */
export default function HeroPool({ matches = [], accountId, playerName, limit = 10 }) {
  const pool = useMemo(() => heroPool(matches), [matches]);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [expandedHero, setExpandedHero] = useState(null);
  const [showAll, setShowAll] = useState(false);

  if (pool.length === 0) {
    return (
      <Panel title="Hero pool">
        <p className="text-sm text-muted">No heroes recorded yet.</p>
      </Panel>
    );
  }

  const share = pickShare(pool, 3);
  const callouts = poolCallouts(pool);
  const sorted = sortPool(pool, sort.key, sort.direction);
  const visible = showAll ? sorted : sorted.slice(0, limit);
  const record = summarise(matches);

  const toggleSort = (key) => {
    if (!key) return;
    setSort((current) =>
      current.key === key
        ? { key, direction: current.direction === "desc" ? "asc" : "desc" }
        : { key, direction: "desc" },
    );
  };

  return (
    <Panel
      title="Hero pool"
      subtitle={`${pool.length} hero${pool.length === 1 ? "" : "es"} across ${record.games} game${
        record.games === 1 ? "" : "s"
      }`}
    >
      <div className="flex flex-col gap-4">
        <PickShareBar share={share} />

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Callout
            label="Most played"
            hero={callouts.mostPlayed}
            value={callouts.mostPlayed ? `${callouts.mostPlayed.games} g` : DASH}
          />
          {callouts.hasRated ? (
            <>
              <Callout
                label={`Best win rate · ${MIN_HERO_GAMES}+ games`}
                hero={callouts.best}
                value={winRateLabel(callouts.best?.winRate)}
              />
              <Callout
                label={`Worst win rate · ${MIN_HERO_GAMES}+ games`}
                hero={callouts.worst}
                value={winRateLabel(callouts.worst?.winRate)}
              />
            </>
          ) : (
            <p className="rounded-lg border border-dashed border-border-lighter px-4 py-3 text-[13px] text-dim sm:col-span-1 lg:col-span-2">
              Not enough games — needs {MIN_HERO_GAMES}+ games on a hero.
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[760px]">
            <div
              className={`${GRID} border-b border-border-light bg-table px-3 py-2 text-[11px] uppercase tracking-[.05em] text-muted`}
            >
              {COLUMNS.map((column, index) => (
                <span key={index} className={`flex items-center gap-1 ${column.align}`}>
                  {column.key ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(column.key)}
                      className={`flex items-center gap-1 uppercase tracking-[.05em] transition-colors ${
                        sort.key === column.key
                          ? "text-accent-secondary-light"
                          : "hover:text-secondary"
                      }`}
                    >
                      {column.label}
                      {sort.key === column.key && (
                        <span aria-hidden="true">{sort.direction === "desc" ? "▾" : "▴"}</span>
                      )}
                    </button>
                  ) : (
                    column.label
                  )}
                </span>
              ))}
            </div>

            <div className="divide-y divide-border">
              {visible.map((hero) => {
                const isOpen = expandedHero === hero.hero_id;
                const rated = hero.decided >= MIN_HERO_GAMES;
                const recent = isOpen ? lastNOn(matches, hero.hero_id, RECENT_ON_HERO) : [];

                return (
                  <div key={hero.hero_id}>
                    <div
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpandedHero(isOpen ? null : hero.hero_id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          setExpandedHero(isOpen ? null : hero.hero_id);
                        }
                      }}
                      className={`${GRID} cursor-pointer px-3 py-2.5 transition-colors hover:bg-accent-secondary/[0.08] ${
                        isOpen ? "bg-table" : ""
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <HeroIcon name={hero.hero_name} size="h-7 w-7" />
                        <Link
                          to={`/hero/${hero.hero_id}`}
                          title={hero.hero_name}
                          onClick={(event) => event.stopPropagation()}
                          className="truncate font-semibold text-accent-secondary-light hover:underline"
                        >
                          {hero.hero_name}
                        </Link>
                      </span>

                      <span className="text-right tabular-nums text-secondary">{hero.games}</span>

                      <span className="flex justify-end">
                        <ScoreChip
                          wins={hero.wins}
                          losses={hero.losses}
                          title={
                            hero.unknown > 0
                              ? `${hero.unknown} game${hero.unknown === 1 ? "" : "s"} with no result`
                              : undefined
                          }
                        />
                      </span>

                      <span className="flex items-center gap-2">
                        <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-table">
                          <span
                            className={`block h-full rounded-full ${rated ? "bg-success" : "bg-dim"}`}
                            style={{ width: `${(hero.winRate ?? 0) * 100}%` }}
                          />
                        </span>
                        <span
                          className={`tabular-nums ${rated ? "text-secondary" : "italic text-dim"}`}
                        >
                          {winRateLabel(hero.winRate)}
                        </span>
                      </span>

                      <span className="flex items-baseline gap-1.5">
                        <span className="font-semibold tabular-nums text-primary">
                          {formatKda(hero.kda)}
                        </span>
                        <span className="text-[11px] tabular-nums text-dim">
                          {hero.killsPerGame?.toFixed(1)} / {hero.deathsPerGame?.toFixed(1)} /{" "}
                          {hero.assistsPerGame?.toFixed(1)}
                        </span>
                      </span>

                      <span className="text-right tabular-nums text-secondary">
                        {perMinuteLabel(hero.soulsPerMin)}
                      </span>
                      <span className="text-right tabular-nums text-secondary">
                        {perMinuteLabel(hero.damagePerMin)}
                      </span>

                      <span className="flex justify-end text-dim" aria-hidden="true">
                        {isOpen ? "▴" : "▾"}
                      </span>
                    </div>

                    {isOpen && (
                      <div className="mt-1 rounded-lg bg-table px-4 py-3.5">
                        <div className="flex gap-5">
                          <HeroCard name={hero.hero_name} />
                          <div className="min-w-0 flex-1">
                            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                              <span className="text-[11px] uppercase tracking-[.05em] text-muted">
                                Last {recent.length} on {hero.hero_name}
                              </span>
                              <Link
                                to={`/player/${accountId}/hero/${hero.hero_id}`}
                                className="text-[12px] font-semibold text-accent-secondary-light hover:underline"
                              >
                                Open {hero.hero_name}
                                {playerName ? ` × ${playerName}` : ""} →
                              </Link>
                            </div>

                            {recent.length === 0 ? (
                              <p className="text-[13px] text-dim">No games on this hero.</p>
                            ) : (
                              <ul className="divide-y divide-border">
                                {recent.map((match) => {
                                  const outcome = matchOutcome(match);
                                  const opponent = opponentForMatch(match);
                                  return (
                                    <li
                                      key={match.match_id}
                                      className="flex items-center gap-3 py-1.5 text-[13px]"
                                    >
                                      <span
                                        title={outcome === "U" ? "No result" : outcome === "W" ? "Win" : "Loss"}
                                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold ${RESULT_SQUARE_CLASS[outcome]}`}
                                      >
                                        {resultGlyph(outcome)}
                                      </span>
                                      <span
                                        className="min-w-0 flex-1 truncate text-secondary"
                                        title={opponent || "Unknown opponent"}
                                      >
                                        {opponent ? `vs ${opponent}` : "vs —"}
                                      </span>
                                      <span className="shrink-0 tabular-nums text-muted">
                                        {match.kills || 0}/{match.deaths || 0}/{match.assists || 0}
                                      </span>
                                      <span className="w-12 shrink-0 text-right tabular-nums text-secondary">
                                        {formatKda(kda(match))}
                                      </span>
                                      <span className="w-32 shrink-0 text-right">
                                        {match.event_week != null ? (
                                          <Link
                                            to={`/week/${match.event_week}`}
                                            className="text-dim transition-colors hover:text-secondary"
                                          >
                                            NS {match.event_week}
                                            {match.event_game ? ` · ${match.event_game}` : ""}
                                          </Link>
                                        ) : (
                                          <span className="text-dim">Preseason</span>
                                        )}
                                      </span>
                                    </li>
                                  );
                                })}
                              </ul>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {pool.length > limit && (
          <div>
            <button
              type="button"
              onClick={() => setShowAll((value) => !value)}
              className="rounded-lg border border-border-light bg-input px-4 py-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover"
            >
              {showAll ? "Show fewer" : `Show all ${pool.length} heroes`}
            </button>
          </div>
        )}
      </div>
    </Panel>
  );
}
