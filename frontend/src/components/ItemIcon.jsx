import React, { useState } from "react";
import { cdnImage } from "../utils/cdn";

/**
 * Square item icon. `icon` is a path relative to the image CDN root (for
 * example "items/vitality/dispel_magic_psd.png"), resolved by the backend.
 * Falls back to a dashed placeholder when the icon is missing or 404s.
 */
function ItemIcon({ icon, name, size = "h-9 w-9", className = "" }) {
  const [failed, setFailed] = useState(false);

  if (!icon || failed) {
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
      src={cdnImage(icon)}
      alt={name}
      title={name}
      onError={() => setFailed(true)}
      className={`${size} shrink-0 rounded object-cover ${className}`}
    />
  );
}

export default ItemIcon;
