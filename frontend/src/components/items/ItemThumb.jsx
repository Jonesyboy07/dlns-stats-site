import React from "react";
import ItemIcon from "../ItemIcon";
import { slotColor } from "../../utils/items";

/**
 * An item's icon in a frame tinted with its slot colour, with the in-game
 * tooltip on hover. Set `inLink` when the thumb sits inside a link.
 */
export default function ItemThumb({
  item,
  size = "h-9 w-9",
  rounded = "rounded-md",
  borderAlpha = "80",
  className = "",
  inLink = false,
}) {
  return (
    <span
      className={`${size} ${rounded} flex shrink-0 overflow-hidden border bg-surface ${className}`}
      style={{ borderColor: slotColor(item.slot, borderAlpha) }}
    >
      <ItemIcon
        icon={item.icon}
        fallback={item.image}
        name={item.name}
        itemId={item.id}
        inLink={inLink}
        size="h-full w-full"
        className="rounded-none"
      />
    </span>
  );
}
