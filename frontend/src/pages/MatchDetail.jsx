import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import heroMeta from "../../../data/hero_meta.json";
import { cdnImage, staticImagePathToCdn } from "../utils/cdn";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import MatchHeader from "../components/MatchHeader";
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

// Soul-income source labels (deadlock-api gold_sources source ids), user-confirmed.
const SOUL_SOURCE_LABELS = {
  1: "Enemy Kills",
  2: "Troopers",
  3: "Neutral Enemies",
  4: "Objectives",
  5: "Urn",
  6: "Kill Assists",
  7: "Denies",
  8: "Team Catch-Up",
  9: "Ability Assassinate",
  10: "Trophy Collector",
  11: "Cultist Sacrifice",
  12: "Breakable Pickups",
  13: "Golden Goose Egg",
};

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

function HeroIcon({ src, name, className = "w-8 h-8" }) {
  const [failed, setFailed] = useState(false);
  const imgRef = useRef(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const img = imgRef.current;
      if (img && !(img.complete && img.naturalWidth > 0)) {
        setFailed(true);
      }
    }, 2000);
    return () => clearTimeout(t);
  }, [src]);
  if (failed) {
    return (
      <div
        className={`${className} rounded-md bg-gray-700/80 flex items-center justify-center text-[10px] font-bold text-gray-200 uppercase select-none`}
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
      loading="lazy"
      className={`${className} rounded-md object-cover`}
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
  const [buildByPlayer, setBuildByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("graphs");
  const [activeSoulsMetric, setActiveSoulsMetric] = useState("net_worth");
  const [itemNames, setItemNames] = useState({});
  const [timeline, setTimeline] = useState(null);
  const [fetchErrors, setFetchErrors] = useState([]);
  const [seriesGames, setSeriesGames] = useState(null);
  const [seriesTitle, setSeriesTitle] = useState("");

  useEffect(() => {
    fetchHeroes();
    fetchItemNames();
    fetchMatchPlayers();
    fetchAdjacentMatches();
    fetchMatchBuild();
    fetchWeekMeta();
    fetchTimeline();
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

  const getHeroIcon = (heroId) => {
    const heroName = getHeroName(heroId);
    // Convert hero name to lowercase and replace spaces with underscores
    const formattedName = heroName.toLowerCase().replace(/\s+/g, "_");
    return cdnImage(`hero icons/${formattedName}_sm_psd.png`);
  };

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
    return (
      <div className="w-full p-8">
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded">
          Error: {error}
        </div>
      </div>
    );
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

  // --- Laning / scoreboard helpers ---
  // `assigned_lane` values are reported by the game (current 3-duo-lane map):
  // DLNS league's 3-lane map — game lane ids and their callouts:
  // 1 = York (Yellow), 4 = Greenwich (Green), 6 = Broadway (Blue).
  const LANE_META = {
    1: { name: "York", color: "#facc15" },
    4: { name: "Greenwich", color: "#4ade80" },
    6: { name: "Broadway", color: "#22d3ee" },
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
    const base = side === "amber" ? "text-amber-100/90" : "text-blue-100/90";
    const max = globalMax[columnKey] || 0;
    const value = player?.[columnKey] || 0;
    const isTop = value > 0 && value === max;
    const color = isTop ? "text-accent-light" : base;
    return (
      <td
        className={`py-2 px-2 text-[14px] ${align} ${color} ${isTop ? "font-bold" : ""}`}
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
        <HeroIcon src={getHeroIcon(player.hero_id)} name={getHeroName(player.hero_id)} />
      </Link>
    ) : null;
    const kda = (
      <span className="text-[11px] px-1 text-gray-400">
        <span className="text-green-400">{player.kills || 0}</span>
        <span className="text-gray-500"> / </span>
        <span className="text-red-400">{player.deaths || 0}</span>
        <span className="text-gray-500"> / </span>
        <span className="text-orange-400">{player.assists || 0}</span>
      </span>
    );
    if (side === "amber") {
      return (
        <div className="flex items-center justify-end gap-2">
          <div className="flex flex-col items-end shrink-0">
            {nameLink}
            {kda}
          </div>
          {hero}
        </div>
      );
    }
    return (
      <div className="flex items-center gap-2">
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
        <div className="mb-4 max-w-3xl mx-auto rounded-lg border border-amber-500/40 bg-amber-900/20 p-4 text-center">
          <p className="text-amber-400 text-sm font-medium">
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
      />

      {/* Scoreboard */}
      <div className="mb-6 w-full max-w-[1300px] mx-auto">
        {/* Mirrored scoreboard (desktop only) */}
        <div className="hidden lg:block text-gray-300 shadow border border-gray-700/60 overflow-x-auto">
          <table className="w-full table-fixed border-separate border-spacing-0">
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
              <tr className="text-[11px] uppercase tracking-wider text-gray-400 border-b border-gray-700/60 divide-x divide-gray-700/40 bg-gray-800/40">
                <th className="py-2 px-2 text-center">Heal</th>
                <th className="py-2 px-2 text-center">Obj</th>
                <th className="py-2 px-2 text-center">Souls</th>
                <th className="py-2 px-2 text-center">DMG</th>
                <th className="py-2 pl-2 pr-3 text-right">Player</th>
                <th className="py-2 px-3 text-center">Lane</th>
                <th className="py-2 pl-3 pr-2 text-left">Player</th>
                <th className="py-2 px-2 text-center">DMG</th>
                <th className="py-2 px-2 text-center">Souls</th>
                <th className="py-2 px-2 text-center">Obj</th>
                <th className="py-2 px-2 text-center">Heal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/40">
              {scoreboardRows.map((row, idx) => {
                const meta = row.laneId ? LANE_META[row.laneId] : null;
                const zebra = idx % 2 === 0;
                return (
                  <tr key={idx} className={`divide-x divide-gray-700/40 ${zebra ? "bg-gray-700/40" : "bg-gray-900/40"}`}>
                    {/* Left half */}
                    {statCell(row.left, "player_healing", "text-center", "amber")}
                    {statCell(row.left, "obj_damage", "text-center", "amber")}
                    {statCell(row.left, "net_worth", "text-center", "amber")}
                    {statCell(row.left, "player_damage", "text-center", "amber")}
                    <td className="py-2 pl-2 pr-3 text-right">{renderPlayerCell(row.left, "amber")}</td>

                    {/* Center lane */}
                    <td className="py-2 px-3 text-center">
                      <div className="flex items-center justify-center gap-1.5">
                        <span
                          className="w-2.5 h-2.5 rounded-full shrink-0"
                          style={{ background: meta?.color || "#4b5563" }}
                        />
                        <span className="text-md font-semibold text-gray-300">{meta?.name || "—"}</span>
                      </div>
                    </td>

                    {/* Right half (mirrored) */}
                    <td className="py-2 pl-3 pr-2 text-left">{renderPlayerCell(row.right, "sapphire")}</td>
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
              className="bg-gray-900/60 rounded-lg border border-gray-700/60 overflow-hidden"
            >
              {/* Team header */}
              <div
                className={`px-4 py-2.5 flex items-center justify-between border-b border-gray-700/60 ${
                  isAmber ? "bg-amber-500/10" : "bg-blue-500/10"
                }`}
              >
                <span
                  className={`text-sm font-bold uppercase tracking-wide truncate ${
                    isAmber ? "text-amber-300" : "text-blue-300"
                  }`}
                >
                  {teamName}
                </span>
                <span
                  className={`text-sm font-bold shrink-0 ${
                    isAmber ? "text-amber-300" : "text-blue-300"
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
                  <tr className="text-[10px] uppercase tracking-wider text-gray-400 border-b border-gray-700/40">
                    <th className="font-medium text-left py-1.5 pl-3">Player</th>
                    <th className="font-medium text-right py-1.5">K/D/A</th>
                    <th className="font-medium text-right py-1.5">Souls</th>
                    <th className="font-medium text-right py-1.5 pr-3">DMG</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/40">
                  {teamPlayers.map((player) => (
                    <tr key={player.account_id} className="hover:bg-gray-800/40">
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
                        <span className="text-green-400 font-medium">{player.kills || 0}</span>
                        <span className="text-gray-500">/</span>
                        <span className="text-red-400 font-medium">{player.deaths || 0}</span>
                        <span className="text-gray-500">/</span>
                        <span className="text-orange-400 font-medium">{player.assists || 0}</span>
                      </td>
                      {/* Souls */}
                      <td className="py-2 text-right text-gray-200 font-medium whitespace-nowrap">
                        {formatK(player.net_worth).toUpperCase()}
                      </td>
                      {/* DMG */}
                      <td className="py-2 pr-3 text-right text-gray-200 font-medium whitespace-nowrap">
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
      <div className="flex gap-1 mb-4 border-b border-gray-700">
        {["graphs", "build"].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-sm font-semibold capitalize rounded-t transition-colors ${
              activeTab === tab
                ? "bg-gray-800 text-white border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Graphs tab */}
      {activeTab === "graphs" && players.length > 0 && (
        <div className="bg-gray-800 rounded-lg p-4 mb-6">
          {/* ---- Souls Comparison ---- */}
          <div className="mb-8">
            <h3 className="text-gray-300 font-bold text-lg tracking-wide uppercase mb-4">
              Souls Comparison
            </h3>

            <div className="flex items-center justify-between mb-1">
              <span className="text-amber-300 text-3xl font-bold tabular-nums">
                {amberTotalSouls.toLocaleString()}
              </span>
              <span className="text-blue-300 text-3xl font-bold tabular-nums">
                {sapphireTotalSouls.toLocaleString()}
              </span>
            </div>

            <div className="flex items-center gap-3 mb-3">
              <span className="text-amber-300/70 text-xs w-24 text-right truncate shrink-0">
                {amberTeamName || "Amber"}
              </span>
              <div className="flex-1 flex rounded overflow-hidden h-4 bg-gray-700/50">
                <div
                  className="bg-amber-400/80 transition-all duration-500"
                  style={{ width: `${amberPct}%` }}
                />
                <div
                  className="bg-blue-500/80 transition-all duration-500"
                  style={{ width: `${100 - amberPct}%` }}
                />
              </div>
              <span className="text-blue-300/70 text-xs w-24 truncate shrink-0">
                {sapphireTeamName || "Sapphire"}
              </span>
            </div>

            <div className="text-center">
              {amberTotalSouls !== sapphireTotalSouls ? (
                <span className="text-sm">
                  <span
                    className={`font-bold uppercase tracking-wide ${
                      amberTotalSouls > sapphireTotalSouls ? "text-amber-300" : "text-blue-300"
                    }`}
                  >
                    {(amberTotalSouls > sapphireTotalSouls ? amberTeamName : sapphireTeamName) ||
                      (amberTotalSouls > sapphireTotalSouls ? "Amber" : "Sapphire")}
                  </span>
                  <span className="text-gray-400"> lead </span>
                  <span className="text-gray-100 font-bold tabular-nums">
                    +{Math.abs(amberTotalSouls - sapphireTotalSouls).toLocaleString()}
                  </span>
                </span>
              ) : (
                <span className="text-gray-400 text-sm">Even</span>
              )}
            </div>
          </div>

          {/* ---- By Player (metric leaderboard) ---- */}
          <div className="mb-8">
            <div className="flex items-center justify-between gap-2 mb-3">
              <h4 className="text-gray-400 text-xs font-semibold uppercase tracking-wider">
                {PLAYER_METRICS.find((m) => m.key === activeSoulsMetric)?.label || "Souls"} by Player
              </h4>
              <div className="flex gap-1 flex-wrap justify-end">
                {PLAYER_METRICS.map((m) => (
                  <button
                    key={m.key}
                    onClick={() => setActiveSoulsMetric(m.key)}
                    className={`px-2.5 py-1 text-[11px] font-semibold rounded-full border transition-colors ${
                      activeSoulsMetric === m.key
                        ? "bg-blue-500/20 text-blue-300 border-blue-400/40"
                        : "text-gray-400 border-gray-600/40 hover:text-gray-200 hover:border-gray-500/60"
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
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
                  <div key={player.account_id} className="relative flex items-center gap-2 group">
                    <Link
                      to={`/player/${player.account_id}`}
                      title={player.persona_name || heroName}
                      className="shrink-0"
                    >
                      <HeroIcon
                        src={getHeroIcon(player.hero_id)}
                        name={heroName}
                        className="w-7 h-7"
                      />
                    </Link>
                    <Link
                      to={`/player/${player.account_id}`}
                      className="w-24 truncate text-xs text-gray-200 hover:underline shrink-0"
                      title={player.persona_name || "Anonymous"}
                    >
                      {player.persona_name || "Anonymous"}
                    </Link>
                    <div className="flex-1 h-5 bg-gray-700/40 overflow-hidden">
                      <div
                        className={`h-full transition-all duration-500 ${
                          isAmber ? "bg-amber-400/80" : "bg-blue-500/80"
                        }`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span
                      className={`w-16 text-right text-sm font-semibold tabular-nums shrink-0 ${
                        isAmber ? "text-amber-200" : "text-blue-200"
                      }`}
                      title={value.toLocaleString()}
                    >
                      {formatSouls(value)}
                    </span>

                    {/* Breakdown on hover: Souls sources (Souls tab) or Damage sources (Damage tab) */}
                    {showTooltip && (
                    <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 z-30 hidden group-hover:block w-64 rounded-lg border border-gray-600 bg-gray-900/95 p-3 shadow-2xl">
                      {showSoulsTooltip ? (
                        <>
                          <div className="text-xs font-bold text-gray-100 mb-1.5">
                            {player.persona_name || "Anonymous"} — Soul Sources
                          </div>
                          {soulSources.length === 0 ? (
                            <p className="text-[11px] text-gray-500">No soul source data yet.</p>
                          ) : (
                            <>
                              <div className="space-y-1">
                                {soulSources.map((it) => (
                                  <div
                                    key={it.label}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span className="text-gray-300 truncate">{it.label}</span>
                                    <span className="font-semibold tabular-nums text-gray-100 shrink-0">
                                      {it.total.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between gap-3 text-[11px] border-t border-gray-700 pt-1.5 mt-1.5">
                                <span className="text-gray-400 font-semibold">Total Souls</span>
                                <span className="font-bold tabular-nums text-gray-100">
                                  {(player.net_worth || 0).toLocaleString()}
                                </span>
                              </div>
                            </>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-bold text-gray-100 mb-1.5">
                            {player.persona_name || "Anonymous"} — Damage Sources
                          </div>
                          {damageSources.length === 0 ? (
                            <p className="text-[11px] text-gray-500">No damage source data yet.</p>
                          ) : (
                            <>
                              <div className="space-y-1">
                                {damageSources.map((it) => (
                                  <div
                                    key={it.label}
                                    className="flex items-center justify-between gap-3 text-[11px]"
                                  >
                                    <span className="text-gray-300 truncate">{it.label}</span>
                                    <span className="font-semibold tabular-nums text-gray-100 shrink-0">
                                      {it.damage.toLocaleString()}
                                    </span>
                                  </div>
                                ))}
                              </div>
                              <div className="flex items-center justify-between gap-3 text-[11px] border-t border-gray-700 pt-1.5 mt-1.5">
                                <span className="text-gray-400 font-semibold">Total Damage</span>
                                <span className="font-bold tabular-nums text-gray-100">
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
            <div className="flex justify-between text-[10px] text-gray-600 mt-2 px-35">
              {metricAxisTicks.map((tick, i) => (
                <span key={i}>{tick}</span>
              ))}
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
                borderColor: "rgba(245,158,11,0.9)",
                segment: {
                  borderColor: (ctx) =>
                    ctx.p0.parsed.y >= 0
                      ? "rgba(245,158,11,0.95)"
                      : "rgba(59,130,246,0.95)",
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
                backgroundColor: "rgba(245,158,11,0.22)",
                hoverBackgroundColor: "rgba(245,158,11,0.22)",
                borderWidth: 0,
                hoverBorderWidth: 0,
                pointRadius: 0,
                fill: "origin",
              },
              {
                // Sapphire-ahead fill (below the zero line). Keep the same look on
                // hover so the fill doesn't vanish while the tooltip is active.
                data: diff.map((v) => Math.min(0, v)),
                backgroundColor: "rgba(59,130,246,0.22)",
                hoverBackgroundColor: "rgba(59,130,246,0.22)",
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
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-gray-400 text-sm font-semibold uppercase tracking-wider">
                    Souls Difference
                  </h4>
                  <span
                    className={`text-lg font-bold tabular-nums ${
                      finalDiff >= 0 ? "text-amber-300" : "text-blue-300"
                    }`}
                  >
                    {finalDiff >= 0 ? "+" : ""}
                    {finalDiff.toLocaleString()}
                  </span>
                </div>

                {caption && (
                  <p className="text-xs text-gray-500 text-center mb-3">{caption}.</p>
                )}

                <div style={{ height: "220px", position: "relative" }}>
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
                            return leaderOf(idx)
                              ? "rgba(245,158,11,0.95)"
                              : "rgba(59,130,246,0.95)";
                          },
                          borderColor: (ctx) => {
                            const idx = ctx.tooltip?.dataPoints?.[0]?.dataIndex ?? 0;
                            return leaderOf(idx)
                              ? "rgba(245,158,11,1)"
                              : "rgba(59,130,246,1)";
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
                          grid: { color: "rgba(255,255,255,0.05)" },
                          ticks: { color: "#9ca3af", font: { size: 11 }, maxTicksLimit: 5 },
                        },
                        y: {
                          suggestedMin: -yMaxAbs,
                          suggestedMax: yMaxAbs,
                          grid: {
                            color: (ctx) =>
                              ctx.tick.value === 0
                                ? "rgba(255,255,255,0.35)"
                                : "rgba(255,255,255,0.05)",
                          },
                          ticks: {
                            color: "#9ca3af",
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

                <div className="flex items-center justify-center gap-5 mt-3 text-xs text-gray-400">
                  <span className="flex items-center gap-1.5">
                    <span className="text-amber-400">▲</span>
                    <span className="font-semibold uppercase tracking-wide">
                      {amberTeamName || "Amber"} Ahead
                    </span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-blue-400">▼</span>
                    <span className="font-semibold uppercase tracking-wide">
                      {sapphireTeamName || "Sapphire"} Ahead
                    </span>
                  </span>
                </div>
              </div>
            );
          })() : (
            <p className="text-gray-500 text-sm mt-6 text-center">
              Timeline data not available for this match — only recorded for matches ingested after this feature was added.
            </p>
          )}
        </div>
      )}

      {/* Build tab */}
      {activeTab === "build" && (
        <div className="mb-6 space-y-6">
          {[{ players: amberPlayers, teamName: amberTeamName, teamColor: "amber" }, { players: sapphirePlayers, teamName: sapphireTeamName, teamColor: "sapphire" }].map(({ players: teamPlayers, teamName, teamColor }) => (
            <div key={teamColor} className="bg-gray-800 rounded-lg p-4">
              <h3 className={`font-bold text-xl mb-4 uppercase ${teamColor === "amber" ? "text-amber-300" : "text-blue-300"}`}>
                {teamName || (teamColor === "amber" ? "Amber" : "Sapphire")}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {teamPlayers.map((player) => {
                  const playerBuildRaw = buildByPlayer[String(player.account_id)];
                  // Handle both old cached format (array) and new format ({items, abilities})
                  const buildItems = Array.isArray(playerBuildRaw) ? playerBuildRaw : (playerBuildRaw?.items || []);
                  const buildAbilities = Array.isArray(playerBuildRaw) ? [] : (playerBuildRaw?.abilities || []);
                  return (
                    <div key={player.account_id} className="bg-gray-700/50 rounded-lg p-3">
                      {/* Player header */}
                      <div className="flex items-center gap-2 mb-3">
                        {player.hero_id && (
                          <img
                            src={getHeroIcon(player.hero_id)}
                            alt={getHeroName(player.hero_id)}
                            className="w-8 h-8 rounded-md object-cover" 
                            onError={(e) => { e.target.style.display = "none"; }}
                          />
                        )}
                        <div>
                          <div className="text-gray-200 font-semibold text-sm">
                            {player.persona_name || "Anonymous"}
                          </div>
                          <div className="text-gray-400 text-xs">{getHeroName(player.hero_id)}</div>
                        </div>
                      </div>

                      {/* Ability Point Order */}
                      {buildAbilities.length > 0 && (() => {
                        // Flatten all upgrades, tag with ability index, sort by time → assign slot 0–15
                        const allEvents = buildAbilities
                          .flatMap((ability, ai) =>
                            ability.upgrades.map(upg => ({ ai, ability, upg }))
                          )
                          .sort((a, b) => (a.upg.game_time_s ?? 0) - (b.upg.game_time_s ?? 0));
                        // slotMap[ai][slotIndex] = upg
                        const slotMap = Object.fromEntries(buildAbilities.map((_, ai) => [ai, {}]));
                        allEvents.forEach(({ ai, upg }, slot) => {
                          slotMap[ai][slot] = upg;
                        });
                        const SLOTS = 16;
                        return (
                          <div className="mb-3">
                            <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Ability Point Order</p>
                            <div className="space-y-0.5">
                              {buildAbilities.map((ability, ai) => (
                                <div key={ai} className="flex items-center gap-0.5 bg-gray-800/40">
                                  <img
                                    src={staticImagePathToCdn(ability.image)}
                                    alt={ability.name}
                                    title={ability.name}
                                    className="w-6 h-6 object-contain rounded shrink-0 bg-white/20"
                                    onError={(e) => { e.target.style.display = "none"; }}
                                  />
                                  <div className="grid gap-0.5 flex-1" style={{ gridTemplateColumns: `repeat(${SLOTS}, minmax(0, 1fr))` }}>
                                    {Array.from({ length: SLOTS }, (_, slot) => {
                                      const upg = slotMap[ai][slot];
                                      if (!upg) {
                                        return <div key={slot} className="h-6" />;
                                      }
                                      return (
                                        <div
                                          key={slot}
                                          className="flex p-0.5 items-center justify-center h-6"
                                          title={`${ability.name} – ${upg.tier === 0 ? "Unlocked" : `Tier ${upg.tier}`}${upg.game_time_s != null ? ` at ${formatGameTime(upg.game_time_s)}` : ""}`}
                                        >
                                          {upg.tier === 0 ? (
                                            <img
                                              src={cdnImage("abilities/AP_Upgrades/ghost_reward_ap_png.png")}
                                              alt="unlock"
                                              className="w-4 h-4 object-contain"
                                            />
                                          ) : (
                                            <div className="flex items-center justify-center gap-1 bg-gray-900/60 rounded py-0.5 px-2">
                                              <img
                                                src={cdnImage("abilities/AP_Upgrades/ap_icon_psd.png")}
                                                alt=""
                                                className="w-4 h-4 object-contain opacity-80"
                                              />
                                              <span className="text-[12px] font-bold text-white leading-none opacity-80">
                                                {upg.tier === 1 ? "1" : upg.tier === 2 ? "2" : "5"}
                                              </span>
                                            </div>
                                          )}
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Items */}
                      {buildItems.length === 0 ? (
                        <p className="text-gray-500 text-xs">No item data available.</p>
                      ) : (
                        <>
                          <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Items</p>
                          <div className="flex flex-wrap gap-2">
                            {buildItems.map((item, i) => {
                              const src = getLocalItemImage(item);
                              return (
                                <div key={i} className="flex flex-col items-center gap-0.5">
                                  {src ? (
                                    <img
                                      src={src}
                                      alt={item.name}
                                      title={item.name}
                                      width={36}
                                      height={36}
                                      loading="lazy"
                                      decoding="async"
                                      className="w-9 h-9 rounded object-contain bg-slate-700/50"
                                      onError={(e) => {
                                        if (item.image && e.target.src !== item.image) {
                                          e.target.src = item.image;
                                        } else {
                                          e.target.style.display = "none";
                                        }
                                      }}
                                    />
                                  ) : (
                                    <div className="w-9 h-9 rounded bg-slate-700/50 flex items-center justify-center text-xs text-gray-500 text-center leading-tight p-0.5" title={item.name}>
                                      {item.name?.slice(0, 4)}
                                    </div>
                                  )}
                                  {item.game_time_s != null && (
                                    <span className="text-gray-400 text-xs leading-none">{formatGameTime(item.game_time_s)}</span>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default MatchDetail;
