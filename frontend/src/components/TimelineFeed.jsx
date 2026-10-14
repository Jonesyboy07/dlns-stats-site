/**
 * The timeline's event feed: what happened, in order, filtered to what the reader is
 * looking at.
 *
 * Every state the rows carry comes from `buildFeedRows` -- this file only decides how
 * a row looks. Clicking a row seeks the clock to it, and clicking a fight header
 * focuses that fight, which is the same gesture the map's fight bands use.
 */

import Badge from "./Badge";
import HeroIcon from "./HeroIcon";
import ItemIcon from "./ItemIcon";
import { FEED_FILTERS, FUTURE_OPACITY } from "../utils/matchTimelineFeed";
import { TEAM_STROKE } from "../utils/matchTimelineMap";
import { clock } from "../utils/matchTimeline";
import { staticImagePathToCdn } from "../utils/cdn";

const BACKGROUNDS = {
  fight: "bg-accent-bg",
  fightFocused: "bg-accent-bg-strong",
  hover: "bg-hover",
  current: "bg-accent-bg-strong",
};

/** The mark in front of a row: a hero portrait, a diamond, an item or a fight chip. */
function RowIcon({ row, heroName }) {
  const teamColor = TEAM_STROKE[row.team] ?? "#94a3b8";

  if (row.kind === "kill") {
    return (
      <span
        className="flex h-[22px] w-[22px] shrink-0 rounded"
        // The killer's side rings the portrait, so a glance down the feed shows who
        // was winning the exchange.
        style={{ boxShadow: `0 0 0 1.5px ${teamColor}` }}
      >
        <HeroIcon name={heroName(row.heroId)} size="h-[22px] w-[22px]" />
      </span>
    );
  }

  if (row.kind === "objective") {
    return (
      <span
        aria-hidden="true"
        className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[1px]"
        style={{ backgroundColor: teamColor }}
      />
    );
  }

  if (row.kind === "item") {
    return (
      <ItemIcon
        icon={row.purchase.icon}
        name={row.purchase.item}
        size="h-5 w-5"
        fallback={staticImagePathToCdn(row.purchase.image || null)}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      className="h-3.5 w-3.5 shrink-0 rounded-[3px] border-[1.5px] border-accent-border-strong bg-accent-bg"
    />
  );
}

/** A fight's second line: when it ran, who won it, and what it led to. */
function fightSubtitle(fight, teamName) {
  return [
    `${clock(fight.startS)}–${clock(fight.endS)}`,
    fight.winner == null ? "even" : `${teamName(fight.winner) || "the winner"} won`,
    fight.objective ? `→ ${fight.objective.label}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
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
        <span className="font-normal text-dim">killed by</span>{" "}
        {row.killerName ? (
          <Name accent={row.killerSelected}>{row.killerName}</Name>
        ) : (
          <span className="font-normal text-dim">an unknown killer</span>
        )}
      </>
    );
  }

  if (row.kind === "objective") {
    const lane = row.objective.laneName;
    return (
      <>
        <Name>{teamName(row.objective.team) || "Someone"}</Name>{" "}
        <span className="font-normal text-dim">destroyed</span>{" "}
        <Name>{row.objective.label ?? "an objective"}</Name>
        {lane ? <span className="font-normal text-dim"> · {lane}</span> : null}
      </>
    );
  }

  if (row.kind === "item") {
    return (
      <>
        <Name accent={row.playerSelected}>{row.playerName ?? "Someone"}</Name>{" "}
        <span className="font-normal text-dim">bought</span>{" "}
        <Name>{row.purchase.item ?? "an item"}</Name>
      </>
    );
  }

  const { fight } = row;
  return (
    <>
      <Name>Team fight</Name> <Name>{fight.score}</Name>
    </>
  );
}

export default function TimelineFeed({
  rows = [],
  filter = "all",
  onFilter = () => {},
  onSeek = null,
  onFocusFight = null,
  onHoverKill = null,
  heroName = () => null,
  teamName = () => null,
  className = "",
}) {
  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-1.5">
        {FEED_FILTERS.map((option) => {
          const active = option.value === filter;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onFilter(option.value)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
                active
                  ? "border-accent-border-strong bg-accent-bg-strong text-accent-light"
                  : "border-border-light bg-badge-bg text-muted hover:text-secondary"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>

      <ol className="scroll-thin h-[590px] overflow-y-auto rounded-xl border border-border-light bg-table">
        {rows.length === 0 ? (
          <li className="px-3 py-4 text-center text-[13px] text-dim">
            Nothing to show for this filter.
          </li>
        ) : (
          rows.map((row) => {
            const clickable = row.kind === "fight" ? Boolean(onFocusFight) : Boolean(onSeek);
            const onClick =
              row.kind === "fight"
                ? () => onFocusFight?.(row.fight)
                : () => onSeek?.(row.timeS);
            return (
              <li
                key={row.key}
                onClick={clickable ? onClick : undefined}
                onMouseEnter={
                  row.kind === "kill" && onHoverKill ? () => onHoverKill(row.killId) : undefined
                }
                onMouseLeave={row.kind === "kill" && onHoverKill ? () => onHoverKill(null) : undefined}
                style={{
                  opacity: row.subdued ? FUTURE_OPACITY : 1,
                  paddingLeft: row.indented ? 22 : 10,
                }}
                className={`grid grid-cols-[40px_24px_1fr] items-center gap-2 border-b border-border py-1.5 pr-2.5 last:border-b-0 ${
                  BACKGROUNDS[row.background] ?? ""
                } ${clickable ? "cursor-pointer" : ""}`}
              >
                <span className="text-right font-valve-oracle text-[12px] tabular-nums text-dim">
                  {clock(row.timeS)}
                </span>
                <span className="flex items-center justify-center">
                  <RowIcon row={row} heroName={heroName} />
                </span>
                <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[13px] font-semibold text-primary">
                  <span className="min-w-0">
                    <RowText row={row} teamName={teamName} />
                  </span>
                  {row.kind === "fight" ? (
                    <span className="text-xs font-normal text-muted">
                      {fightSubtitle(row.fight, teamName)}
                    </span>
                  ) : null}
                  {(row.badges ?? []).map((badge) => (
                    <Badge key={badge.label} tone={badge.tone}>
                      {badge.label}
                    </Badge>
                  ))}
                </span>
              </li>
            );
          })
        )}
      </ol>
    </div>
  );
}
