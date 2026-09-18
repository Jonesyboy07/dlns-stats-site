import React, { useState } from "react";

/** Player avatar with an initials fallback when Steam art is unavailable. */
function PlayerAvatar({ player, size = "h-9 w-9", className = "" }) {
  const [failed, setFailed] = useState(false);

  if (player?.avatar_url && !failed) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        onError={() => setFailed(true)}
        className={`${size} shrink-0 rounded-full border border-gray-700 object-cover ${className}`}
      />
    );
  }

  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center rounded-full bg-gray-700 text-xs font-bold text-gray-400 ${className}`}
    >
      {(player?.persona_name || "?")[0].toUpperCase()}
    </span>
  );
}

export default PlayerAvatar;
