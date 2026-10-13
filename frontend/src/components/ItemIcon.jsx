import React, { useState } from "react";
import { cdnImage } from "../utils/cdn";

/**
 * Square item icon. `icon` is a path relative to the image CDN root (for example
 * "items/vitality/dispel_magic_psd.png"), resolved by the backend so the client never
 * has to guess a filename. `fallback` is an upstream image URL to try when the shipped
 * art is missing or 404s; with no fallback the icon shows a dashed placeholder.
 */
function ItemIcon({ icon, name, size = "h-9 w-9", fit = "object-cover", className = "", fallback = null }) {
  // Track which source failed rather than a plain boolean, so a different `icon` is
  // retried instead of latching the previous failure.
  const [failedSrc, setFailedSrc] = useState(null);
  const primary = icon ? cdnImage(icon) : null;
  const src = primary && failedSrc !== primary ? primary : fallback;

  if (!src || failedSrc === src) {
    return (
      <span
        title={name || "Unknown item"}
        className={`${size} flex shrink-0 items-center justify-center rounded border border-dashed border-gray-600 text-[10px] font-semibold uppercase text-gray-600 ${className}`}
      >
        {name ? name[0] : ""}
      </span>
    );
  }

  return (
    <img
      src={src}
      alt={name}
      title={name}
      onError={() => setFailedSrc(src)}
      className={`${size} shrink-0 rounded ${fit} ${className}`}
    />
  );
}

export default ItemIcon;
