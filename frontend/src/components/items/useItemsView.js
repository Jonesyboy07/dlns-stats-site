import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  DEFAULT_MIN_GAMES,
  ITEM_GROUPS,
  ITEM_VIEWS,
  formatItemSort,
  isDefaultItemSort,
  parseChoice,
  parseItemSort,
  parseMinGames,
  parseSlot,
  parseTiers,
} from "../../utils/items";

/**
 * The Items index's own view state, in the URL beside the stats filter's
 * `weeks` and `region`: `?slot=weapon&tier=3,4&q=toxic&min=8&sort=pick-desc&group=slot&view=grid`.
 *
 * None of it is sent to the server: the index fetches every item for the
 * weeks and region once, and slot, tier, search, the min-games threshold, the
 * sort and the layout are all applied in the browser. Defaults stay out of the
 * URL, and `replace` keeps each change out of the back button, as the stats
 * page does.
 */
export default function useItemsView() {
  const [searchParams, setSearchParams] = useSearchParams();

  const view = useMemo(
    () => ({
      slot: parseSlot(searchParams.get("slot")),
      tiers: parseTiers(searchParams.get("tier")),
      q: searchParams.get("q") ?? "",
      minGames: parseMinGames(searchParams.get("min")),
      sort: parseItemSort(searchParams.get("sort")),
      group: parseChoice(searchParams.get("group"), ITEM_GROUPS),
      layout: parseChoice(searchParams.get("view"), ITEM_VIEWS),
    }),
    [searchParams],
  );

  const update = useCallback(
    (patch) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            if (value == null || value === "") next.delete(key);
            else next.set(key, value);
          }
          return next;
        },
        { replace: true },
      );
    },
    [setSearchParams],
  );

  const setters = useMemo(
    () => ({
      setSlot: (slot) => update({ slot: slot === "all" ? null : slot }),
      setTiers: (tiers) => update({ tier: tiers.length ? tiers.join(",") : null }),
      setQuery: (q) => update({ q: q || null }),
      setMinGames: (min) => update({ min: min === DEFAULT_MIN_GAMES ? null : String(min) }),
      setSort: (sort) => update({ sort: isDefaultItemSort(sort) ? null : formatItemSort(sort) }),
      setGroup: (group) => update({ group: group === ITEM_GROUPS[0] ? null : group }),
      setLayout: (layout) => update({ view: layout === ITEM_VIEWS[0] ? null : layout }),
      resetView: () => update({ slot: null, tier: null, q: null, min: null }),
    }),
    [update],
  );

  return { ...view, ...setters };
}
