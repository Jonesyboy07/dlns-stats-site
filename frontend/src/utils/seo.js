import { useEffect } from "react";

export const BRAND = "DLNS Stats";
export const DEFAULT_DESCRIPTION =
  "Deadlock Night Shift match results, player and team statistics, hero performance and weekly standings for DLNS and Fight Night.";

/**
 * Keep the app's canonical URLs in one place. Aliases are folded into the URL the
 * server advertises in its sitemap and canonical tags, so in-app navigation never
 * leaves a page pointing at a different address than the server-rendered shell.
 */
// Routes the server serves with a trailing slash; the slash-less form redirects,
// so a canonical must keep the slash.
const TRAILING_SLASH_PATHS = new Set(["/stats", "/interviews"]);

export function canonicalPathFor(pathname) {
  let path = pathname || "/";
  if (path === "/home") return "/";
  if (path.startsWith("/users/")) path = "/player/" + path.slice("/users/".length);
  if (path.startsWith("/match/")) path = "/matches/" + path.slice("/match/".length);
  if (path !== "/" && path.endsWith("/")) path = path.replace(/\/+$/, "");
  if (!path) path = "/";
  if (TRAILING_SLASH_PATHS.has(path)) return `${path}/`;
  return path;
}

export function absoluteUrl(path) {
  const origin = window.location.origin;
  if (!path) return origin + window.location.pathname;
  if (/^https?:\/\//i.test(path)) return path;
  return origin + (path.startsWith("/") ? path : `/${path}`);
}

function setMeta(attribute, key, content) {
  let element = document.head.querySelector(`meta[${attribute}="${key}"]`);
  if (content == null || content === "") {
    if (element) element.remove();
    return;
  }
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.setAttribute("content", content);
}

function setCanonical(href) {
  let link = document.head.querySelector('link[rel="canonical"]');
  if (!link) {
    link = document.createElement("link");
    link.setAttribute("rel", "canonical");
    document.head.appendChild(link);
  }
  link.setAttribute("href", href);
}

function setJsonLd(value) {
  // `undefined` means "leave the server-rendered JSON-LD alone"; `null` clears it
  // when moving to a page that has no structured data of its own.
  if (value === undefined) return;
  const id = "dlns-page-jsonld";
  let script = document.getElementById(id);
  if (!value) {
    if (script) script.remove();
    return;
  }
  if (!script) {
    script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = id;
    document.head.appendChild(script);
  }
  script.textContent = JSON.stringify(value);
}

function breadcrumbJsonLd(items) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    "itemListElement": items.map((item, index) => ({
      "@type": "ListItem",
      "position": index + 1,
      "name": item.name,
      "item": absoluteUrl(item.path),
    })),
  };
}

