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
  leagueWeeks = [],
  max_week,
  leaderboard,
  heroUsage,
}) {
  const span =
    rosterWeeks.length > 0
      ? `NS ${rosterWeeks[0]}\u2013${rosterWeeks[rosterWeeks.length - 1]}`
      : null;

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <SectionCard
          title={`Active Roster${max_week != null ? ` \u00b7 NS ${max_week}` : ""}`}
          subtitle="click a row to expand"
        >
          <RosterAccordion players={currentPlayers} />
        </SectionCard>

        <div className="space-y-6">
          <Leaderboard players={currentPlayers} league={leaderboard?.league} />

          <SectionCard
            title="Hero Usage"
            subtitle={
              heroUsage?.heroes?.length
                ? `player \u00d7 ${heroUsage.heroes.length} heroes`
                : "player \u00d7 heroes"
            }
          >
            <HeroUsage usage={heroUsage} players={currentPlayers} />
          </SectionCard>
        </div>
      </div>

      {/* Replaces the old "Former Players" grid: one shared timeline showing
          when each player was on the roster, gaps included. Hidden for the
          pre-season qualifier teams, whose single Night Shift Open match carries
          no event week, so there is nothing to plot. */}
      {rosterWeeks.length > 0 && (
        <SectionCard
          title="Roster Timeline"
          subtitle={`every player's tenure across ${span}`}
        >
          <RosterTimeline
            players={players}
            weeks={rosterWeeks}
            leagueWeeks={leagueWeeks}
            maxWeek={max_week}
          />
        </SectionCard>
      )}
    </div>
  );
}

export default TeamPlayersTab;
