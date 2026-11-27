import React from "react";
import HeroUsage from "./HeroUsage";
import Leaderboard from "./Leaderboard";
import RosterAccordion from "./RosterAccordion";
import RosterTimeline from "./RosterTimeline";
import SectionCard from "../SectionCard";
import { eventPrefix } from "../../utils/events";

/**
 * One timeline per event, rows carrying that event's weeks merged onto the full
 * player record (name, avatar). Falls back to the single page-level timeline for
 * a payload without `roster_timelines`.
 */
export function eventTimelines(rosterTimelines, players = [], rosterWeeks = [], maxWeek) {
  if (!Array.isArray(rosterTimelines)) {
    return rosterWeeks.length
      ? [{ event: null, prefix: "NS", weeks: rosterWeeks, maxWeek, players }]
      : [];
  }
  const byId = new Map(players.map((player) => [player.account_id, player]));
  return rosterTimelines
    .filter((timeline) => timeline.weeks?.length && timeline.players?.length)
    .map((timeline) => ({
      event: timeline.event_title,
      prefix: eventPrefix(timeline.event_title),
      weeks: timeline.weeks,
      maxWeek: timeline.max_week,
      players: timeline.players.map((row) => ({ ...byId.get(row.account_id), ...row })),
    }));
}

function TeamPlayersTab({
  currentPlayers = [],
  players = [],
  rosterWeeks = [],
  rosterTimelines,
  max_week,
  leaderboard,
  heroUsage,
}) {
  const timelines = eventTimelines(rosterTimelines, players, rosterWeeks, max_week);
  const leadPrefix = timelines[0]?.prefix ?? "NS";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1_1_100%]">
          <SectionCard
            title={`Active Roster${max_week != null ? ` \u00b7 ${leadPrefix} ${max_week}` : ""}`}
            subtitle="click a row to expand"
          >
            <RosterAccordion players={currentPlayers} maxWeek={max_week} />
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-[1_1_420px] flex-col gap-6">
          <SectionCard title="Leaderboard" subtitle="per game vs league average">
            <Leaderboard players={currentPlayers} league={leaderboard?.league} />
          </SectionCard>

          <SectionCard
            title="Hero Usage"
            subtitle={
              heroUsage?.heroes?.length
                ? `games per player \u00d7 ${heroUsage.heroes.length} heroes`
                : "games per player \u00d7 heroes"
            }
          >
            <HeroUsage usage={heroUsage} players={currentPlayers} />
          </SectionCard>
        </div>
      </div>

      {/* Replaces the old "Former Players" grid: one shared grid showing when each
          player was on the roster, gaps included. Hidden for the pre-season
          qualifier teams, whose single Night Shift Open match carries no event
          week, so there is nothing to plot. Week numbers restart per event, so
          each event the team played gets its own timeline. */}
      {timelines.map((timeline) => {
        const span = `${timeline.prefix} ${timeline.weeks[0]}–${timeline.weeks[timeline.weeks.length - 1]}`;
        return (
          <SectionCard
            key={timeline.event ?? "league"}
            title={timelines.length > 1 ? `Roster Timeline · ${timeline.event}` : "Roster Timeline"}
            subtitle={`${span} · one cell per week · hover a week for its lineup`}
          >
            <RosterTimeline
              players={timeline.players}
              weeks={timeline.weeks}
              maxWeek={timeline.maxWeek}
              prefix={timeline.prefix}
            />
          </SectionCard>
        );
      })}
    </div>
  );
}

export default TeamPlayersTab;
