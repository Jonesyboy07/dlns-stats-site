import React from "react";
import PlayerCard from "./PlayerCard";

function TeamPlayersTab({ currentPlayers, historicPlayers, max_week }) {
  return (
    <div className="space-y-8">
      {/* Active Roster */}
      <section>
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
          Active Roster
          {max_week != null && (
            <span className="ml-2 text-gray-600 normal-case font-normal">
              · Week {max_week}
            </span>
          )}
        </h2>
        {currentPlayers.length === 0 ? (
          <p className="text-gray-600 text-sm">No roster data available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {currentPlayers.map((p) => (
              <PlayerCard key={p.account_id} player={p} isCurrent />
            ))}
          </div>
        )}
      </section>

      {/* Former Players */}
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
