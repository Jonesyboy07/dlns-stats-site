/**
 * The timeline's event feed: what has happened so far, in order, filtered to what the
 * reader is looking at.
 *
 * Every state the rows carry comes from `buildFeedRows` -- this file only decides how
 * a row looks. Rows are buttons: a kill, objective or item seeks the clock to it, a
 * fight card focuses that fight (the same gesture as the lanes' fight bands), and a
 * quiet stretch expands or collapses.
 *
 * Layout follows the Timeline v3 handoff: a 42px tab strip with glyphs and live counts
 * attached to the top of a recessed list; rows on a `40px 24px 1fr` grid; fight cards
 * inset in the list; quiet stretches folded into one row.
 */

import { useEffect, useRef } from "react";
import Badge from "./Badge";
import HeroIcon from "./HeroIcon";
import ItemIcon from "./ItemIcon";
import { FEED_FILTERS, quietSummary } from "../utils/matchTimelineFeed";
import { TEAM_STROKE, TEAM_TEXT } from "../utils/matchTimelineMap";
import { clock } from "../utils/matchTimeline";
import { staticImagePathToCdn } from "../utils/cdn";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary-light";
/** Inside the tab strip the ring is inset, so it is not clipped by the panel edge. */
const FOCUS_RING_INSET =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent-secondary-light";

const LABEL = "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted";

/** Within this many px of the bottom, the list counts as "following" the playhead. */
const FOLLOW_SLACK_PX = 48;

/**
 * Auto-follow: while the reader is at the bottom of the list, keep the current row in
 * view as playback adds rows below it. Scrolling up stops following; scrolling back to
 * the bottom resumes it. Only the list scrolls -- never the page.
 */
function useAutoFollow(listRef, currentKey) {
  const following = useRef(true);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return undefined;
    const onScroll = () => {
      following.current = list.scrollHeight - list.scrollTop - list.clientHeight <= FOLLOW_SLACK_PX;
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    return () => list.removeEventListener("scroll", onScroll);
  }, [listRef]);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !currentKey || !following.current) return;
    const row = list.querySelector('[aria-current="true"]');
    if (!row) return;
    const rowBottom = row.offsetTop + row.offsetHeight;
    if (rowBottom > list.scrollTop + list.clientHeight || row.offsetTop < list.scrollTop) {
      list.scrollTop = Math.max(0, rowBottom - list.clientHeight);
    }
    following.current = true;
  }, [listRef, currentKey]);
}

/** The current row's 2px accent bar, drawn inside the row so it does not shift layout. */
const CURRENT_BAR = { boxShadow: "inset 2px 0 0 var(--color-accent)" };

/** The small shape each tab and row kind is marked with. */
function Glyph({ shape, className = "" }) {
  if (!shape) return null;
  const base = `inline-block h-2 w-2 shrink-0 ${className}`;
  if (shape === "circle") return <span aria-hidden="true" className={`${base} rounded-full bg-current`} />;
  if (shape === "diamond") return <span aria-hidden="true" className={`${base} rotate-45 rounded-[1px] bg-current`} />;
  if (shape === "square") return <span aria-hidden="true" className={`${base} rounded-[1px] border-[1.5px] border-current`} />;
  return <span aria-hidden="true" className={`${base} rounded-[3px] bg-current`} />;
}

