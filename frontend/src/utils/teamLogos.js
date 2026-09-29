import { IMAGE_CDN_BASE } from "./cdn";

/**
 * Team crest URLs.
 *
 * Crests live in a `teamLogos/` folder beside the site's other art on the images
 * CDN, so the production base FOLLOWS `IMAGE_CDN_BASE` — repointing the CDN must
 * not need a second setting. `TEAM_LOGO_CDN_BASE` (injected as
 * `window.DLNS_TEAM_LOGO_BASE`) exists only to host crests somewhere else
 * entirely, and is not needed for the normal case.
 *
 * In DEV the base is the repo's own `public/images/teamLogos` instead, because
 * Flask only injects `window.DLNS_TEAM_LOGO_BASE` into its own template — under
 * `npm run dev` there is no injection at all, so without this the dev server
 * would fetch crests from the CDN and 404 (and Cloudflare caches those misses).
 * The Vite dev server proxies `/public` to Flask so the path resolves there too.
 *
 * The filename is derived from the team name with the SAME rule the backend's
 * `_icon_key()` uses — lowercase, `&` -> "and", drop everything that is not
 * a-z / 0-9 — which collapses the hand-authored feed's casing and punctuation
 * drift for free: `ABRAHAMS`, `Abrahams` and `aBRAHAMS` all resolve to
 * `abrahams.png`, and `SLICE N DICE` / `SLICE 'N DICE` both to `slicendice.png`.
 *
 * It can NOT bridge WORD drift (a misspelt or reworded team name), so those
 * belong in ALIASES. Correcting the feed is preferable; the alias map is for
 * spellings that are never going to be fixed.
 */
const DEFAULT_TEAM_LOGO_BASE = import.meta.env?.DEV
  ? "/public/images/teamLogos"
  : `${IMAGE_CDN_BASE}/teamLogos`;

const resolveBase = () => {
  const windowBase =
    typeof window !== "undefined" && typeof window.DLNS_TEAM_LOGO_BASE === "string"
      ? window.DLNS_TEAM_LOGO_BASE
      : "";
  const envBase =
    typeof import.meta !== "undefined" ? import.meta.env?.VITE_TEAM_LOGO_BASE : "";
  return (windowBase || envBase || DEFAULT_TEAM_LOGO_BASE).trim().replace(/\/+$/, "");
};

export const TEAM_LOGO_BASE = resolveBase();

/** Filename used for a team with no crest of its own. Not a `.png`, unlike the rest. */
export const TEAM_LOGO_FALLBACK = `${TEAM_LOGO_BASE}/default.jpg`;

/**
 * Normalised team name -> normalised canonical name, for teams whose feed
 * spelling cannot be corrected. Keep keys and values in the same normalised
 * form `teamLogoKey()` produces, e.g. `{ buffenjoyer: "buffenjoyers" }`.
 */
const ALIASES = {};

/** A team name reduced to its crest filename stem. Mirrors backend `_icon_key()`. */
export const teamLogoKey = (teamName) =>
  String(teamName ?? "")
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]/g, "");

/** e.g. `"MELEE CREEPS"` -> `<base>/meleecreeps.png`. */
export const teamLogoUrl = (teamName) => {
  const normalized = teamLogoKey(teamName);
  if (!normalized) return TEAM_LOGO_FALLBACK;
  return `${TEAM_LOGO_BASE}/${ALIASES[normalized] || normalized}.png`;
};
