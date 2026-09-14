import React from "react";
import { Link } from "react-router-dom";

/**
 * Recent form: one square per game, oldest on the left so the newest game sits
 * on the right, matching the "last 10 games ->" direction.
 */
function FormStrip({ form = [] }) {
  if (form.length === 0) {
    return <span className="text-xs text-gray-600">No games yet</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {form.map((game) => (
        <Link
          key={game.match_id}
          to={`/match/${game.match_id}`}
          title={`Match ${game.match_id}: ${game.result === "W" ? "Win" : "Loss"}`}
          className={`h-3.5 w-5 rounded-sm transition-opacity hover:opacity-70 ${
            game.result === "W" ? "bg-green-500" : "bg-red-500"
          }`}
        />
      ))}
    </div>
  );
}

export default FormStrip;