function FeedTabs({ filter, counts, onFilter }) {
  return (
    <div
      role="tablist"
      aria-label="Event filter"
      className="flex h-[42px] items-stretch overflow-x-auto border-b border-border bg-card"
    >
      {FEED_FILTERS.map((option) => {
        const active = option.value === filter;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onFilter(option.value)}
            className={`flex shrink-0 items-center gap-1.5 px-3 font-valve-oracle text-[13px] font-semibold transition-colors ${FOCUS_RING_INSET} ${
              active ? "text-primary" : "text-muted hover:text-secondary"
            }`}
            style={active ? { boxShadow: "inset 0 -2px 0 var(--color-accent)" } : undefined}
          >
            <Glyph shape={option.glyph} className={active ? "text-accent-light" : ""} />
            {option.label}
            <span
              className={`rounded-full px-1.5 text-[10px] font-bold tabular-nums leading-4 ${
                active ? "bg-accent-bg-strong text-accent-light" : "bg-table text-muted"
              }`}
            >
              {counts?.[option.value] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** The mark in front of a row: a hero portrait, a diamond or an item. */
function RowIcon({ row, heroName }) {
  const teamColor = TEAM_STROKE[row.team] ?? "#94a3b8";

  if (row.kind === "kill") {
    return (
      <span
        className="flex h-[22px] w-[22px] shrink-0 overflow-hidden rounded-full"
        // The killer's side rings the portrait, so a glance down the feed shows who
        // was winning the exchange.
        style={{ boxShadow: `0 0 0 1.5px ${teamColor}` }}
      >
        <HeroIcon name={heroName(row.heroId)} size="h-[22px] w-[22px]" alt="" />
      </span>
    );
  }

  if (row.kind === "objective") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[1px]"
        style={{ backgroundColor: TEAM_STROKE[row.objective?.team] ?? "#94a3b8" }}
      />
    );
  }

  return (
    <ItemIcon
      icon={row.purchase.icon}
      name={row.purchase.item}
      itemId={row.purchase.itemId}
      size="h-5 w-5"
      fallback={staticImagePathToCdn(row.purchase.image || null)}
    />
  );
}

/** A name, lifted out of the body colour when it is one of the highlighted players. */
function Name({ children, accent = false }) {
  return (
    <span className={`font-semibold ${accent ? "text-accent-light" : "text-primary"}`}>
      {children}
    </span>
  );
}

function RowText({ row, teamName }) {
  if (row.kind === "kill") {
    return (
      <>
        <Name accent={row.victimSelected}>{row.victimName ?? "Unknown"}</Name>{" "}
        <span className="font-normal text-muted">killed by</span>{" "}
        {row.killerName ? (
          <Name accent={row.killerSelected}>{row.killerName}</Name>
        ) : (
          <span className="font-normal text-muted">an unknown killer</span>
        )}
      </>
    );
  }

  if (row.kind === "objective") {
    const lane = row.objective.laneName;
    return (
      <>
        <Name>{teamName(row.objective.team) || "Someone"}</Name>{" "}
        <span className="font-normal text-muted">destroyed</span>{" "}
        <Name>{row.objective.label ?? "an objective"}</Name>
        {lane ? <span className="font-normal text-muted"> · {lane}</span> : null}
      </>
    );
  }

  return (
    <>
      <Name accent={row.playerSelected}>{row.playerName ?? "Someone"}</Name>{" "}
      <span className="font-normal text-muted">bought</span>{" "}
      <Name>{row.purchase.item ?? "an item"}</Name>
    </>
  );
}

/** A kill, objective or item: one clickable line that seeks the clock to it. */
function EventRow({ row, heroName, teamName, onSeek, onHoverKill }) {
  const hoverable = row.kind === "kill" && onHoverKill;
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        onClick={onSeek ? () => onSeek(row.timeS) : undefined}
        onMouseEnter={hoverable ? () => onHoverKill(row.killId) : undefined}
        onMouseLeave={hoverable ? () => onHoverKill(null) : undefined}
        onFocus={hoverable ? () => onHoverKill(row.killId) : undefined}
        onBlur={hoverable ? () => onHoverKill(null) : undefined}
        aria-current={row.current ? "true" : undefined}
        style={{ paddingLeft: row.indented ? 22 : 10, ...(row.current ? CURRENT_BAR : null) }}
        className={`grid w-full grid-cols-[40px_24px_1fr] items-center gap-2 py-[7px] pr-2.5 text-left transition-colors ${FOCUS_RING} ${
          row.hovered ? "bg-hover" : row.current ? "bg-accent-bg-strong hover:bg-hover" : "hover:bg-hover"
        }`}
      >
        <span className="text-right text-[11px] font-bold tabular-nums text-muted">{clock(row.timeS)}</span>
        <span className="flex items-center justify-center">
          <RowIcon row={row} heroName={heroName} />
        </span>
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-primary">
          <span className="min-w-0">
            <RowText row={row} teamName={teamName} />
          </span>
          {(row.badges ?? []).map((badge) => (
            <Badge key={badge.label} tone={badge.tone}>
              {badge.label}
            </Badge>
          ))}
        </span>
      </button>
    </li>
  );
}

/** One of the fight card's three stat columns. */
function FightStat({ label, children, title }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5" title={title}>
      <span className={LABEL}>{label}</span>
      <span className="truncate text-[12px] text-secondary">{children}</span>
    </div>
  );
}

/** "Hidden King took Walker", naming whoever took the follow-up objective. */
function followUpText(objective, teamName) {
  const label = objective.label ?? "an objective";
  const taker = objective.team === 0 || objective.team === 1 ? teamName(objective.team) : null;
  return taker ? `${taker} took ${label}` : label;
}

/**
 * A team fight, inset in the list as a card. Clicking it focuses the fight. While the
 * fight is still running (header revealed, last kill not yet) it reads "In progress"
 * and its stats wait for the end.
 *
 * Souls gained and top damage are not recorded per fight yet: the stats snapshots are
 * minutes apart. Their columns hold the layout and read "—" until that data exists.
 */
function FightCard({ row, heroName, teamName, onFocusFight, onHoverFight }) {
  const { fight, inProgress, score, winner, followUp, focused, hovered, current } = row;
  const strong = hovered || focused;
  const dead = (fight.deadS ?? [0, 0])
    .map((seconds, team) => ({ seconds, team }))
    .filter((entry) => entry.seconds > 0);
  const top = fight.topKiller;

  const result = inProgress ? (
    <span className="font-semibold text-accent-light">In progress</span>
  ) : winner == null ? (
    <span className="font-semibold text-muted">Even</span>
  ) : (
    <span className="font-semibold" style={{ color: TEAM_TEXT[winner] }}>
      {teamName(winner)} won
    </span>
  );

  return (
    <li className="border-b border-border px-2 py-1.5 last:border-b-0">
      <button
        type="button"
        onClick={onFocusFight ? () => onFocusFight(fight) : undefined}
        onMouseEnter={onHoverFight ? () => onHoverFight(fight.index) : undefined}
        onMouseLeave={onHoverFight ? () => onHoverFight(null) : undefined}
        onFocus={onHoverFight ? () => onHoverFight(fight.index) : undefined}
        onBlur={onHoverFight ? () => onHoverFight(null) : undefined}
        aria-current={current ? "true" : undefined}
        className={`flex w-full flex-col gap-2 rounded-lg border bg-accent-bg px-3 py-2.5 text-left transition-colors ${FOCUS_RING} ${
          strong ? "border-accent-border-strong" : "border-accent-border hover:border-accent-border-strong"
        }`}
        style={current ? CURRENT_BAR : undefined}
      >
        <span className="flex w-full flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
          <Glyph shape="square" className="text-accent-light" />
          <span className="text-[11px] font-bold tabular-nums text-muted">
            {clock(fight.startS)}–{inProgress ? "now" : clock(fight.endS)}
          </span>
          <span className="font-semibold text-primary">Team fight</span>
          <span className="font-bold tabular-nums text-accent-light">{score}</span>
          {result}
          <span className="ml-auto text-[12px] font-semibold text-accent-secondary-light">
            {focused ? "Focused" : "Focus →"}
          </span>
        </span>

        <span className="grid w-full grid-cols-3 gap-3 border-t border-accent-border pt-2">
          <FightStat label="Souls gained" title="Souls per fight are not recorded yet">
            —
          </FightStat>
          <FightStat label="Then">
            {!inProgress && followUp ? followUpText(followUp, teamName) : "—"}
          </FightStat>
          <FightStat label="Top damage" title="Damage per fight is not recorded yet">
            —
          </FightStat>
        </span>

        {/* What the death events do record exactly: the respawn time each side sat
            through and the fight's standout killer. */}
        {!inProgress && (dead.length > 0 || top) ? (
          <span className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            {dead.length > 0 && (
              <span title="Total respawn time each side sat through from this fight">
                Dead time{" "}
                {dead.map((entry, i) => (
                  <span key={entry.team}>
                    {i > 0 ? " · " : ""}
                    <span className="font-semibold" style={{ color: TEAM_TEXT[entry.team] }}>
                      {teamName(entry.team)}
                    </span>{" "}
                    <span className="tabular-nums text-danger-text">{entry.seconds}s</span>
                  </span>
                ))}
              </span>
            )}
            {top && (
              <span className="flex items-center gap-1" title="Most kills in this fight">
                Top killer
                <HeroIcon name={heroName(top.heroId)} size="h-4 w-4" alt="" />
                <span className="font-semibold" style={{ color: TEAM_TEXT[top.team] ?? undefined }}>
                  {top.name ?? "Unknown"}
                </span>
                <span className="tabular-nums">×{top.kills}</span>
              </span>
            )}
          </span>
        ) : null}
      </button>
    </li>
  );
}

/** A folded run of unremarkable rows; clicking expands or collapses it. */
function QuietRow({ row, onToggle }) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button
        type="button"
        aria-expanded={row.expanded}
        onClick={() => onToggle?.(row.key)}
        aria-current={row.current ? "true" : undefined}
        style={row.current ? CURRENT_BAR : undefined}
        className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] transition-colors ${FOCUS_RING} ${
          row.current ? "bg-accent-bg-strong" : row.hovered ? "bg-hover" : "bg-white/[0.02] hover:bg-hover"
        }`}
      >
        <span aria-hidden="true" className="w-3 text-muted">
          {row.expanded ? "▾" : "▸"}
        </span>
        <span className="font-semibold text-secondary">Quiet stretch</span>
        <span className="font-bold tabular-nums text-muted">
          {clock(row.startS)}–{clock(row.endS)}
        </span>
        <span className="text-muted">{quietSummary(row)}</span>
        <span className="ml-auto font-semibold text-accent-secondary-light">
          {row.expanded ? "Collapse" : "Expand"}
        </span>
      </button>
    </li>
  );
}

export default function TimelineFeed({
  rows = [],
  counts = null,
  t = 0,
  filter = "all",
  onFilter = () => {},
  onSeek = null,
  onFocusFight = null,
  onHoverKill = null,
  onHoverFight = null,
  onToggleQuiet = null,
  heroName = () => null,
  teamName = () => null,
  className = "",
}) {
  const listRef = useRef(null);
  useAutoFollow(listRef, rows.find((row) => row.current)?.key ?? null);

  return (
    <div className={`flex flex-col overflow-hidden rounded-lg border border-border-light bg-table ${className}`}>
      <FeedTabs filter={filter} counts={counts} onFilter={onFilter} />

      {/* At 0:00 nothing has happened yet, so the list is simply empty. `relative` makes
          the list the rows' offset parent, which auto-follow measures against. */}
      <ol ref={listRef} className="scroll-thin relative h-[548px] overflow-y-auto" aria-label="Match events">
        {rows.length === 0
          ? (t ?? 0) > 0 && (
              <li className="px-3 py-4 text-center text-[13px] text-muted">
                Nothing for this filter yet.
              </li>
            )
          : rows.map((row) => {
              if (row.kind === "fight") {
                return (
                  <FightCard
                    key={row.key}
                    row={row}
                    heroName={heroName}
                    teamName={teamName}
                    onFocusFight={onFocusFight}
                    onHoverFight={onHoverFight}
                  />
                );
              }
              if (row.kind === "quiet") {
                return <QuietRow key={row.key} row={row} onToggle={onToggleQuiet} />;
              }
              return (
                <EventRow
                  key={row.key}
                  row={row}
                  heroName={heroName}
                  teamName={teamName}
                  onSeek={onSeek}
                  onHoverKill={onHoverKill}
                />
              );
            })}
      </ol>
    </div>
  );
}
