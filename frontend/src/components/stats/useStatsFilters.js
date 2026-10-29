import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { clampRange, formatWeeksParam, parseWeeksParam } from "../../utils/statsPeriod";

export const STATS_TABS = ["overview", "heroes", "records", "leaderboards"];

/**
 * The stats page's one filter state, kept in the URL so a pasted link lands on
 * the same view: `?weeks=60-61&region=eu&tab=overview`.
 *
 * The patch is derived from the weeks, never stored. Defaults (latest two weeks,
 * all regions, Overview) are left out of the URL, as `useUrlParam` does for the
 * other pages' tabs, and `replace` keeps filter changes out of the back button.
 *
 * `weeks` and `regions` come from `/db/stats/periods`; until they load the range
 * is whatever the URL asked for, or null.
 */
export default function useStatsFilters({ weeks = [], regions = [] } = {}) {
  const [searchParams, setSearchParams] = useSearchParams();

  const weeksParam = searchParams.get("weeks");
  const range = useMemo(() => {
    const requested = parseWeeksParam(weeksParam);
    return weeks.length ? clampRange(requested, weeks) : requested;
  }, [weeks, weeksParam]);

  const regionParam = (searchParams.get("region") || "").toUpperCase();
  const region = regions.includes(regionParam) ? regionParam : "All";

  const tabParam = (searchParams.get("tab") || "").toLowerCase();
  const tab = STATS_TABS.includes(tabParam) ? tabParam : "overview";

  const update = useCallback(
    (patch) => {
      const next = new URLSearchParams(searchParams);
      for (const [key, value] of Object.entries(patch)) {
        if (value == null || value === "") next.delete(key);
        else next.set(key, value);
      }
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const weeksValue = (next) => (next ? formatWeeksParam(next) : null);
  const regionValue = (next) => (!next || next === "All" ? null : next.toLowerCase());

  const setRange = useCallback((next) => update({ weeks: weeksValue(next) }), [update]);
  const setRegion = useCallback((next) => update({ region: regionValue(next) }), [update]);
  /* One write for both, so the second change does not overwrite the first. */
  const setFilters = useCallback(
    (nextRange, nextRegion) => update({ weeks: weeksValue(nextRange), region: regionValue(nextRegion) }),
    [update],
  );
  const setTab = useCallback((next) => update({ tab: next === "overview" ? null : next }), [update]);

  /* The shared link always spells the weeks out, so it keeps meaning the same
     weeks after newer ones are played. */
  const shareUrl = useMemo(() => {
    const params = new URLSearchParams(searchParams);
    if (range) params.set("weeks", formatWeeksParam(range));
    const query = params.toString();
    return `${window.location.origin}${window.location.pathname}${query ? `?${query}` : ""}`;
  }, [searchParams, range]);

  return { range, region, tab, setRange, setRegion, setFilters, setTab, shareUrl };
}
