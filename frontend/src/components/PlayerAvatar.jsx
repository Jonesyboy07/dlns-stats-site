import React, { useState } from "react";

/** Player avatar with an initials fallback when Steam art is unavailable. */
function PlayerAvatar({
  player,
  size = "h-9 w-9",
  rounded = "rounded-full",
  className = "",
  priority = false,
}) {
  const [failed, setFailed] = useState(false);

  if (player?.avatar_url && !failed) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        loading={priority ? "eager" : "lazy"}
        decoding="async"
        onError={() => setFailed(true)}
        className={`${size} shrink-0 ${rounded} object-cover ${className}`}
      />
    );
  }

  return (
    <span
      className={`${size} flex shrink-0 items-center justify-center ${rounded} bg-gray-700 text-xs font-bold text-gray-400 ${className}`}
    >
      {(player?.persona_name || "?")[0].toUpperCase()}
    </span>
  );
}

export default PlayerAvatar;
