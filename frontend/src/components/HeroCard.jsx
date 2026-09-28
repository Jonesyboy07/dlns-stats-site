import React, { useState } from "react";
import { cdnImage } from "../utils/cdn";

/**
 * Vertical hero art (120×200 source). CAREFUL: this folder spells the ampersand
 * literally (`mo_&_krill_vertical_psd.png`) while the square icons spell it out
 * (`mo_and_krill_sm_psd.png`), so the slug rule here is deliberately different
 * from HeroIcon's. Anything that still fails to resolve falls back to a dashed
 * box with the hero's initials — never a broken image.
 */
export const heroArtSlug = (heroName) =>
  (heroName || "")
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/\s+/g, "_");

export const heroArtUrl = (heroName) =>
  cdnImage(`vertical/${heroArtSlug(heroName)}_vertical_psd.png`);

/** "Mo & Krill" -> "MK", "Rem" -> "RE". */
export const heroInitials = (heroName) => {
  const parts = (heroName || "")
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
};

function HeroCard({ name, size = "h-[110px] w-[66px]", className = "" }) {
  const [failed, setFailed] = useState(false);
  const label = name || "Unknown hero";

  if (!name || failed) {
    return (
      <span
        title={label}
        className={`${size} flex shrink-0 items-center justify-center rounded-lg border border-dashed border-border-lighter text-[11px] font-bold text-dim ${className}`}
      >
        {heroInitials(name)}
      </span>
    );
  }

  return (
    <img
      src={heroArtUrl(name)}
      alt={label}
      title={label}
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded-lg border border-border-light object-cover ${className}`}
    />
  );
}

export default HeroCard;
