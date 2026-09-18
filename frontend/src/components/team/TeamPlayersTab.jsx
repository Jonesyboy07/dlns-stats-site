import React from "react";
import PlayerCard from "./PlayerCard";
import HeroUsage from "./HeroUsage";
import Leaderboard from "./Leaderboard";
import RosterAccordion from "./RosterAccordion";
import SectionCard from "../SectionCard";

function TeamPlayersTab({
  currentPlayers = [],
  historicPlayers = [],
  max_week,
  leaderboard,
  heroUsage,
}) {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <SectionCard
          title={`Active Roster${max_week != null ? ` \u00b7 WK ${max_week}` : ""}`}
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

      {/* Former Players keeps its current treatment until its own spec lands. */}
      {historicPlayers.length > 0 && (
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Former Players
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {historicPlayers.map((p) => (
              <PlayerCard key={p.account_id} player={p} isCurrent={false} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export default TeamPlayersTab;
