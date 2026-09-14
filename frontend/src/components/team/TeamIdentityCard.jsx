import React from "react";
import FormStrip from "./FormStrip";

const initialsOf = (teamName) =>
  (teamName || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/**
 * Team identity header: crest, name, series/game records and recent form.
 *
 * `logoUrl` is wired up but currently always empty - crests go in later, so the
 * slot falls back to the team's initials.
 */
function TeamIdentityCard({
  teamName,
  logoUrl,
  seriesRecord,
  gameRecord,
  form = [],
}) {
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-dashed border-gray-600 bg-gray-800/60">
        {logoUrl ? (
          <img
            src={logoUrl}
            alt={teamName}
            className="h-full w-full object-cover"
          />
        ) : (
          <span className="text-xl font-bold text-gray-500">
            {initialsOf(teamName)}
          </span>
        )}
      </div>

      <div className="min-w-0">
        <h1 className="truncate text-3xl font-bold uppercase text-white">
          {teamName}
        </h1>

        <div className="mt-3 flex flex-wrap items-center gap-x-8 gap-y-2">
          {seriesRecord && (
            <span className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Series
              </span>
              <span className="text-xl font-bold text-white">
                {seriesRecord}
              </span>
            </span>
          )}
          {gameRecord && (
            <span className="flex flex-col">
              <span className="text-[10px] uppercase tracking-wider text-gray-500">
                Games
              </span>
              <span className="text-xl font-bold text-white">{gameRecord}</span>
            </span>
          )}
        </div>
      </div>

      <div className="ml-auto flex flex-col items-end gap-1.5">
        <span className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-gray-500">
          Last 10 games
          <span aria-hidden="true">&rarr;</span>
        </span>
        <FormStrip form={form} />
      </div>
    </div>
  );
}

export default TeamIdentityCard;
