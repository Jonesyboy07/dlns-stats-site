import React, { useState } from "react";
import { TEAM_LOGO_FALLBACK, teamLogoUrl } from "../utils/teamLogos";

const initialsOf = (teamName) =>
  String(teamName ?? "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

/**
 * A team's crest.
 *
 * Three stages, because the crest set is hand-collected and will always have
 * gaps: the team's own `<key>.png` -> `default.jpg` -> the team's initials. The
 * initials stage only exists so a missing `default.jpg` degrades to something
 * readable instead of the browser's broken-image glyph.
 *
 * Deliberately `object-contain`, not `object-cover`: crests are not a uniform
 * aspect ratio, and cropping a logo is worse than letterboxing it.
 *
 * Crests are a hand-collected set with gaps, so "no crest for this team" is a
 * normal state and must not throw or log.
 */
function TeamLogo({
  name,
  size = "h-8 w-8",
  rounded = "rounded-lg",
  textClass = "text-[11px]",
  className = "",
}) {
  const [seen, setSeen] = useState(name);
  const [stage, setStage] = useState(0);

  // Reset during render rather than in an effect: a filtered list can reuse a
  // row for a different team, and an effect would show the previous team's
  // failure state for one frame.
  if (seen !== name) {
    setSeen(name);
    setStage(0);
  }

  const box = `${size} ${rounded} shrink-0`;

  if (stage >= 2 || !name) {
    return (
      <span
        aria-hidden="true"
        title={name || undefined}
        className={`${box} ${textClass} flex items-center justify-center border border-border-lighter bg-input font-bold uppercase text-muted ${className}`}
      >
        {initialsOf(name)}
      </span>
    );
  }

  return (
    <img
      src={stage === 0 ? teamLogoUrl(name) : TEAM_LOGO_FALLBACK}
      alt={name}
      title={name}
      onError={() => setStage((current) => current + 1)}
      className={`${box} object-contain ${className}`}
    />
  );
}

export default TeamLogo;
