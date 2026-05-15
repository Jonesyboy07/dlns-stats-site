import React from "react";
import { Link } from "react-router-dom";

function PlayerCard({ player, isCurrent }) {
  return (
    <Link
      to={`/player/${player.account_id}`}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg border transition-all hover:border-purple-500/50 hover:bg-gray-700/50 ${
        isCurrent
          ? "border-gray-600 bg-gray-800/60"
          : "border-gray-700/50 bg-gray-800/30"
      }`}
    >
      <div className="w-8 h-8 rounded-full bg-gray-700 flex items-center justify-center text-xs font-bold text-gray-400 shrink-0">
        {(player.persona_name || "?")[0].toUpperCase()}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-100 truncate">
          {player.persona_name || `Player ${player.account_id}`}
        </p>
        <p className="text-xs text-gray-500">
          {player.appearances} match{player.appearances !== 1 ? "es" : ""}
          {player.first_week != null && player.last_week != null && (
            <span>
              {" "}
              · Wk {player.first_week}
              {player.first_week !== player.last_week && `–${player.last_week}`}
            </span>
          )}
        </p>
      </div>
    </Link>
  );
}

export default PlayerCard;
