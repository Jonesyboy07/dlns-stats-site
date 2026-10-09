import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import heroMeta from "../../../data/hero_meta.json";
import { cdnImage, staticImagePathToCdn } from "../utils/cdn";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import MatchHeader from "../components/MatchHeader";
import { heroIconUrl } from "../components/HeroIcon";
import { SOUL_SOURCE_LABELS } from "../utils/soulSources";
import { buildTimelineRows, clock } from "../utils/matchTimeline";
import { mapVersionForMatch } from "../utils/matchMap";
import MatchMap from "../components/MatchMap";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Filler,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

// Dashed vertical line at the hovered x position for the Souls Difference chart.
const verticalHoverLine = {
  id: "verticalHoverLine",
  afterDraw(chart) {
    const active = chart.getActiveElements();
    if (!active.length) return;
    const x = active[0].element.x;
    const { ctx, chartArea } = chart;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.stroke();
    ctx.restore();
  },
};

// ── Player-name shadow angle per team ──
// text-shadow-x = horizontal offset (px); positive = shadow to the right, negative = left.
// Edit these two numbers to angle each team's name shadow (e.g. Archmother / Hidden King).
const NAME_SHADOW_X = {
  amber: "3px",
  sapphire: "-3px",
};

// Shared drop-shadow values for player names (desktop + mobile stay in sync).
const nameShadowVars = (side) => ({
  "--text-shadow-x": NAME_SHADOW_X[side] ?? "3px",
  "--text-shadow-y": "3px",
  "--text-shadow-blur": "1px",
  "--text-shadow-color": "rgba(0, 0, 0, 1)",
});

// Metrics available in the "By Player" leaderboard. Add more entries here later
// to extend the selector (key = the player stat field).
const PLAYER_METRICS = [
  { key: "net_worth", label: "Souls" },
  { key: "player_damage", label: "Damage" },
  { key: "obj_damage", label: "Objective Damage" },
  { key: "player_healing", label: "Healing" },
];

// Section titles in the Graphs tab (design-system heading style).
const GRAPH_SECTION_LABEL =
  "font-valve-oracle font-semibold text-[14px] uppercase tracking-[0.08em] text-muted";

// Souls Difference draws on a canvas, so it cannot use the CSS classes App.css
// exposes — these mirror --color-team-amber / --color-team-sapphire.
const CHART_AMBER = "oklch(0.8016 0.1705 73.27)";
const CHART_SAPPHIRE = "oklch(0.5542 0.246471 261.4449)";
const withAlpha = (color, alpha) => color.replace(")", ` / ${alpha})`);
const CHART_AMBER_FILL = withAlpha(CHART_AMBER, 0.35);
const CHART_SAPPHIRE_FILL = withAlpha(CHART_SAPPHIRE, 0.35);

// Soul-source labels live in utils/soulSources.js so the player profile's Souls
// Profile panel and this tooltip share one map.

// ── Damage-source labels (deadlock-api damage_matrix source names) ──
// Ability display names come from data/hero_meta.json (image filenames carry the
// internal key); item names come from the /db/items/names catalog. Weapon/Melee are
// recognised by name pattern; anything else falls back to a cleaned-up name.
const ABILITY_KEY_BY_HERO = {};
Object.entries(heroMeta).forEach(([heroId, meta]) => {
  const map = {};
  (meta?.abilities || []).forEach((a) => {
    const img = a.image || "";
    const key = img.split(/[\\/]/).pop().replace(/_psd\.png$/i, "").toLowerCase();
    if (key && a.name) map[key] = a.name;
  });
  ABILITY_KEY_BY_HERO[heroId] = map;
});

const normalizeSourceKey = (src) =>
  src
    .toLowerCase()
    .replace(/^citadel_ability_/, "")
    .replace(/^ability_/, "")
    .replace(/^citadel_weapon_/, "")
    .replace(/^citadel_/, "")
    .replace(/^weapon_/, "")
    .replace(/_crit$/, "")
    .replace(/_amp$/, "")
    .trim();

const isCritSource = (src) => /_crit/i.test(src);

const isHeadshotSource = (src) => {
  const s = src.toLowerCase();
  return s === "upgrade_headhunter" || s === "upgrade_headshot_booster" || s === "headshot";
};

const isBulletSource = (src) => {
  const s = src.toLowerCase();
  if (isCritSource(s)) return false;
  return s === "bullet" || s.startsWith("citadel_weapon");
};

const isMeleeSource = (src) => {
  const s = src.toLowerCase();
  if (s.startsWith("upgrade_") || s.startsWith("item_") || s.startsWith("mods_")) return false;
  return s === "melee" || /melee/.test(s);
};

