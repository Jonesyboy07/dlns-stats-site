import React from "react";

/**
 * Full-width bar split into a wins segment and a losses segment, so the green
 * share reads directly as the win rate for that row.
 */
function DivisionBar({ wins = 0, losses = 0, title, className = "" }) {
  const total = wins + losses;

  if (total === 0) {
    return (
      <div
        title={title}
        className={`h-4 w-full rounded border border-dashed border-gray-700 ${className}`}
      />
    );
  }

  const winShare = (wins / total) * 100;

  return (
    <div
      title={title}
      className={`flex h-4 w-full overflow-hidden rounded bg-red-500/80 ${className}`}
    >
      <div className="h-full bg-green-500" style={{ width: `${winShare}%` }} />
    </div>
  );
}

export default DivisionBar;
