import { useSearchParams } from "react-router-dom";

/**
 * Small "where was I" view state kept in a URL search param.
 *
 * Used for the team/player tab bars and the Player × Hero view switches, so a
 * refresh — or a link you paste to someone — lands on the same view instead of
 * snapping back to the default.
 *
 * The DEFAULT value is left out of the URL rather than written into it, so a
 * plain `/team/x` stays clean and the default lives only in code. Values are
 * matched case-insensitively and written lowercase (`?tab=series`), so a
 * hand-typed URL works, and anything unrecognised falls back to the default
 * instead of rendering an empty panel.
 *
 * `replace: true` mirrors how PlayerMatchTable already syncs its filters — these
 * are view switches, not navigation, so they should not fill the back button.
 * Params this control does not own are preserved, which is what lets several of
 * them coexist on one page.
 *
 * `allowed` holds the canonical values (`["Overview","Series","Players"]`, or a
 * list of ids); the returned value is one of those, so callers keep comparing
 * against the same labels they always did.
 */
export function useUrlParam(key, allowed, defaultValue) {
  const [searchParams, setSearchParams] = useSearchParams();
  const requested = (searchParams.get(key) || "").toLowerCase();
  const active =
    allowed.find((value) => value.toLowerCase() === requested) ?? defaultValue;

  const setValue = (next) => {
    const params = new URLSearchParams(searchParams);
    if (!next || next === defaultValue) params.delete(key);
    else params.set(key, next.toLowerCase());
    setSearchParams(params, { replace: true });
  };

  return [active, setValue];
}