const cleanFallback = (src) =>
  src
    .replace(/^citadel_/, "")
    .replace(/^ability_/, "")
    .replace(/^upgrade_/, "")
    .replace(/^item_/, "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();

const damageSourceLabel = (src, heroId, itemNames) => {
  const key = normalizeSourceKey(src);
  const abilityMap = ABILITY_KEY_BY_HERO[String(heroId)] || {};
  if (abilityMap[key]) return abilityMap[key];
  if (isCritSource(src)) return "Crits";
  if (isHeadshotSource(src)) return "Headshots";
  if (isBulletSource(src)) return "Bullets";
  if (isMeleeSource(src)) return "Melee";
  if (src === "Ability") return "Abilities";
  const itemName = itemNames?.[src];
  if (itemName) return itemName;
  return cleanFallback(src);
};

function HeroIcon({ src, name, className = "w-8 h-8", rounded = "rounded-md" }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  // Last-resort net for an image that fires neither load nor error. The timeout
  // has to be GENEROUS and the <img> must NOT be lazy: a lazy image that is
  // off-screen never starts loading, so a short timer marks every
  // below-the-fold icon as failed and unmounts it — meaning it can never load
  // later, even once scrolled into view. 404s are caught by onError below.
  useEffect(() => {
    const t = setTimeout(() => {
      const img = imgRef.current;
      if (img && !(img.complete && img.naturalWidth > 0)) {
        setFailed(true);
      }
    }, 10000);
    return () => clearTimeout(t);
  }, [src]);
  if (failed) {
    return (
      <div
        className={`${className} ${rounded} bg-gray-700/80 flex items-center justify-center text-[10px] font-bold text-gray-200 uppercase select-none`}
        title={name}
      >
        {String(name || "?").replace("Hero ", "").slice(0, 2)}
      </div>
    );
  }
  return (
    <img
      ref={imgRef}
      src={src}
      alt={name}
      className={`${className} ${rounded} object-cover`}
      title={name}
      onError={() => setFailed(true)}
      onLoad={() => setFailed(false)}
    />
  );
}

function MatchDetail() {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [players, setPlayers] = useState([]);
  const [adjacentMatches, setAdjacentMatches] = useState({
    previous_match_id: null,
    next_match_id: null,
  });
  const [weekMeta, setWeekMeta] = useState(null);
  const [heroes, setHeroes] = useState({});
  const [bans, setBans] = useState([]);
  const [buildByPlayer, setBuildByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("graphs");
  const [activeSoulsMetric, setActiveSoulsMetric] = useState("net_worth");
  const [itemNames, setItemNames] = useState({});
  const [timeline, setTimeline] = useState(null);
  const [matchEvents, setMatchEvents] = useState(null);
  const [fetchErrors, setFetchErrors] = useState([]);
  const [seriesGames, setSeriesGames] = useState(null);
  const [seriesTitle, setSeriesTitle] = useState("");
  // Build tab: focused player (default view) vs. "See all" side-by-side view.
  const [buildSeeAll, setBuildSeeAll] = useState(false);
  const [buildFocusId, setBuildFocusId] = useState(null);

  useEffect(() => {
    fetchHeroes();
    fetchItemNames();
    fetchMatchPlayers();
    fetchAdjacentMatches();
    fetchBans();
    fetchMatchBuild();
    fetchWeekMeta();
    fetchTimeline();
    fetchMatchEvents();
    fetchSeriesGames();
  }, [matchId]);

  const fetchSeriesGames = async () => {
    try {
      const res = await fetch(`/db/series/${matchId}`);
      if (res.ok) {
        const data = await res.json();
        const matches = data?.matches;
        setSeriesTitle(data?.series_title || "");
        if (Array.isArray(matches) && matches.length > 0) {
          const games = matches
            .map((m) => ({ game: m.event_game, matchId: m.match_id }))
            .filter((g) => g.game);
          setSeriesGames(games);
        }
      }
    } catch {
      // ignore
    }
  };

  const fetchTimeline = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/timeline`);
      if (response.ok) {
        const data = await response.json();
        setTimeline(data);
      }
    } catch (err) {
      setFetchErrors((prev) => [...prev, "timeline"]);
    }
  };

  // What happened, in order: objectives, mid boss and kills.
  const fetchMatchEvents = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/events`);
      if (response.ok) {
        setMatchEvents(await response.json());
      }
    } catch (err) {
      setFetchErrors((prev) => [...prev, "match events"]);
    }
  };

  const fetchHeroes = async () => {
    try {
      const response = await fetch("/db/heroes");
      if (response.ok) {
        const data = await response.json();
        setHeroes(data);
      }
    } catch (err) {
      setFetchErrors((prev) => [...prev, "heroes"]);
    }
  };

  const fetchItemNames = async () => {
    try {
      const response = await fetch("/db/items/names");
      if (response.ok) {
        const data = await response.json();
        setItemNames(data || {});
      }
    } catch {
      // ignore - fall back to cleaned-up names
    }
  };

  const fetchMatchPlayers = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/db/matches/${matchId}/players`);
      if (!response.ok) {
        throw new Error("Failed to fetch match details");
      }
      const data = await response.json();
      setPlayers(data.players || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdjacentMatches = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/adjacent`);
      if (response.ok) {
        const data = await response.json();
        setAdjacentMatches(data);
      }
    } catch (err) {
      setFetchErrors((prev) => [...prev, "adjacent matches"]);
    }
  };

  // Hero bans entered in the bracket editor; most matches have none.
  const fetchBans = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/bans`);
      if (response.ok) {
        const data = await response.json();
        setBans(Array.isArray(data.bans) ? data.bans : []);
      }
    } catch {
      setBans([]);
    }
  };

  const fetchMatchBuild = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/build`);
      if (response.ok) {
        const data = await response.json();
        setBuildByPlayer(data);
      }
    } catch (err) {
      setFetchErrors((prev) => [...prev, "build"]);
    }
  };

  const formatGameTime = (s) => {
    if (s == null) return "";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const fetchWeekMeta = async () => {
    try {
      const response = await fetch('/db/weeks');
      if (!response.ok) return;
      const data = await response.json();
      const key = String(matchId);
      const details = data?.details?.[key] || null;
      const week = details?.week ?? data?.weeks?.[key] ?? null;
      setWeekMeta({
        title: data?.title || null,
        series: details?.series || null,
        week,
      });
    } catch (err) {
      setFetchErrors((prev) => [...prev, "week metadata"]);
    }
  };

  const getLocalItemImage = (item) => {
    if (!item.name) return item.image || null;
    const filename = item.name.toLowerCase().replace(/ /g, "_") + "_psd.png";
    const folder = item.item_tier === 5 ? "legendaries" : item.item_slot_type;
    return folder ? cdnImage(`items/${folder}/${filename}`) : staticImagePathToCdn(item.image || null);
  };

  const getHeroName = (heroId) => {
    const hero = heroes[heroId];
    return hero?.name || hero || `Hero ${heroId}`;
  };

  // Shared with the rest of the site: the square icon filenames spell "&" out as
  // "and" ("mo_and_krill_sm_psd.png"), which a plain space-to-underscore rule
  // misses — it produced "mo_&_krill_sm_psd.png" and fell back to initials.
  const getHeroIcon = (heroId) => heroIconUrl(getHeroName(heroId));

  const previousMatchId = adjacentMatches.previous_match_id;
  const nextMatchId = adjacentMatches.next_match_id;

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    const day = date.getDate();
    const ordinal = (d) => {
      if (d >= 11 && d <= 13) return "th";
      switch (d % 10) {
        case 1:
          return "st";
        case 2:
          return "nd";
        case 3:
          return "rd";
        default:
          return "th";
      }
    };
    const month = date.toLocaleString("en-GB", { month: "long" });
    const year = date.getFullYear();
    const time = date.toLocaleString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${month} ${day}${ordinal(day)} ${year} | ${time}`;
  };

  const formatK = (value) => {
    const n = Number(value) || 0;
    if (n >= 1000) {
      return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
    }
    return n.toString();
  };

  if (loading) {
    return <LoadingSkeleton variant="detail" />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  // Separate players by team
  const amberPlayers = players.filter((p) => p.team === 0);
  const sapphirePlayers = players.filter((p) => p.team === 1);

  const amberTotalSouls = amberPlayers.reduce((sum, p) => sum + (p.net_worth || 0), 0);
  const sapphireTotalSouls = sapphirePlayers.reduce((sum, p) => sum + (p.net_worth || 0), 0);

  const totalSouls = amberTotalSouls + sapphireTotalSouls;
  const amberPct = totalSouls > 0 ? (amberTotalSouls / totalSouls) * 100 : 50;

  const amberSorted = [...amberPlayers].sort((a, b) => (b.net_worth || 0) - (a.net_worth || 0));
  const sapphireSorted = [...sapphirePlayers].sort((a, b) => (b.net_worth || 0) - (a.net_worth || 0));

  // Combined players sorted by the active stat for the "By Player" leaderboard.
  const allPlayersSorted = [...amberPlayers, ...sapphirePlayers].sort(
    (a, b) => (b[activeSoulsMetric] || 0) - (a[activeSoulsMetric] || 0)
  );
  const maxMetricValue = allPlayersSorted.reduce(
    (m, p) => Math.max(m, p?.[activeSoulsMetric] || 0),
    0
  );

  const formatSouls = (value) => {
    const n = Number(value) || 0;
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return n.toString();
  };

  // Axis labels for the By Player scale (0 → max, 5 steps).
  const metricAxisTicks = Array.from({ length: 5 }, (_, i) =>
    formatSouls(Math.round((maxMetricValue * i) / 4))
  );

  // Summarises lead swings for the Souls Difference panel, e.g.
  // "Bird led until 17:20; largest swing 26:00–31:00".
  const buildDiffCaption = (diff, labels, amberName, sapphireName) => {
    if (diff.length < 2) return null;

    // Find the last time the lead changed hands.
    let lastCross = -1;
    for (let i = 1; i < diff.length; i += 1) {
      const a = diff[i - 1];
      const b = diff[i];
      if ((a < 0 && b >= 0) || (a >= 0 && b < 0)) lastCross = i;
    }

    const parts = [];
    if (lastCross > 0) {
      const before = diff[lastCross - 1];
      const time = labels[lastCross];
      if (before < 0 && sapphireName) parts.push(`${sapphireName} led until ${time}`);
      else if (before >= 0 && amberName) parts.push(`${amberName} led until ${time}`);
    }

    // Find the largest single-direction swing (biggest monotonic run).
    const findRun = (sign) => {
      let best = { start: 0, end: 0, sum: 0 };
      let curStart = 0;
      let curSum = 0;
      for (let i = 1; i < diff.length; i += 1) {
        const d = (diff[i] - diff[i - 1]) * sign;
        if (d > 0) {
          curSum += d;
          if (curSum > best.sum) best = { start: curStart, end: i, sum: curSum };
        } else {
          curSum = 0;
          curStart = i;
        }
      }
      return best;
    };
    const rise = findRun(1);
    const fall = findRun(-1);
    const swing = rise.sum >= fall.sum ? rise : fall;
    if (swing.sum > 0 && swing.end > swing.start) {
      parts.push(`largest swing ${labels[swing.start]}–${labels[swing.end]}`);
    }

    return parts.length ? parts.join("; ") : null;
  };

  // Resolve winning side from match metadata first; fallback to player results if needed.
  const winnerPlayer = players.find((p) => p.result === "Win");
  const winningTeam =
    adjacentMatches.winning_team != null
      ? Number(adjacentMatches.winning_team)
      : winnerPlayer != null
        ? winnerPlayer.team
        : null;

  // event_team_a_ingame_side tells which in-game side Team A played on (0 Amber, 1 Sapphire).
  const teamASide =
    adjacentMatches.event_team_a_ingame_side != null
      ? Number(adjacentMatches.event_team_a_ingame_side)
      : 0;
  const eventTeamA = adjacentMatches.event_team_a || null;
  const eventTeamB = adjacentMatches.event_team_b || null;
  const amberTeamName = teamASide === 0 ? (eventTeamA || eventTeamB) : (eventTeamB || eventTeamA);
  const sapphireTeamName = teamASide === 0 ? (eventTeamB || eventTeamA) : (eventTeamA || eventTeamB);

  // Timeline rows drive both the map markers and the list under it.
  const timelineRows = buildTimelineRows(
    matchEvents?.events || [],
    players,
    (team) => (team === 0 ? amberTeamName : sapphireTeamName) || "Unknown",
  );
  // Which minimap layout this match was played on (null when the start time is unknown).
  const mapVersion = mapVersionForMatch(adjacentMatches);
  // Lane objectives carry their lane colour; everything else sits on a side.
  const timelineMarkerColor = (row) =>
    row.laneColor || (row.team === 0 ? CHART_AMBER : row.team === 1 ? CHART_SAPPHIRE : "#94a3b8");

  // --- Laning / scoreboard helpers ---
  // `assigned_lane` values are reported by the game (current 3-duo-lane map):
  // DLNS league's 3-lane map — game lane ids and their callouts:
  // 1 = York (Yellow), 4 = Broadway (Blue), 6 = Greenwich (Green) — lane ids and
  // their colours as the game reports them.
  const LANE_META = {
    1: { name: "York", color: "#facc15" },
    4: { name: "Broadway", color: "#22d3ee" },
    6: { name: "Greenwich", color: "#4ade80" },
  };
  const LANE_ORDER = [1, 4, 6];

  const laneMetaOf = (player) => LANE_META[Number(playerLane(player))] || null;

  // Prefer the positionally-inferred lane (lane_real) when available; fall back to the
  // game's assigned_lane (lane). lane_real corrects early-game lane swaps.
  const playerLane = (player) => player?.lane_real ?? player?.lane;

  // Group each team's players by lane so mirrored rows show who lanes against who.
  const groupByLane = (teamPlayers) => {
    const map = {};
    for (const p of teamPlayers) {
      const lane = Number(playerLane(p)) || 0;
      (map[lane] ||= []).push(p);
    }
    Object.values(map).forEach((list) =>
      list.sort((a, b) => (a.player_slot || 0) - (b.player_slot || 0))
    );
    return map;
  };
  const amberByLane = groupByLane(amberPlayers);
  const sapphireByLane = groupByLane(sapphirePlayers);

  const laneIds = [...new Set([
    ...Object.keys(amberByLane).map(Number),
    ...Object.keys(sapphireByLane).map(Number),
  ])].filter((id) => id > 0).sort(
    (a, b) => (LANE_ORDER.indexOf(a) + 1 || 99) - (LANE_ORDER.indexOf(b) + 1 || 99) || a - b
  );

  const scoreboardRows = [];
  laneIds.forEach((laneId) => {
    const left = amberByLane[laneId] || [];
    const right = sapphireByLane[laneId] || [];
    const rows = Math.max(left.length, right.length);
    for (let i = 0; i < rows; i += 1) {
      scoreboardRows.push({ laneId, left: left[i] || null, right: right[i] || null });
    }
  });
  // Players without a known lane still get rows (center shows "—").
  const unpairedLeft = amberPlayers.filter((p) => !laneMetaOf(p));
  const unpairedRight = sapphirePlayers.filter((p) => !laneMetaOf(p));
  const extraRows = Math.max(unpairedLeft.length, unpairedRight.length);
  for (let i = 0; i < extraRows; i += 1) {
    scoreboardRows.push({ laneId: null, left: unpairedLeft[i] || null, right: unpairedRight[i] || null });
  }

  // Team K/D/A totals for the scoreboard header.
  const sumKda = (teamPlayers) =>
    teamPlayers.reduce(
      (acc, p) => ({
        k: acc.k + (p.kills || 0),
        d: acc.d + (p.deaths || 0),
        a: acc.a + (p.assists || 0),
      }),
      { k: 0, d: 0, a: 0 }
    );
  const amberKda = sumKda(amberPlayers);
  const sapphireKda = sumKda(sapphirePlayers);

  // Highest value per stat category across ALL players (both teams),
  // so a single best cell is highlighted per category.
  const STAT_KEYS = ["player_healing", "obj_damage", "net_worth", "player_damage"];
  const globalMax = Object.fromEntries(
    STAT_KEYS.map((k) => [
      k,
      [...amberPlayers, ...sapphirePlayers].reduce((m, p) => Math.max(m, p?.[k] || 0), 0),
    ])
  );

  const statCell = (player, columnKey, align, side) => {
    const base = "text-secondary";
    const max = globalMax[columnKey] || 0;
    const value = player?.[columnKey] || 0;
    const isTop = value > 0 && value === max;
    const color = isTop ? "text-accent-light" : base;
    return (
      <td
        className={`py-2 px-2 text-[14px] font-semibold ${align} ${color} ${isTop ? "font-bold" : ""}`}
        title={(player?.[columnKey] || 0).toLocaleString()}
      >
        {formatK(player?.[columnKey])}
      </td>
    );
  };

  const renderPlayerCell = (player, side) => {
    if (!player) return null;
    // Player name uses the team colour — set the actual colours in
    // frontend/src/App.css @theme: --color-team-amber / --color-team-sapphire.
    const nameColor = side === "amber" ? "text-amber-100/90" : "text-blue-200/90";
    // Drop shadow behind the name — move the shadow angle by editing
    // the --text-shadow-x / --text-shadow-y values below.
    const shadowVars = nameShadowVars(side);
    const nameLink = player.account_id ? (
      <Link
        to={`/player/${player.account_id}`}
        className={`block px-1 w-[120px] truncate font-semibold text-lg text-stroke-0.25 text-stroke-color-black text-shadow ${nameColor}`}
        style={shadowVars}
        title={player.persona_name || "Anonymous"}
      >
        <span className="hover:underline-text">{player.persona_name || "Anonymous"}</span>
      </Link>
    ) : (
      <span
        className={`block w-[120px] truncate font-semibold text-md text-shadow ${nameColor}`}
        style={shadowVars}
        title={player.persona_name || "Anonymous"}
      >
        {player.persona_name || "Anonymous"}
      </span>
    );
    const hero = player.hero_id ? (
      <Link to={`/hero/${player.hero_id}`} title={getHeroName(player.hero_id)} className="shrink-0">
        <HeroIcon
          src={getHeroIcon(player.hero_id)}
          name={getHeroName(player.hero_id)}
          className={`w-[38px] h-[38px] border ${
            side === "amber" ? "border-team-amber/45" : "border-team-sapphire/60"
          }`}
          rounded="rounded-lg"
        />
      </Link>
    ) : null;
    const kda = (
      <span className="text-[12px] px-1 text-dim">
        <span className="text-success">{player.kills || 0}</span>
        <span className="text-dim"> / </span>
        <span className="text-danger-text">{player.deaths || 0}</span>
        <span className="text-dim"> / </span>
        <span className="text-warning">{player.assists || 0}</span>
      </span>
    );
    if (side === "amber") {
      return (
        <div className="flex items-center justify-end gap-3">
          <div className="flex flex-col items-end shrink-0">
            {nameLink}
            {kda}
          </div>
          {hero}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-3">
        {hero}
        <div className="flex flex-col items-start shrink-0">
          {nameLink}
          {kda}
        </div>
      </div>
    );
  };

  const displayEventTitle =
    adjacentMatches.event_title || weekMeta?.series || weekMeta?.title || null;
  const displayEventWeek =
    adjacentMatches.event_week != null ? adjacentMatches.event_week : weekMeta?.week;

  return (
    <div className="w-full p-8">
      {fetchErrors.length > 0 && (
        <div className="mb-4 max-w-3xl mx-auto rounded-lg border border-warning-border bg-warning-bg p-4 text-center">
          <p className="text-warning text-sm font-medium">
            Some data failed to load: {fetchErrors.join(", ")}
          </p>
        </div>
      )}

      <MatchHeader
        matchId={matchId}
        weekLabel={displayEventTitle ? (displayEventWeek != null ? `${displayEventTitle} #${displayEventWeek}` : displayEventTitle) : ""}
        weekUrl={displayEventTitle && displayEventWeek != null ? `/week/${displayEventWeek}?event_title=${encodeURIComponent(displayEventTitle)}` : undefined}
        date={adjacentMatches.start_time ? formatDate(adjacentMatches.start_time) : ""}
        winner={winningTeam === 0 ? "amber" : winningTeam === 1 ? "sapphire" : null}
        games={seriesGames || (adjacentMatches.event_game ? [{ game: adjacentMatches.event_game, matchId }] : [])}
        activeGame={adjacentMatches.event_game}
        seriesUrl={`/series/${matchId}`}
        setTitle={seriesTitle}
        vodUrl={adjacentMatches.match_vod || ""}
        amberTeamName={amberTeamName}
        sapphireTeamName={sapphireTeamName}
        amberSouls={amberTotalSouls}
        sapphireSouls={sapphireTotalSouls}
        amberKda={amberKda}
        sapphireKda={sapphireKda}
        amberBans={bans.filter((b) => b.side === 0).map((b) => ({ ...b, name: getHeroName(b.hero_id) }))}
        sapphireBans={bans.filter((b) => b.side === 1).map((b) => ({ ...b, name: getHeroName(b.hero_id) }))}
      />

      {/* Scoreboard */}
      <div className="mb-6 w-full max-w-[1300px] mx-auto">
        {/* Mirrored scoreboard (desktop only) */}
        <div className="scroll-thin hidden lg:block text-secondary bg-card border border-border-light rounded-b-xl shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] overflow-hidden overflow-x-auto">
          <table className="w-full min-w-[1180px] table-fixed border-separate border-spacing-0">
            <colgroup>
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "18.5%" }} />
              <col style={{ width: "9%" }} />
              <col style={{ width: "18.5%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "7.5%" }} />
              <col style={{ width: "6.5%" }} />
              <col style={{ width: "6.5%" }} />
            </colgroup>
            <thead>
              <tr className="font-valve-oracle font-semibold text-[12px] uppercase tracking-[0.08em] text-muted border-b border-border-light divide-x divide-border bg-table">
                <th className="py-3 px-2 text-center border-t-2 border-t-team-amber">Heal</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-amber">Obj</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-amber">Souls</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-amber">DMG</th>
                <th className="py-3 px-4 text-right border-t-2 border-t-team-amber">Player</th>
                <th className="py-3 px-3 text-center border-t-2 border-t-border-light">Lane</th>
                <th className="py-3 px-4 text-left border-t-2 border-t-team-sapphire">Player</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-sapphire">DMG</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-sapphire">Souls</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-sapphire">Obj</th>
                <th className="py-3 px-2 text-center border-t-2 border-t-team-sapphire">Heal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {scoreboardRows.map((row, idx) => {
                const meta = row.laneId ? LANE_META[row.laneId] : null;
                const zebra = idx % 2 === 0;
                return (
                  <tr key={idx} className={`divide-x divide-border transition-colors hover:bg-accent-bg ${zebra ? "bg-card" : "bg-table"}`}>
                    {/* Left half */}
                    {statCell(row.left, "player_healing", "text-center", "amber")}
                    {statCell(row.left, "obj_damage", "text-center", "amber")}
                    {statCell(row.left, "net_worth", "text-center", "amber")}
                    {statCell(row.left, "player_damage", "text-center", "amber")}
                    <td className="py-2 px-4 text-right">{renderPlayerCell(row.left, "amber")}</td>

                    {/* Center lane */}
                    <td className="py-2 px-3 text-center bg-white/[0.025]">
                      <div className="flex items-center justify-center gap-2">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ background: meta?.color || "#4b5563" }}
                        />
                        <span className="text-[13px] font-semibold text-secondary">{meta?.name || "—"}</span>
                      </div>
                    </td>

                    {/* Right half (mirrored) */}
                    <td className="py-2 px-4 text-left">{renderPlayerCell(row.right, "sapphire")}</td>
                    {statCell(row.right, "player_damage", "text-center", "sapphire")}
                    {statCell(row.right, "net_worth", "text-center", "sapphire")}
                    {statCell(row.right, "obj_damage", "text-center", "sapphire")}
                    {statCell(row.right, "player_healing", "text-center", "sapphire")}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Mobile scoreboard (stacked per team) */}
        <div className="lg:hidden space-y-4">
          {[
            {
              teamPlayers: amberSorted,
              teamName: amberTeamName || "Amber",
              isAmber: true,
              totalSouls: amberTotalSouls,
            },
            {
              teamPlayers: sapphireSorted,
              teamName: sapphireTeamName || "Sapphire",
              isAmber: false,
              totalSouls: sapphireTotalSouls,
            },
          ].map(({ teamPlayers, teamName, isAmber, totalSouls }) => (
            <div
              key={isAmber ? "amber" : "sapphire"}
              className="bg-card rounded-xl border border-border-light overflow-hidden"
            >
              {/* Team header */}
              <div
                className={`px-4 py-2.5 flex items-center justify-between border-b border-border ${
                  isAmber ? "bg-team-amber/10" : "bg-team-sapphire/10"
                }`}
              >
                <span
                  className={`text-sm font-bold uppercase tracking-wide truncate ${
                    isAmber ? "text-team-amber" : "text-blue-300"
                  }`}
                >
                  {teamName}
                </span>
                <span
                  className={`text-sm font-bold shrink-0 ${
                    isAmber ? "text-team-amber" : "text-blue-300"
                  }`}
                >
                  {totalSouls.toLocaleString()}
                  <span className="ml-1 text-[10px] font-semibold uppercase tracking-wider opacity-70">
                    souls
                  </span>
                </span>
              </div>

              {/* Player table */}
              <table className="w-full table-fixed text-sm">
                <colgroup>
                  <col style={{ width: "36%" }} />
                  <col style={{ width: "25%" }} />
                  <col style={{ width: "20%" }} />
                  <col style={{ width: "19%" }} />
                </colgroup>
                <thead>
                  <tr className="font-valve-oracle font-semibold text-[11px] uppercase tracking-[0.08em] text-muted border-b border-border-light bg-table">
                    <th className="py-1.5 pl-3 text-left">Player</th>
                    <th className="py-1.5 text-right">K/D/A</th>
                    <th className="py-1.5 text-right">Souls</th>
                    <th className="py-1.5 pr-3 text-right">DMG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {teamPlayers.map((player) => (
                    <tr key={player.account_id} className="transition-colors hover:bg-accent-bg">
                      {/* Player */}
                      <td className="py-2 pl-3">
                        <Link
                          to={`/player/${player.account_id}`}
                          className={`flex items-center gap-2 text-shadow ${
                            isAmber ? "text-amber-100/90" : "text-blue-200/90"
                          }`}
                          style={nameShadowVars(isAmber ? "amber" : "sapphire")}
                          title={player.persona_name || "Anonymous"}
                        >
                          <HeroIcon
                            src={getHeroIcon(player.hero_id)}
                            name={getHeroName(player.hero_id)}
                            className="w-7 h-7 shrink-0"
                          />
                          <span className="truncate hover:underline-text">
                            {player.persona_name || "Anonymous"}
                          </span>
                        </Link>
                      </td>
                      {/* K/D/A */}
                      <td className="py-2 text-right whitespace-nowrap">
                        <span className="text-success font-medium">{player.kills || 0}</span>
                        <span className="text-dim">/</span>
                        <span className="text-danger-text font-medium">{player.deaths || 0}</span>
                        <span className="text-dim">/</span>
                        <span className="text-warning font-medium">{player.assists || 0}</span>
                      </td>
                      {/* Souls */}
                      <td className="py-2 text-right text-secondary font-medium whitespace-nowrap">
                        {formatK(player.net_worth).toUpperCase()}
                      </td>
                      {/* DMG */}
                      <td className="py-2 pr-3 text-right text-secondary font-medium whitespace-nowrap">
                        {formatK(player.player_damage).toUpperCase()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>

      {/* Tabs below scoreboard */}
      <div className="flex items-center gap-1 mb-4 border-b border-border-light">
        {["graphs", "build", "timeline"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-[18px] py-2.5 -mb-px font-valve-oracle text-sm font-semibold capitalize transition-colors ${
              activeTab === tab
                ? "text-primary border-b-2 border-accent"
                : "text-dim hover:text-secondary border-b-2 border-transparent"
            }`}
          >
            {tab}
          </button>
        ))}
        {activeTab === "build" && (
          <button
            type="button"
            role="switch"
            aria-checked={buildSeeAll}
            onClick={() => setBuildSeeAll((v) => !v)}
            className="ml-auto flex items-center gap-2.5 px-1 py-1.5 select-none"
          >
            <span className="text-[13px] font-semibold text-secondary">See all</span>
            <span
              className={`relative w-[38px] h-5 rounded-full border border-border-light transition-colors duration-200 ${
                buildSeeAll ? "bg-accent" : "bg-hover"
              }`}
            >
              <span
                className={`absolute top-0.5 left-0.5 w-3.5 h-3.5 rounded-full bg-primary transition-transform duration-200 ease-[cubic-bezier(.4,0,.2,1)] ${
                  buildSeeAll ? "translate-x-[18px]" : ""
                }`}
              />
            </span>
          </button>
        )}
      </div>

      {/* Timeline tab: where it happened, then a plain list of what happened. */}
      {activeTab === "timeline" && (
        <div className="mb-6 bg-card border border-border-light rounded-xl shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] p-6">
          <h3 className={GRAPH_SECTION_LABEL}>Timeline</h3>
          {matchEvents == null ? (
            <p className="mt-3 text-sm text-dim">Loading…</p>
          ) : timelineRows.length === 0 ? (
            <p className="mt-3 text-sm text-dim">No timeline recorded for this match yet.</p>
          ) : (
            <>
              <MatchMap rows={timelineRows} version={mapVersion} className="mt-4" />
              <ol className="mt-5 flex flex-col">
                {timelineRows.map((row) => (
                  <li
                    key={row.key}
                    className="flex items-center gap-3 py-1.5 border-b border-border-light/40 last:border-b-0"
                  >
                    <span className="w-12 shrink-0 text-right font-valve-oracle text-[13px] tabular-nums text-dim">
                      {clock(row.time_s)}
                    </span>
                    <span
                      className="w-2 h-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: timelineMarkerColor(row) }}
                      aria-hidden="true"
                    />
                    {row.heroId != null && (
                      <HeroIcon
                        src={getHeroIcon(row.heroId)}
                        name={getHeroName(row.heroId)}
                        className="w-5 h-5"
                      />
                    )}
                    <span className="text-sm text-secondary">{row.text}</span>
                    {row.killerHeroId != null && (
                      <span className="text-[11px] whitespace-nowrap text-dim">
                        {getHeroName(row.killerHeroId)}
                      </span>
                    )}
                    {row.damage ? (
                      <span className="ml-auto text-xs tabular-nums whitespace-nowrap text-dim">
                        {formatK(row.damage)} damage
                      </span>
                    ) : null}
                  </li>
                ))}
              </ol>
            </>
          )}
        </div>
      )}

      {/* Graphs tab */}
      {activeTab === "graphs" && players.length > 0 && (
        <div className="mb-6 bg-card border border-border-light rounded-xl shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] p-6 flex flex-col gap-8">
          {/* ---- Souls Comparison ---- */}
          <div className="flex flex-col gap-3">
            <h3 className={GRAPH_SECTION_LABEL}>Souls Comparison</h3>

            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto] gap-4 items-end">
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="font-valve-pulp text-[36px] leading-none text-team-amber tabular-nums">
                  {amberTotalSouls.toLocaleString()}
                </span>
                <span className="text-[12px] font-semibold text-muted truncate">
                  {amberTeamName || "Amber"}
                </span>
              </div>

              <div className="flex flex-col gap-2 pb-1 min-w-0">
                <div className="flex h-3 rounded-full overflow-hidden bg-table">
                  <span
                    className="bg-team-amber transition-all duration-500"
                    style={{ width: `${amberPct}%` }}
                  />
                  <span className="w-0.5 shrink-0 bg-card" />
                  <span className="flex-1 bg-team-sapphire transition-all duration-500" />
                </div>

                <div className="text-center text-[13px] text-muted">
                  {amberTotalSouls !== sapphireTotalSouls ? (
                    <>
                      <span
                        className={`font-bold ${
                          amberTotalSouls > sapphireTotalSouls ? "text-team-amber" : "text-blue-300"
                        }`}
                      >
                        {(amberTotalSouls > sapphireTotalSouls ? amberTeamName : sapphireTeamName) ||
                          (amberTotalSouls > sapphireTotalSouls ? "Amber" : "Sapphire")}
                      </span>
                      <span> lead by </span>
                      <span className="font-bold text-primary tabular-nums">
                        {Math.abs(amberTotalSouls - sapphireTotalSouls).toLocaleString()}
                      </span>
                    </>
                  ) : (
                    <span>Even</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col gap-0.5 items-end min-w-0">
                <span className="font-valve-pulp text-[36px] leading-none text-blue-300 tabular-nums">
                  {sapphireTotalSouls.toLocaleString()}
                </span>
                <span className="text-[12px] font-semibold text-muted truncate">
                  {sapphireTeamName || "Sapphire"}
                </span>
              </div>
            </div>
          </div>

          {/* ---- By Player (metric leaderboard) ---- */}
          <div className="flex flex-col gap-3.5">
            <div className="flex items-center justify-between gap-2">
              <h4 className={GRAPH_SECTION_LABEL}>
                {PLAYER_METRICS.find((m) => m.key === activeSoulsMetric)?.label || "Souls"} by Player
              </h4>
              <div className="flex gap-1.5 flex-wrap justify-end">
                {PLAYER_METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setActiveSoulsMetric(m.key)}
                    className={`inline-flex items-center justify-center min-h-[30px] px-3 py-1.5 rounded-xl border text-[13px] transition-colors ${
                      activeSoulsMetric === m.key
                        ? "bg-accent border-accent text-[#170a26] font-bold"
                        : "bg-badge-bg border-border-light text-secondary font-medium hover:bg-hover"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              {allPlayersSorted.map((player) => {
                const isAmber = player.team === 0;
                const value = player?.[activeSoulsMetric] || 0;
                const pct = maxMetricValue > 0 ? (value / maxMetricValue) * 100 : 0;
                const heroName = getHeroName(player.hero_id);
                const showSoulsTooltip = activeSoulsMetric === "net_worth";
                const showDamageTooltip = activeSoulsMetric === "player_damage";
                const soulSources = (player.gold_sources || [])
                  .map((g) => ({
                    label: SOUL_SOURCE_LABELS[g.source] || `Source ${g.source}`,
                    total: (g.gold || 0) + (g.gold_orbs || 0),
                  }))
                  .filter((i) => i.total > 0)
                  .sort((a, b) => b.total - a.total);
                const dmgByLabel = {};
                (player.damage_sources || []).forEach((g) => {
                  const dmg = g.damage || 0;
                  if (dmg <= 0) return;
                  const label = damageSourceLabel(g.source, player.hero_id, itemNames);
                  dmgByLabel[label] = (dmgByLabel[label] || 0) + dmg;
                });
                const damageSources = Object.entries(dmgByLabel)
                  .map(([label, damage]) => ({ label, damage }))
                  .sort((a, b) => b.damage - a.damage)
                  .slice(0, 10);
                const showTooltip = showSoulsTooltip || showDamageTooltip;
                return (
                  <div
                    key={player.account_id}
                    className="relative grid grid-cols-[150px_minmax(0,1fr)_60px] items-center gap-3 group"
                  >
                    <Link
                      to={`/player/${player.account_id}`}
                      className="flex items-center gap-2 min-w-0"
                      title={player.persona_name || heroName}
                    >
                      <HeroIcon
                        src={getHeroIcon(player.hero_id)}
                        name={heroName}
                        className="w-6 h-6 shrink-0"
                      />
                      <span className="truncate text-[13px] font-semibold text-secondary hover:underline-text">
                        {player.persona_name || "Anonymous"}
                      </span>
                    </Link>
                    <div className="h-3.5 bg-table rounded overflow-hidden">
                      <div
                        className={`h-full rounded transition-all duration-300 ease-[cubic-bezier(.4,0,.2,1)] ${
                          isAmber ? "bg-team-amber" : "bg-team-sapphire"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`text-right text-[13px] font-bold tabular-nums ${
                        isAmber ? "text-team-amber" : "text-blue-300"
                      }`}
                      title={value.toLocaleString()}
                    >
                      {formatSouls(value)}
                    </span>

                    {/* Breakdown on hover: Souls sources (Souls tab) or Damage sources (Damage tab) */}
                    {showTooltip && (
                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 hidden group-hover:block w-64 rounded-lg border border-border-lighter bg-panel/95 p-3 shadow-2xl">
                      {showSoulsTooltip ? (
                        <>
                          <div className="text-xs font-bold text-primary mb-1.5">
                            {player.persona_name || "Anonymous"} — Soul Sources
                          </div>
                          {soulSources.length === 0 ? (
                            <p className="text-[11px] text-dim">No soul source data yet.</p>
                          ) : (
                            <>
                              <div className="space-y-1">
                                {soulSources.map((it) => (
                                  <div
                                    key={it.label}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span className="text-secondary truncate">{it.label}</span>
                                    <span className="font-semibold tabular-nums text-primary shrink-0">
                                      {it.total.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between gap-3 text-[11px] border-t border-border pt-1.5 mt-1.5">
                                <span className="text-muted font-semibold">Total Souls</span>
                                <span className="font-bold tabular-nums text-primary">
                                  {(player.net_worth || 0).toLocaleString()}
                                </span>
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-bold text-primary mb-1.5">
                            {player.persona_name || "Anonymous"} — Damage Sources
                          </div>
                          {damageSources.length === 0 ? (
                            <p className="text-[11px] text-dim">No damage source data yet.</p>
                          ) : (
                            <>
                              <div className="space-y-1">
                                {damageSources.map((it) => (
                                  <div
                                    key={it.label}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span className="text-secondary truncate">{it.label}</span>
                                    <span className="font-semibold tabular-nums text-primary shrink-0">
                                      {it.damage.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between gap-3 text-[11px] border-t border-border pt-1.5 mt-1.5">
                                <span className="text-muted font-semibold">Total Damage</span>
                                <span className="font-bold tabular-nums text-primary">
                                  {(player.player_damage || 0).toLocaleString()}
                                </span>
                              </div>
                            </>
                          )}
                        </>
                      )}
                    </div>
                    )}
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-[150px_minmax(0,1fr)_60px] gap-3 mt-2">
              <span />
              <div className="flex justify-between text-[10px] text-dim">
                {metricAxisTicks.map((tick, i) => (
                  <span key={i}>{tick}</span>
                ))}
              </div>
              <span />
            </div>
          </div>

          {/* ---- Souls Difference ---- */}
          {timeline?.available ? (() => {
            const playerList = Object.values(timeline.players);
            const maxSnaps = Math.max(...playerList.map((p) => p.snapshots.length));
            const durationS = adjacentMatches.duration_s;
            // Try to build labels from real per-snapshot timestamps.
            // Use the player with the most snapshots as the timestamp source.
            const anchorPlayer = playerList.find((p) => p.snapshots.length === maxSnaps);
            const hasRealTimestamps = anchorPlayer?.snapshots.every((s) => s.time_stamp_s != null);
            const labels = Array.from({ length: maxSnaps }, (_, i) => {
              let secs;
              if (hasRealTimestamps) {
                secs = anchorPlayer.snapshots[i].time_stamp_s;
              } else if (durationS && maxSnaps > 1) {
                secs = Math.round((i / (maxSnaps - 1)) * durationS);
              } else {
                return `#${i + 1}`;
              }
              const m = Math.floor(secs / 60);
              const s = String(secs % 60).padStart(2, "0");
              return `${m}:${s}`;
            });

            // Amber souls minus Sapphire souls at each snapshot.
            const diff = Array.from({ length: maxSnaps }, (_, i) =>
              playerList
                .filter((p) => p.team === 0)
                .reduce((sum, p) => sum + (p.snapshots[i]?.net_worth ?? 0), 0) -
                playerList
                  .filter((p) => p.team === 1)
                  .reduce((sum, p) => sum + (p.snapshots[i]?.net_worth ?? 0), 0)
            );
            const finalDiff = diff[diff.length - 1] ?? 0;
            const caption = buildDiffCaption(diff, labels, amberTeamName, sapphireTeamName);

            // Symmetric y-axis: give both sides of the zero line the same extent,
            // so the negative region is never taller than the positive one.
            const yMaxAbs = Math.max(...diff.map((v) => Math.abs(v)), 1);

            // Amber minus Sapphire — the chart can dip below zero, but the axis
            // tick labels are formatted as magnitudes (no minus sign).
            const diffDatasets = [
              {
                label: "Souls difference",
                data: diff,
                order: 2,
                borderColor: CHART_AMBER,
                segment: {
                  borderColor: (ctx) =>
                    ctx.p0.parsed.y >= 0 ? CHART_AMBER : CHART_SAPPHIRE,
                },
                borderWidth: 2,
                hoverBorderWidth: 2,
                pointRadius: 0,
                tension: 0.3,
                fill: false,
              },
              {
                // Amber-ahead fill (above the zero line). Keep the same look on
                // hover so the fill doesn't vanish while the tooltip is active.
                data: diff.map((v) => Math.max(0, v)),
                backgroundColor: CHART_AMBER_FILL,
                hoverBackgroundColor: CHART_AMBER_FILL,
                borderWidth: 0,
                hoverBorderWidth: 0,
                pointRadius: 0,
                fill: "origin",
              },
              {
                // Sapphire-ahead fill (below the zero line). Keep the same look on
                // hover so the fill doesn't vanish while the tooltip is active.
                data: diff.map((v) => Math.min(0, v)),
                backgroundColor: CHART_SAPPHIRE_FILL,
                hoverBackgroundColor: CHART_SAPPHIRE_FILL,
                borderWidth: 0,
                hoverBorderWidth: 0,
                pointRadius: 0,
                fill: "origin",
              },
            ];

            // Tooltip colour follows whichever team is ahead (amber/blue).
            const leaderOf = (idx) => (diff[idx] ?? 0) >= 0;
            const leaderNameOf = (idx) =>
              (diff[idx] ?? 0) >= 0
                ? amberTeamName || "Amber"
                : sapphireTeamName || "Sapphire";

            return (
              <div className="flex flex-col gap-3">
                <div className="flex items-baseline justify-between gap-4">
                  <h4 className={GRAPH_SECTION_LABEL}>Souls Difference</h4>
                  <span
                    className={`font-valve-pulp text-[24px] tabular-nums ${
                      finalDiff >= 0 ? "text-team-amber" : "text-blue-300"
                    }`}
                  >
                    {finalDiff >= 0 ? "+" : ""}
                    {finalDiff.toLocaleString()}
                  </span>
                </div>

                {caption && <p className="text-[13px] text-dim">{caption}.</p>}

                <div
                  className="rounded-lg bg-table"
                  style={{ height: "220px", position: "relative" }}
                >
                  <Line
                    data={{ labels, datasets: diffDatasets }}
                    plugins={[verticalHoverLine]}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      // Only the main line participates in hover — the fill datasets
                      // stay out of interaction so the shaded fill never flickers away.
                      interaction: {
                        mode: "index",
                        intersect: false,
                        filter: (item) => item.datasetIndex === 0,
                      },
                      plugins: {
                        legend: { display: false },
                        tooltip: {
                          mode: "index",
                          intersect: false,
                          backgroundColor: (ctx) => {
                            const idx = ctx.tooltip?.dataPoints?.[0]?.dataIndex ?? 0;
                            return withAlpha(leaderOf(idx) ? CHART_AMBER : CHART_SAPPHIRE, 0.95);
                          },
                          borderColor: (ctx) => {
                            const idx = ctx.tooltip?.dataPoints?.[0]?.dataIndex ?? 0;
                            return leaderOf(idx) ? CHART_AMBER : CHART_SAPPHIRE;
                          },
                          callbacks: {
                            title: (items) => (items.length ? labels[items[0].dataIndex] : ""),
                            label: (ctx) => {
                              const v = diff[ctx.dataIndex] ?? 0;
                              return ` ${leaderNameOf(ctx.dataIndex)} +${Math.abs(v).toLocaleString()} souls`;
                            },
                          },
                        },
                      },
                      scales: {
                        x: {
                          grid: { color: "rgba(255,255,255,0.06)" },
                          ticks: {
                            color: "rgba(255,255,255,0.45)",
                            font: { size: 11 },
                            maxTicksLimit: 5,
                          },
                        },
                        y: {
                          suggestedMin: -yMaxAbs,
                          suggestedMax: yMaxAbs,
                          grid: {
                            color: (ctx) =>
                              ctx.tick.value === 0
                                ? "rgba(255,255,255,0.2)"
                                : "rgba(255,255,255,0.06)",
                          },
                          ticks: {
                            color: "rgba(255,255,255,0.45)",
                            callback: (v) =>
                              Math.abs(v) >= 1000
                                ? (Math.abs(v) / 1000).toFixed(0) + "k"
                                : Math.abs(v),
                          },
                        },
                      },
                    }}
                  />
                </div>

                <div className="flex items-center justify-center gap-5">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[2px] bg-team-amber" />
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-team-amber">
                      {amberTeamName || "Amber"} Ahead
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-[2px] bg-team-sapphire" />
                    <span className="text-[12px] font-semibold uppercase tracking-wide text-blue-300">
                      {sapphireTeamName || "Sapphire"} Ahead
                    </span>
                  </span>
                </div>
              </div>
            );
          })() : (
            <p className="text-dim text-sm text-center">
              Timeline data not available for this match — only recorded for matches ingested after this feature was added.
            </p>
          )}
        </div>
      )}

      {/* Build tab — focused player by default; "See all" shows both teams side by side */}
      {activeTab === "build" && (() => {
        const getBuild = (player) => {
          const raw = buildByPlayer[String(player.account_id)];
          return {
            items: Array.isArray(raw) ? raw : (raw?.items || []),
            abilities: Array.isArray(raw) ? [] : (raw?.abilities || []),
          };
        };
        const buildTeams = [
          { side: "amber", name: amberTeamName || "Amber", players: amberPlayers },
          { side: "sapphire", name: sapphireTeamName || "Sapphire", players: sapphirePlayers },
        ];
        const teamText = (side) => (side === "amber" ? "text-team-amber" : "text-blue-300");
        const teamRing = (side) => (side === "amber" ? "ring-team-amber/60" : "ring-team-sapphire/70");
        const SLOTS = 16;
        const ITEM_SLOTS = 12;

        const renderKda = (p, size = "text-xs") => (
          <span className={`${size} font-semibold`}>
            <span className="text-success">{p.kills || 0}</span>
            <span className="text-dim"> / </span>
            <span className="text-danger-text">{p.deaths || 0}</span>
            <span className="text-dim"> / </span>
            <span className="text-warning">{p.assists || 0}</span>
          </span>
        );

        const renderAbilityGrid = (abilities, compact) => {
          if (!abilities.length) {
            return <p className="text-dim text-xs">No ability data available.</p>;
          }
          // Flatten all upgrades, sort by time → each point spent gets a column (0–15).
          const events = abilities
            .flatMap((ability, ai) => ability.upgrades.map((upg) => ({ ai, upg })))
            .sort((a, b) => (a.upg.game_time_s ?? 0) - (b.upg.game_time_s ?? 0));
          const slotMap = Object.fromEntries(abilities.map((_, ai) => [ai, {}]));
          events.forEach(({ ai, upg }, slot) => {
            slotMap[ai][slot] = upg;
          });
          const iconCol = compact ? 20 : 34;
          const cellH = compact ? "h-5" : "h-[30px]";
          const cols = { gridTemplateColumns: `${iconCol}px repeat(${SLOTS}, minmax(0, 1fr))` };
          return (
            <div className="flex flex-col">
              {!compact && (
                <div className="grid gap-1 pb-1 text-[10px] font-semibold text-dim" style={cols}>
                  <span />
                  {Array.from({ length: SLOTS }, (_, i) => (
                    <span key={i} className="text-center">{i + 1}</span>
                  ))}
                </div>
              )}
              {abilities.map((ability, ai) => (
                <div
                  key={ai}
                  className={`grid items-center ${compact ? "gap-px py-px" : "gap-1 py-[3px]"} border-t border-border first:border-t-0`}
                  style={cols}
                >
                  <img
                    src={staticImagePathToCdn(ability.image)}
                    alt={ability.name}
                    title={ability.name}
                    className={`${compact ? "w-5 h-5" : "w-[30px] h-[30px]"} object-contain rounded bg-hover border border-border-light`}
                    onError={(e) => { e.target.style.visibility = "hidden"; }}
                  />
                  {Array.from({ length: SLOTS }, (_, slot) => {
                    const upg = slotMap[ai][slot];
                    if (!upg) return <div key={slot} className={cellH} />;
                    const label = `${ability.name} – ${upg.tier === 0 ? "Unlocked" : `Tier ${upg.tier}`}${
                      upg.game_time_s != null ? ` at ${formatGameTime(upg.game_time_s)}` : ""
                    }`;
                    return (
                      <div key={slot} className={`flex items-center justify-center ${cellH}`} title={label}>
                        {upg.tier === 0 ? (
                          <img
                            src={cdnImage("abilities/AP_Upgrades/ghost_reward_ap_png.png")}
                            alt="unlock"
                            className={compact ? "w-3.5 h-3.5 object-contain" : "w-4 h-4 object-contain"}
                          />
                        ) : (
                          <span
                            className={`flex items-center justify-center gap-0.5 rounded bg-accent-bg-strong border border-accent-border leading-none font-bold text-accent-light ${
                              compact ? "px-[3px] py-0.5 text-[10px]" : "px-1.5 py-1 text-[12px]"
                            }`}
                          >
                            {!compact && (
                              <img
                                src={cdnImage("abilities/AP_Upgrades/ap_icon_psd.png")}
                                alt=""
                                className="w-3.5 h-3.5 object-contain"
                              />
                            )}
                            {upg.tier === 1 ? "1" : upg.tier === 2 ? "2" : "5"}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          );
        };

        // Final inventory: 12 slots in a 6×2 grid; empty slots render dashed.
        const renderItemSlots = (items, compact) => {
          const box = compact ? "w-[30px] h-[30px] rounded-[5px]" : "w-16 h-16 rounded-lg";
          return (
            <div className={`grid grid-cols-6 w-fit ${compact ? "gap-1" : "gap-2.5"}`}>
              {Array.from({ length: ITEM_SLOTS }, (_, i) => {
                const item = items[i];
                if (!item) {
                  return <div key={i} className={`${box} border border-dashed border-border-light`} />;
                }
                const src = getLocalItemImage(item);
                const title = item.game_time_s != null ? `${item.name} – ${formatGameTime(item.game_time_s)}` : item.name;
                return (
                  <div key={i} className={`${box} bg-panel border border-border-light overflow-hidden`} title={title}>
                    {src ? (
                      <img
                        src={src}
                        alt={item.name}
                        loading="lazy"
                        decoding="async"
                        className="w-full h-full object-contain"
                        onError={(e) => {
                          if (item.image && e.target.src !== item.image) e.target.src = item.image;
                          else e.target.style.display = "none";
                        }}
                      />
                    ) : (
                      <span className="flex w-full h-full items-center justify-center text-[9px] text-dim text-center leading-tight p-0.5">
                        {item.name?.slice(0, 4)}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        };

        const allBuildPlayers = [...amberPlayers, ...sapphirePlayers];
        const focus =
          allBuildPlayers.find((p) => String(p.account_id) === String(buildFocusId)) || allBuildPlayers[0];
        const sectionLabel = "font-valve-oracle font-semibold text-[13px] uppercase tracking-[0.08em] text-muted";
        const statLabel = "text-[11px] font-semibold uppercase tracking-[0.08em] text-dim";

        if (!buildSeeAll && focus) {
          const fb = getBuild(focus);
          const fSide = focus.team === 0 ? "amber" : "sapphire";
          const fLane = laneMetaOf(focus);
          return (
            <div className="mb-6 grid grid-cols-1 md:grid-cols-[250px_minmax(0,1fr)] bg-card border border-border-light rounded-xl shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] overflow-hidden">
              {/* Roster */}
              <div className="flex flex-col gap-4 py-4 px-2.5 bg-table border-b md:border-b-0 md:border-r border-border-light">
                {buildTeams.map((team) => (
                  <div key={team.side} className="flex flex-col gap-0.5">
                    <span className={`px-2.5 pb-1.5 font-valve-oracle font-semibold text-xs uppercase tracking-[0.08em] truncate ${teamText(team.side)}`}>
                      {team.name}
                    </span>
                    {team.players.map((p) => {
                      const active = p.account_id === focus.account_id;
                      return (
                        <button
                          key={p.account_id}
                          type="button"
                          onClick={() => setBuildFocusId(p.account_id)}
                          className={`flex items-center gap-2.5 px-2.5 py-1.5 rounded-lg border text-left transition-colors ${
                            active ? "bg-accent-bg-strong border-accent-border-strong" : "border-transparent hover:bg-hover"
                          }`}
                        >
                          <HeroIcon
                            src={getHeroIcon(p.hero_id)}
                            name={getHeroName(p.hero_id)}
                            className={`w-7 h-7 shrink-0 ring-1 ${teamRing(team.side)}`}
                          />
                          <span className="flex flex-col min-w-0">
                            <span className="text-[13px] font-semibold text-primary truncate">{p.persona_name || "Anonymous"}</span>
                            <span className="text-[11px] text-muted truncate">{getHeroName(p.hero_id)}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </div>

              {/* Focused build */}
              <div className="flex flex-col min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-5 px-6 py-5 border-b border-border">
                  <div className="flex items-center gap-4 min-w-0">
                    <HeroIcon
                      src={getHeroIcon(focus.hero_id)}
                      name={getHeroName(focus.hero_id)}
                      className="w-14 h-14 shrink-0 border border-border-lighter"
                      rounded="rounded-[10px]"
                    />
                    <div className="flex flex-col gap-0.5 min-w-0">
                      {focus.account_id ? (
                        <Link to={`/player/${focus.account_id}`} className="font-valve-pulp text-[28px] leading-none text-primary truncate hover:underline-text">
                          {focus.persona_name || "Anonymous"}
                        </Link>
                      ) : (
                        <span className="font-valve-pulp text-[28px] leading-none text-primary truncate">{focus.persona_name || "Anonymous"}</span>
                      )}
                      <span className="text-[13px] text-muted">
                        <span className={`font-semibold ${teamText(fSide)}`}>
                          {fSide === "amber" ? amberTeamName || "Amber" : sapphireTeamName || "Sapphire"}
                        </span>
                        {" · "}
                        {getHeroName(focus.hero_id)}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-7">
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={statLabel}>KDA</span>
                      {renderKda(focus, "text-base")}
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={statLabel}>Souls</span>
                      <span className="text-base font-bold text-primary">{formatK(focus.net_worth)}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={statLabel}>Damage</span>
                      <span className="text-base font-bold text-primary">{formatK(focus.player_damage)}</span>
                    </div>
                    <div className="flex flex-col items-end gap-0.5">
                      <span className={statLabel}>Lane</span>
                      <span className="flex items-center gap-1.5 text-base font-bold text-primary">
                        <span className="w-2 h-2 rounded-full" style={{ background: fLane?.color || "#4b5563" }} />
                        {fLane?.name || "—"}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col gap-2.5 px-6 py-5 border-b border-border">
                  <span className={sectionLabel}>Ability Point Order</span>
                  {renderAbilityGrid(fb.abilities, false)}
                </div>
                <div className="flex flex-col gap-3 px-6 py-5">
                  <span className={sectionLabel}>Final Items</span>
                  {fb.items.length === 0 ? (
                    <p className="text-dim text-xs">No item data available.</p>
                  ) : (
                    renderItemSlots(fb.items, false)
                  )}
                </div>
              </div>
            </div>
          );
        }

        return (
          <div className="mb-6 grid grid-cols-1 xl:grid-cols-2 bg-card border border-border-light rounded-xl shadow-[0_1px_3px_rgb(0_0_0/0.3),0_1px_2px_rgb(0_0_0/0.2)] overflow-hidden">
            {buildTeams.map((team, ti) => (
              <div
                key={team.side}
                className={`flex flex-col min-w-0 ${ti === 1 ? "border-t-2 xl:border-t-0 xl:border-l-2 border-border-lighter" : ""}`}
              >
                <div
                  className={`flex items-center px-5 py-3.5 bg-panel border-b border-border border-t-2 ${
                    team.side === "amber" ? "border-t-team-amber" : "border-t-team-sapphire"
                  }`}
                >
                  <span className={`font-valve-pulp text-[22px] truncate ${teamText(team.side)}`}>{team.name}</span>
                </div>
                {team.players.map((p, i) => {
                  const b = getBuild(p);
                  return (
                    <div
                      key={p.account_id}
                      className={`grid grid-cols-[132px_minmax(0,1fr)] transition-colors hover:bg-accent-bg ${i ? "border-t border-border" : ""}`}
                    >
                      <div className="flex items-start gap-2 p-3">
                        <HeroIcon
                          src={getHeroIcon(p.hero_id)}
                          name={getHeroName(p.hero_id)}
                          className="w-[30px] h-[30px] shrink-0 border border-border-light"
                        />
                        <div className="flex flex-col gap-0.5 min-w-0">
                          {p.account_id ? (
                            <Link to={`/player/${p.account_id}`} className="font-valve-pulp text-sm text-primary break-words hover:underline-text">
                              {p.persona_name || "Anonymous"}
                            </Link>
                          ) : (
                            <span className="font-valve-pulp text-sm text-primary break-words">{p.persona_name || "Anonymous"}</span>
                          )}
                          <span className="text-xs text-muted truncate">{getHeroName(p.hero_id)}</span>
                          {renderKda(p)}
                        </div>
                      </div>
                      <div className="flex flex-col gap-2.5 py-3 px-3.5 border-l border-border min-w-0">
                        {renderAbilityGrid(b.abilities, true)}
                        {b.items.length === 0 ? (
                          <p className="text-dim text-xs">No item data available.</p>
                        ) : (
                          renderItemSlots(b.items, true)
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}
    </div>
  );
}

export default MatchDetail;
