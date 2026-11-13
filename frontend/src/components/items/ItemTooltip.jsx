import React, { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import { defineCustomElement } from "@deadlock-api/ui-core/dist/components/dl-item-card.js";
import { itemCardLoader } from "./itemCardLoader";

defineCustomElement();

/* dl-item-card sizes itself and its trigger to their content when it wraps a
   custom trigger. Inside its shadow root, make both fill the wrapper span
   instead, so a percentage-sized icon (the Items grid) keeps its size and a
   fixed one (h-9 w-9) is unchanged. */
let fillSheet = null;
function getFillSheet() {
  if (fillSheet || typeof CSSStyleSheet === "undefined") return fillSheet;
  try {
    fillSheet = new CSSStyleSheet();
    fillSheet.replaceSync(
      ":host{display:block!important;width:100%!important;height:100%!important}" +
        ".trigger{display:block!important;width:100%!important;height:100%!important}",
    );
  } catch {
    fillSheet = null;
  }
  return fillSheet;
}

/* Hover where there is a mouse. On touch screens a tap opens the tooltip,
   except inside a link, where the tap has to keep navigating. */
const HOVER_QUERY = "(hover: hover) and (pointer: fine)";
function subscribeHover(callback) {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(HOVER_QUERY);
  mql.addEventListener("change", callback);
  return () => mql.removeEventListener("change", callback);
}
const canHover = () =>
  typeof window === "undefined" || !window.matchMedia ? true : window.matchMedia(HOVER_QUERY).matches;

/**
 * Wraps an existing icon in a deadlock-api `<dl-item-card>` so hovering (or
 * tapping) it shows the in-game item tooltip. The icon itself is unchanged:
 * it becomes the card's custom trigger.
 *
 * The card never fetches anything itself; its data comes from our batched
 * `/db/items/cards`. Until that arrives, or when it can't (an item that is no
 * longer in the game, a failed request), the icon renders as before with the
 * browser's plain `title` popup as the fallback.
 *
 * Props:
 *   itemId    – numeric item id
 *   title     – plain hover text used whenever the rich tooltip isn't available
 *   inLink    – true when the icon sits inside a <Link>/<a> (no tap-to-open)
 *   className – size/layout classes for the wrapper; match the icon's size
 */
export default function ItemTooltip({ itemId, title, inLink = false, className = "", children }) {
  const ref = useRef(null);
  const card = useSyncExternalStore(itemCardLoader.subscribe, () => itemCardLoader.get(itemId));
  const hover = useSyncExternalStore(subscribeHover, canHover, () => true);
  const trigger = hover ? "hover" : inLink ? "none" : "click";

  useEffect(() => {
    itemCardLoader.request(itemId);
  }, [itemId]);

  useLayoutEffect(() => {
    const root = ref.current?.shadowRoot;
    const sheet = getFillSheet();
    if (root && sheet && !root.adoptedStyleSheets.includes(sheet)) {
      root.adoptedStyleSheets = [...root.adoptedStyleSheets, sheet];
    }
  });

  /* Objects can't travel as attributes, so set them as properties. The element
     has no item-id, so it never looks the item up on its own. */
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !card) return;
    el.componentItemsData = card.components;
    el.parentItemsData = card.parents;
    el.itemData = card.item;
  }, [card]);

  if (!itemId) return children;

  /* Classes go on a plain span: dl-item-card toggles its own host classes, and
     React re-applying `class` would wipe them. */
  /* The plain `title` sits on the wrapper, so it covers the icon inside, and only
     while there is no rich tooltip to show instead. */
  return (
    <span className={className} title={card ? undefined : title || undefined}>
      <dl-item-card ref={ref} tooltip-trigger={card ? trigger : "none"}>
        {children}
      </dl-item-card>
    </span>
  );
}
