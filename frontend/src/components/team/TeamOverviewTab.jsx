import React from "react";
import PlayerCard from "./PlayerCard";

const heroIcon = (heroName) => {
  const slug = (heroName || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/\s+/g, "_");
  return `/static/images/hero icons/${slug}_sm_psd.png`;
};

function TeamOverviewTab({ team_name, max_week, currentPlayers, historicPlayers, wins, losses, hasRecord, total_matches, heroPicks, nsWins, nsLosses, hasNsRecord }) {
  const winRate = hasRecord ? Math.round((wins / (wins + losses)) * 100) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
      {/* Roster column */}
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
            <div className="space-y-2">
              {currentPlayers.map((p) => (
                <PlayerCard key={p.account_id} player={p} isCurrent />
              ))}
            </div>
          )}
        </section>

      </div>

      {/* Stats column */}
      <div className="lg:col-span-2 space-y-6">
        <section>
          <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Team Stats
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500 mb-1">Total Matches</p>
              <p className="text-2xl font-bold text-white">{total_matches}</p>
            </div>
            {hasRecord && (
              <>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1">Wins</p>
                  <p className="text-2xl font-bold text-green-400">{wins}</p>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1">Losses</p>
                  <p className="text-2xl font-bold text-red-400">{losses}</p>
                </div>
                <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                  <p className="text-xs text-gray-500 mb-1">Win Rate</p>
                  <p className="text-2xl font-bold text-blue-400">{winRate}%</p>
                </div>
              </>
            )}
          </div>
        </section>

        {hasNsRecord && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Night Shift Record
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">NS Series Wins</p>
                <p className="text-2xl font-bold text-green-400">{nsWins}</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">NS Series Losses</p>
                <p className="text-2xl font-bold text-red-400">{nsLosses}</p>
              </div>
              <div className="bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-3">
                <p className="text-xs text-gray-500 mb-1">NS Series Win Rate</p>
                <p className="text-2xl font-bold text-blue-400">{Math.round((nsWins / (nsWins + nsLosses)) * 100)}%</p>
              </div>
            </div>
          </section>
        )}

        {heroPicks && heroPicks.length > 0 && (
          <section>
            <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
              Most Played Heroes
            </h2>
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
              {heroPicks.slice(0, 10).map((h) => (
                <div
                  key={h.hero_id}
                  className="bg-gray-800/60 border border-gray-700 rounded-lg p-2 flex flex-col items-center gap-1 text-center"
                >
                  <img
                    src={heroIcon(h.hero_name)}
                    alt={h.hero_name}
                    className="w-10 h-10 object-cover rounded"
                    onError={(e) => { e.target.style.display = "none"; }}
                  />
                  <span className="text-xs text-gray-200 leading-tight">{h.hero_name}</span>
                  <span className="text-xs text-gray-500">{h.picks} pick{h.picks !== 1 ? "s" : ""}</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

export default TeamOverviewTab;
