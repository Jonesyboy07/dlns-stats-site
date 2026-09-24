import React, { useState } from "react";
import { cdnImage } from "../utils/cdn";

/**
 * Hero names -> CDN file slugs. Ampersands are spelled out because the icon
 * files use "mo_and_krill_sm_psd.png" for "Mo & Krill".
 */
export const heroSlug = (heroName) =>
  (heroName || "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/['’]/g, "")
    .replace(/\s+/g, "_");

export const heroIconUrl = (heroName) =>
  cdnImage(`hero icons/${heroSlug(heroName)}_sm_psd.png`);

/**
 * Square hero portrait. Falls back to a dashed placeholder holding the hero's
 * initial when the name is missing or the image fails to load.
 */
function HeroIcon({ name, size = "h-8 w-8", className = "" }) {
  const [failed, setFailed] = useState(false);

  if (!name || failed) {
    return (
      <span
        title={name || "Unknown hero"}
        aria-hidden={!name}
        className={`${size} flex shrink-0 items-center justify-center rounded border border-dashed border-gray-600 text-[10px] font-semibold uppercase text-gray-600 ${className}`}
      >
        {name ? name[0] : ""}
      </span>
    );
  }

  return (
    <img
      src={heroIconUrl(name)}
      alt={name}
      title={name}
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded object-cover ${className}`}
    />
  );
}

export default HeroIcon;
