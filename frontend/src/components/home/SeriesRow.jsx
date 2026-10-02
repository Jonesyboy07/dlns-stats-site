import React from "react";
import { Link } from "react-router-dom";

const FOCUS_RING =
  "rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-secondary-light";

/**
 * SeriesRow — one series line inside a week group: format badge, stage label,
 * both teams, the score, one pill per game and the series link.
 *
 * Props:
 *   entry – series group built by HomePage from /db/weeks + /db/matches.
 */
export default function SeriesRow({ entry }) {
  const maxWins = Math.max(entry.wins_a, entry.wins_b);
  const totalGames = maxWins > 1 ? maxWins * 2 - 1 : 1;
  const aWon = entry.wins_a > entry.wins_b;
  const bWon = entry.wins_b > entry.wins_a;

  const gamePills = (
    <div className="flex items-center justify-center gap-1">
      {Array.from({ length: totalGames }, (_, idx) => {
        const played = entry.games[idx];

        return played ? (
          <Link
            key={played.game}
            to={`/match/${played.matchId}`}
            title={`Open game ${played.game}`}
            className={`flex h-5 w-5 items-center justify-center rounded-md border border-accent-border bg-accent-bg-strong font-mono text-[10px] font-bold text-accent-light transition-colors hover:bg-accent-bg ${FOCUS_RING}`}
          >
            {played.game}
          </Link>
        ) : (
          <span
            key={`ghost-${idx}`}
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-md border border-border bg-transparent font-mono text-[10px] font-bold text-dim"
          >
            {idx + 1}
          </span>
        );
      })}
    </div>
  );

  /* The winner is full opacity and the loser is dimmed -- the design no longer
     uses the success green for a win, so a draw leaves both at 1. */
  const aOpacity = bWon ? " opacity-50" : "";
  const bOpacity = aWon ? " opacity-50" : "";

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
    <div className="flex shrink-0 items-center gap-2.5">
      <span className={`font-valve-pulp text-[24px] leading-none text-primary${aOpacity}`}>
        {entry.wins_a}
      </span>
      <span className="h-[18px] w-px bg-border-lighter" aria-hidden="true" />
      <span className={`font-valve-pulp text-[24px] leading-none text-primary${bOpacity}`}>
        {entry.wins_b}
      </span>
    </div>
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

      <Link
        to={`/series/${entry.firstMatchId}`}
        className={`shrink-0 text-[12px] font-semibold tracking-[.02em] text-accent-light transition-colors hover:text-accent ${FOCUS_RING}`}
      >
        View series →
      </Link>
    </div>
  );

  const teamA = (
    <Link
      to={`/team/${encodeURIComponent(entry.team_a)}`}
      className={`min-w-0 flex-1 truncate text-[15px] font-semibold text-primary hover:underline sm:text-right ${FOCUS_RING}${aOpacity}`}
    >
      {entry.team_a}
    </Link>
  );

  const teamB = (
    <Link
      to={`/team/${encodeURIComponent(entry.team_b)}`}
      className={`min-w-0 flex-1 truncate text-[15px] font-semibold text-primary hover:underline ${FOCUS_RING}${bOpacity}`}
    >
      {entry.team_b}
    </Link>
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
