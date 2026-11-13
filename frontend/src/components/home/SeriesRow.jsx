import React from "react";
import { Link } from "react-router-dom";
import Spoiler from "../../spoilers/Spoiler";
import { useSpoilerState } from "../../spoilers/spoilerStore";

const FOCUS_RING =
  "rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-secondary-light";

/**
 * N/A and forfeit games are filed under negative placeholder IDs, which the match
 * routes cannot serve, so a series whose first game is one of those links to its
 * week instead of a page that would 404.
 */
function matchPath(matchId) {
  const id = Number(matchId);
  return Number.isFinite(id) && id > 0 ? `/match/${id}` : null;
}

/**
 * SeriesRow — one series line inside a week group: format badge, stage label,
 * both teams, the score, one pill per game and a link into the series (game 1).
 *
 * Props:
 *   entry – series group built by HomePage from /db/weeks + /db/matches.
 */
export default function SeriesRow({ entry }) {
  const maxWins = Math.max(entry.wins_a, entry.wins_b);
  const totalGames = maxWins > 1 ? maxWins * 2 - 1 : 1;
  const aWon = entry.wins_a > entry.wins_b;
  const bWon = entry.wins_b > entry.wins_a;
  const { enabled, revealed } = useSpoilerState();
  const spoilerId = `series:${entry.firstMatchId}`;
  const hidden = enabled && !revealed.includes(spoilerId);

  /* Game 1 of the series; when it is a placeholder with no match page, the
     series' week is the useful destination instead. */
  const gameOneMatch = matchPath((entry.games[0] || {}).matchId ?? entry.firstMatchId);
  const seriesHref =
    gameOneMatch ?? `/week/${entry.week}?event_title=${encodeURIComponent(entry.eventTitle || "")}`;

  const gamePills = (
    <div className="flex items-center justify-center gap-1">
      {Array.from({ length: totalGames }, (_, idx) => {
        const played = entry.games[idx];
        const href = played ? matchPath(played.matchId) : null;

        if (!played) {
          return (
            <span
              key={`ghost-${idx}`}
              aria-hidden="true"
              className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-transparent font-mono text-[10px] font-bold text-dim"
            >
              {idx + 1}
            </span>
          );
        }

        /* A game with no match page (N/A, forfeit placeholder) still counts in the
           score, but reads as a score rather than a link. */
        return href ? (
          <Link
            key={played.game}
            to={href}
            title={`Open game ${played.game}`}
            className={`flex h-5 w-5 items-center justify-center rounded-md border border-accent-border bg-accent-bg-strong font-mono text-[10px] font-bold text-accent-light transition-colors hover:bg-accent-bg ${FOCUS_RING}`}
          >
            {played.game}
          </Link>
        ) : (
          <span
            key={played.game}
            title={`Game ${played.game} has no match page`}
            className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-transparent font-mono text-[10px] font-bold text-dim"
          >
            {played.game}
          </span>
        );
      })}
    </div>
  );

  /* The winner is full opacity and the loser is dimmed -- the design no longer
     uses the success green for a win, so a draw leaves both at 1. */
  const aOpacity = bWon && !hidden ? " opacity-50" : "";
  const bOpacity = aWon && !hidden ? " opacity-50" : "";

  const meta = (
    <div className="flex shrink-0 flex-col gap-[3px]">
      <span className="font-mono text-[11px] font-bold text-accent-light">
        BO{totalGames}
      </span>
      {entry.series_title && (
        <span className="text-[10px] font-semibold uppercase tracking-[.05em] text-dim">
          {entry.series_title}
        </span>
      )}
    </div>
  );

  const score = (
    <Spoiler id={spoilerId} replace="? – ?" className="font-valve-pulp text-[24px] leading-none">
    <div className="flex shrink-0 items-center gap-2.5">
      <span className={`font-valve-pulp text-[24px] leading-none text-primary${aOpacity}`}>
        {entry.wins_a}
      </span>
      <span className="h-[18px] w-px bg-border-lighter" aria-hidden="true" />
      <span className={`font-valve-pulp text-[24px] leading-none text-primary${bOpacity}`}>
        {entry.wins_b}
      </span>
    </div>
    </Spoiler>
  );

  const actions = (
    <div className="flex items-center justify-end gap-3">
      {entry.vod_url && (
        <a
          href={entry.vod_url}
          target="_blank"
          rel="noopener noreferrer"
          className={`shrink-0 text-dim transition-colors hover:text-danger-text ${FOCUS_RING}`}
          title="Watch VOD"
          aria-label={`Watch the VOD for ${entry.team_a} versus ${entry.team_b}`}
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M19.615 3.184c-3.604-.246-11.631-.245-15.23 0-3.897.266-4.356 2.62-4.385 8.816.029 6.185.484 8.549 4.385 8.816 3.6.245 11.626.246 15.23 0 3.897-.266 4.356-2.62 4.385-8.816-.029-6.185-.484-8.549-4.385-8.816zm-10.615 12.816v-8l8 3.993-8 4.007z" />
          </svg>
        </a>
      )}

      {/* Game 1 of the series, or the week when that game has no match page. */}
      <Link
        to={seriesHref}
        className={`shrink-0 text-[12px] font-semibold tracking-[.02em] text-accent-light transition-colors hover:text-accent ${FOCUS_RING}`}
      >
        {gameOneMatch ? "View series →" : "View week →"}
      </Link>
    </div>
  );

  /* The wrapper takes the column's space and truncates; the link itself only
     covers the team name, so the click and hover target is just the text. */
  const teamA = (
    <div className="min-w-0 flex-1 truncate sm:text-right">
      <Link
        to={`/team/${encodeURIComponent(entry.team_a)}`}
        className={`text-[15px] font-semibold text-primary hover:underline ${FOCUS_RING}${aOpacity}`}
      >
        <Spoiler id={spoilerId} replace="Team ?">{entry.team_a}</Spoiler>
      </Link>
    </div>
  );

  const teamB = (
    <div className="min-w-0 flex-1 truncate">
      <Link
        to={`/team/${encodeURIComponent(entry.team_b)}`}
        className={`text-[15px] font-semibold text-primary hover:underline ${FOCUS_RING}${bOpacity}`}
      >
        <Spoiler id={spoilerId} replace="Team ?">{entry.team_b}</Spoiler>
      </Link>
    </div>
  );

  const CARD =
    "rounded-xl border border-border bg-card px-4 py-[14px] transition-[transform,background-color,border-color] duration-200 ease-out";
  const CARD_HOVER =
    "hover:border-accent-border hover:bg-surface hover:translate-x-1 motion-reduce:hover:translate-x-0 motion-reduce:transition-none";

  return (
    <>
      {/* Desktop: one five-column card. */}
      <div
        className={`${CARD} ${CARD_HOVER} hidden sm:grid sm:grid-cols-[72px_minmax(0,1fr)_150px_minmax(0,1fr)_110px] sm:items-center sm:gap-3`}
      >
        {meta}
        {teamA}
        <div className="flex flex-col items-center gap-1.5">
          {score}
          {gamePills}
        </div>
        {teamB}
        {actions}
      </div>

      {/* Mobile: the pills drop to their own line and the actions wrap, as before. */}
      <div className={`${CARD} sm:hidden`}>
        {meta}
        <div className="mt-2 flex items-center gap-3">
          {teamA}
          {score}
          {teamB}
        </div>
        <div className="mt-2">{gamePills}</div>
        <div className="mt-2">{actions}</div>
      </div>
    </>
  );
}
