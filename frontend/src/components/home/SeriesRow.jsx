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
    <div className="flex items-center justify-center gap-1.5">
      {Array.from({ length: totalGames }, (_, idx) => {
        const played = entry.games[idx];

        return played ? (
          <Link
            key={played.game}
            to={`/match/${played.matchId}`}
            title={`Open game ${played.game}`}
            className={`flex h-5 w-5 items-center justify-center rounded-full border border-success-border bg-success-bg font-mono text-[10px] font-bold text-success transition-colors hover:bg-success/30 ${FOCUS_RING}`}
          >
            {played.game}
          </Link>
        ) : (
          <span
            key={`ghost-${idx}`}
            aria-hidden="true"
            className="flex h-5 w-5 items-center justify-center rounded-full border border-border bg-white/[0.03] font-mono text-[10px] text-dim/40"
          >
            {idx + 1}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="px-3 pb-5 pt-3 transition-colors hover:bg-white/[0.02]">
      {/* Top row: format badge + stage label */}
      <div className="mb-1 flex items-center gap-2 pl-2">
        <span className="rounded border border-border bg-white/[0.04] px-2 py-0.5 font-mono text-[10px] font-semibold text-dim">
          BO{totalGames}
        </span>
        {entry.series_title && (
          <span className="text-[10px] font-semibold uppercase tracking-[.05em] text-accent-light">
            {entry.series_title}
          </span>
        )}
      </div>

      {/* Teams + score. Secondary actions drop to their own line on mobile. */}
      <div className="flex flex-wrap items-center gap-y-2">
        <Link
          to={`/team/${encodeURIComponent(entry.team_a)}`}
          className={`flex-1 min-w-0 text-right text-sm font-semibold hover:underline ${FOCUS_RING} ${
            aWon ? "text-success" : "text-primary"
          }`}
        >
          {entry.team_a}
        </Link>

        <div className="mx-2 flex shrink-0 flex-col items-center sm:mx-4">
          <span
            className={`font-mono text-sm font-bold tabular-nums ${
              aWon === bWon ? "text-dim" : "text-primary"
            }`}
          >
            {entry.wins_a} <span className="text-dim">—</span> {entry.wins_b}
          </span>
          <div className="mt-1 hidden sm:block">{gamePills}</div>
        </div>

        <Link
          to={`/team/${encodeURIComponent(entry.team_b)}`}
          className={`flex-1 min-w-0 text-sm font-semibold hover:underline ${FOCUS_RING} ${
            bWon ? "text-success" : "text-primary"
          }`}
        >
          {entry.team_b}
        </Link>

        {/* Mobile: game pills centred on their own line. */}
        <div className="flex w-full justify-center px-2 sm:hidden">
          {gamePills}
        </div>

        <div className="flex w-full items-center justify-end gap-3 px-2 sm:ml-4 sm:w-auto sm:px-0">
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
            className={`shrink-0 text-xs font-semibold tracking-[.02em] text-accent-secondary-light transition-colors hover:text-accent-secondary ${FOCUS_RING}`}
          >
            View series →
          </Link>
        </div>
      </div>
    </div>
  );
}
