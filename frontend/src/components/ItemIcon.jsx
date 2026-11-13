import React, { useState } from "react";
import { cdnImage } from "../utils/cdn";
import ItemTooltip from "./items/ItemTooltip";

/**
 * Square item icon. `icon` is a path relative to the image CDN root (for example
 * "items/vitality/dispel_magic_psd.png"), resolved by the backend so the client never
 * has to guess a filename. `fallback` is an upstream image URL to try when the shipped
 * art is missing or 404s; with no fallback the icon shows a dashed placeholder.
 *
 * Pass `itemId` to add the in-game item tooltip (deadlock-api) on hover, or on tap
 * on touch screens. Set `inLink` when the icon sits inside a link, so a tap keeps
 * navigating instead of opening the tooltip.
 */
function ItemIcon({
  icon,
  name,
  size = "h-9 w-9",
  fit = "object-cover",
  className = "",
  fallback = null,
  itemId = null,
  inLink = false,
}) {
  // Track which source failed rather than a plain boolean, so a different `icon` is
  // retried instead of latching the previous failure.
  const [failedSrc, setFailedSrc] = useState(null);
  const primary = icon ? cdnImage(icon) : null;
  const src = primary && failedSrc !== primary ? primary : fallback;
  /* The rich tooltip replaces the browser's own `title` popup. */
  const title = itemId ? undefined : name || undefined;

  const image =
    !src || failedSrc === src ? (
      <span
        title={itemId ? undefined : name || "Unknown item"}
        className={`${size} flex shrink-0 items-center justify-center rounded border border-dashed border-gray-600 text-[10px] font-semibold uppercase text-gray-600 ${className}`}
      >
        {name ? name[0] : ""}
      </span>
    ) : (
      <img
        src={src}
        alt={name}
        title={title}
        onError={() => setFailedSrc(src)}
        className={`${size} shrink-0 rounded ${fit} ${className}`}
      />
    );

  if (!itemId) return image;

  return (
    <ItemTooltip itemId={itemId} title={name} inLink={inLink} className={`inline-flex shrink-0 ${size}`}>
      {image}
    </ItemTooltip>
  );
}

export default ItemIcon;
