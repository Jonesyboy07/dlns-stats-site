import React, { useState } from "react";

/**
 * Steam avatar in the design's box: a rounded square with a thin light border,
 * falling back to the player's initial on the card/table gradient when there is no
 * avatar art (or the image 404s).
 *
 * Local to the team page on purpose — `PlayerAvatar` is tuned for the older gray
 * palette (rounded-full, gray-700 border), and overriding a border colour through
 * `className` would depend on stylesheet order rather than intent.
 */
function SteamAvatar({
  player,
  size = "h-8 w-8",
  rounded = "rounded-md",
  className = "",
}) {
  const [failed, setFailed] = useState(false);
  const name = player?.persona_name || `Player ${player?.account_id ?? "?"}`;

  if (player?.avatar_url && !failed) {
    return (
      <img
        src={player.avatar_url}
        alt=""
        title={name}
        onError={() => setFailed(true)}
        className={`${size} ${rounded} shrink-0 border border-border-light object-cover ${className}`}
      />
    );
  }

  return (
    <span
      aria-hidden="true"
      title={name}
      className={`${size} ${rounded} flex shrink-0 items-center justify-center border border-border-light bg-gradient-to-br from-input to-table text-[13px] font-bold text-muted ${className}`}
    >
      {name[0].toUpperCase()}
    </span>
  );
}

export default SteamAvatar;
