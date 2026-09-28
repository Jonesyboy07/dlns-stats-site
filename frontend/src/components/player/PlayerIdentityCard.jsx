import React from "react";
import { Link } from "react-router-dom";
import PlayerAvatar from "../PlayerAvatar";
import FormStrip from "./FormStrip";

/**
 * P1-1: who the page is about, plus the last-10 form strip. A horizontal card so
 * the tab bar can sit directly beneath it (layout 1a); the single-scroll layout
 * (1b) would reuse the same pieces stacked in the rail.
 */
export default function PlayerIdentityCard({ user, accountId, matches = [], teamMeta }) {
  const { current = null, teamCount = 0, firstWeek = null, lastWeek = null } = teamMeta ?? {};
  const persona = user?.persona_name || "Unknown Player";

  return (
    <section className="flex flex-wrap items-center gap-5 rounded-xl border border-border-light bg-card px-5 py-[18px] shadow">
      <PlayerAvatar player={user} size="h-16 w-16 text-xl" rounded="rounded-xl" />

      <div className="min-w-0 flex-1">
        <h1
          title={persona}
          className="truncate font-valve-pulp text-[34px] leading-[1.2] text-primary"
        >
          {persona}
        </h1>

        <div className="mt-1 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[13px] text-muted">
          <span>ID {accountId}</span>

          {current && (
            <span className="min-w-0">
              Team{" "}
              <Link
                to={`/team/${encodeURIComponent(current)}`}
                title={current}
                className="font-semibold text-accent-secondary-light hover:underline"
              >
                {current}
              </Link>
            </span>
          )}

          {firstWeek != null && (
            <span>
              First NS {firstWeek} · Last NS {lastWeek ?? firstWeek}
            </span>
          )}

          {teamCount > 0 && (
            <span>
              {teamCount} team{teamCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      <FormStrip matches={matches} />
    </section>
  );
}