function websiteJsonLd() {
  const origin = absoluteUrl("/");
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "name": BRAND,
    "alternateName": "Deadlock Night Shift Stats",
    "url": origin,
    "potentialAction": {
      "@type": "SearchAction",
      "target": `${origin}search?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };
}

export function applyPageMeta({
  title,
  description,
  canonicalPath,
  image,
  robots,
  type,
  jsonLd,
  breadcrumbs,
} = {}) {
  // Omitted fields are left alone so a page component can enrich the metadata the
  // server already rendered (or the route-level fallback) once its data arrives.
  const pageTitle = title
    ? title.toLowerCase().includes(BRAND.toLowerCase())
      ? title
      : `${title} • ${BRAND}`
    : null;

  if (pageTitle) {
    document.title = pageTitle;
    setMeta("property", "og:title", pageTitle);
    setMeta("name", "twitter:title", pageTitle);
  }
  if (description) {
    setMeta("name", "description", description);
    setMeta("property", "og:description", description);
    setMeta("name", "twitter:description", description);
  }
  if (robots) setMeta("name", "robots", robots);
  if (type) setMeta("property", "og:type", type);
  if (canonicalPath) {
    const canonical = absoluteUrl(canonicalPathFor(canonicalPath));
    setCanonical(canonical);
    setMeta("property", "og:url", canonical);
  }
  setMeta("property", "og:site_name", BRAND);
  if (image) {
    setMeta("property", "og:image", absoluteUrl(image));
    setMeta("name", "twitter:image", absoluteUrl(image));
  }
  setMeta("name", "twitter:card", "summary_large_image");

  let structured = jsonLd;
  const crumbData = breadcrumbs && breadcrumbs.length ? breadcrumbJsonLd(breadcrumbs) : null;
  if (structured && crumbData) {
    // Keep page-level schema (SportsEvent/ProfilePage/Article) alongside the trail.
    const nodes = [structured, crumbData].map((node) =>
      Object.fromEntries(Object.entries(node).filter(([key]) => key !== "@context")),
    );
    structured = { "@context": "https://schema.org", "@graph": nodes };
  } else if (structured === undefined) {
    structured = crumbData ?? undefined;
  }
  if (structured === undefined && canonicalPath && canonicalPathFor(canonicalPath) === "/") {
    structured = websiteJsonLd();
  }
  setJsonLd(structured);
}

/**
 * Page components call this once their data is loaded. Route-level defaults in
 * App.jsx run first, so the component only needs to supply the richer title.
 */
export function usePageMeta(meta) {
  const key = JSON.stringify(meta || {});
  useEffect(() => {
    applyPageMeta(JSON.parse(key));
  }, [key]);
}

const STATIC_ROUTES = {
  "/": {
    title: "DLNS Stats — Deadlock Night Shift Match Results & Stats",
    description:
      "Live Deadlock Night Shift match results, player and team stats, hero pick rates and weekly Night Shift standings.",
  },
  "/matchlist": {
    title: "Deadlock Match Results",
    description:
      "Browse recent Deadlock Night Shift and Fight Night matches with scoreboards, player stats and series results.",
  },
  "/players": {
    title: "Deadlock Player Stats & Leaderboards",
    description:
      "Deadlock Night Shift player leaderboards: win rates, KDA, hero pools and match histories for every DLNS player.",
  },
  "/teams": {
    title: "Deadlock Team Records & Rosters",
    description:
      "Deadlock Night Shift team records, rosters, hero usage and weekly results for every team in the league.",
  },
  "/heroes": {
    title: "Deadlock Hero Stats, Pick Rates & Win Rates",
    description:
      "Deadlock hero statistics from the Night Shift league: pick rate, win rate, item builds, matchups and top players per hero.",
  },
  "/items": {
    title: "Deadlock Item Stats & Builds",
    description:
      "Deadlock item usage in the Night Shift league: pick rates, win rates and the most common item builds by hero.",
  },
  "/stats/": {
    title: "Deadlock League Stats & Records",
    description:
      "League-wide Deadlock Night Shift statistics, records, averages and weekly trends across every DLNS event.",
  },
  "/week": {
    title: "Night Shift Weekly Results & Standings",
    description:
      "Night Shift weekly brackets, series results, standings and hero picks for the current DLNS event.",
  },
  "/community": {
    title: "Deadlock Community Links",
    description: "Deadlock Night Shift community links, creators, resources and ways to get involved with the league.",
  },
  "/help": {
    title: "DLNS Stats Help & Guides",
    description:
      "How to use DLNS Stats: match pages, player profiles, hero statistics and the Night Shift week view.",
  },
  "/updates": {
    title: "DLNS Stats Updates",
    description: "The latest DLNS Stats site updates and Night Shift league announcements.",
  },
  "/privacy": {
    title: "Privacy Policy",
    description: "How DLNS Stats handles analytics and visitor data.",
  },
};

const NOINDEX_ROUTES = [/^\/search$/, /^\/admin(\/|$)/, /^\/react-admin(\/|$)/];

const STATIC_CRUMBS = {
  "/matchlist": { name: "Match results", path: "/matchlist" },
  "/players": { name: "Players", path: "/players" },
  "/teams": { name: "Teams", path: "/teams" },
  "/heroes": { name: "Heroes", path: "/heroes" },
  "/items": { name: "Items", path: "/items" },
  "/stats/": { name: "League stats", path: "/stats/" },
  "/week": { name: "Night Shift weeks", path: "/week" },
  "/help": { name: "Help", path: "/help" },
  "/community": { name: "Community", path: "/community" },
  "/updates": { name: "Updates", path: "/updates" },
  "/privacy": { name: "Privacy", path: "/privacy" },
};

export function breadcrumbsForPath(canonicalPath) {
  const canonical = canonicalPathFor(canonicalPath);
  if (canonical === "/") return [];
  const home = { name: "Home", path: "/" };
  const staticCrumb = STATIC_CRUMBS[canonical];
  if (staticCrumb) return [home, staticCrumb];

  let match = /^\/matches\/(\d+)$/.exec(canonical);
  if (match) return [home, { name: `Match ${match[1]}`, path: canonical }];

  match = /^\/series\/(\d+)$/.exec(canonical);
  if (match) return [home, { name: `Series ${match[1]}`, path: canonical }];

  match = /^\/player\/(\d+)\/hero\/(\d+)$/.exec(canonical);
  if (match) {
    return [
      home,
      { name: "Players", path: "/players" },
      { name: `Player ${match[1]}`, path: `/player/${match[1]}` },
      { name: `Hero ${match[2]}`, path: canonical },
    ];
  }

  match = /^\/player\/(\d+)$/.exec(canonical);
  if (match) {
    return [home, { name: "Players", path: "/players" }, { name: `Player ${match[1]}`, path: canonical }];
  }

  match = /^\/hero\/(\d+)$/.exec(canonical);
  if (match) {
    return [home, { name: "Heroes", path: "/heroes" }, { name: `Hero ${match[1]}`, path: canonical }];
  }

  match = /^\/team\/(.+)$/.exec(canonical);
  if (match) {
    return [
      home,
      { name: "Teams", path: "/teams" },
      { name: decodeURIComponent(match[1]), path: canonical },
    ];
  }

  match = /^\/week\/(\d+)$/.exec(canonical);
  if (match) {
    return [
      home,
      { name: "Night Shift weeks", path: "/week" },
      { name: `Week ${match[1]}`, path: canonical },
    ];
  }

  if (canonical.startsWith("/interviews/")) {
    return [home, { name: "Interviews", path: "/interviews/" }, { name: "Interview", path: canonical }];
  }

  if (canonical === "/search") {
    return [home, { name: "Search", path: "/search" }];
  }

  return [home];
}

/** Fallback metadata for routes whose component has not loaded its data yet. */
export function routeMetaFor(pathname) {
  const canonical = canonicalPathFor(pathname);
  const noindex = NOINDEX_ROUTES.some((pattern) => pattern.test(pathname));
  const base = {
    canonicalPath: canonical,
    robots: noindex ? "noindex, follow" : "index, follow",
    breadcrumbs: breadcrumbsForPath(canonical),
  };
  const staticMeta = STATIC_ROUTES[canonical];
  if (staticMeta) return { ...base, ...staticMeta };

  const match = /^\/matches?\/(\d+)$/.exec(canonical);
  if (match) return { ...base, title: `Deadlock Match ${match[1]}` };

  const series = /^\/series\/(\d+)$/.exec(canonical);
  if (series) return { ...base, title: `Deadlock Series ${series[1]}` };

  const hero = /^\/hero\/(\d+)$/.exec(canonical);
  if (hero) return { ...base, title: "Deadlock Hero Stats" };

  const playerHero = /^\/player\/(\d+)\/hero\/\d+$/.exec(canonical);
  if (playerHero) return { ...base, title: "Player Hero Stats" };

  const player = /^\/player\/(\d+)$/.exec(canonical);
  if (player) return { ...base, title: "Deadlock Player Stats" };

  const team = /^\/team\/(.+)$/.exec(canonical);
  if (team) return { ...base, title: `${decodeURIComponent(team[1])} Team Stats` };

  const week = /^\/week\/(\d+)$/.exec(canonical);
  if (week) return { ...base, title: `Night Shift Week ${week[1]}` };

  return base;
}
