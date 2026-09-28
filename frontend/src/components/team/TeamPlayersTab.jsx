import React from "react";
import HeroUsage from "./HeroUsage";
import Leaderboard from "./Leaderboard";
import RosterAccordion from "./RosterAccordion";
import RosterTimeline from "./RosterTimeline";
import SectionCard from "../SectionCard";

function TeamPlayersTab({
  currentPlayers = [],
  players = [],
  rosterWeeks = [],
  max_week,
  leaderboard,
  heroUsage,
}) {
  const span =
    rosterWeeks.length > 0
      ? `NS ${rosterWeeks[0]}\u2013${rosterWeeks[rosterWeeks.length - 1]}`
      : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start gap-6">
        <div className="min-w-0 flex-[1_1_100%]">
          <SectionCard
            title={`Active Roster${max_week != null ? ` \u00b7 NS ${max_week}` : ""}`}
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
          week, so there is nothing to plot. */}
      {rosterWeeks.length > 0 && (
        <SectionCard
          title="Roster Timeline"
          subtitle={span ? `${span} · one cell per week · hover a week for its lineup` : "hover a week for its lineup"}
        >
          <RosterTimeline players={players} weeks={rosterWeeks} maxWeek={max_week} />
        </SectionCard>
      )}
    </div>
  );
}

export default TeamPlayersTab;
