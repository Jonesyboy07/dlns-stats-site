import React, { useState, useEffect, useRef } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { cdnImage, staticImagePathToCdn } from "../utils/cdn";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import MatchHeader from "../components/MatchHeader";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend);

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
  const [timeline, setTimeline] = useState(null);
  const [fetchErrors, setFetchErrors] = useState([]);
  const [soulsTooltip, setSoulsTooltip] = useState(null);
  const [teamTooltip, setTeamTooltip] = useState(null);
  const [seriesGames, setSeriesGames] = useState(null);
  const [seriesTitle, setSeriesTitle] = useState("");

  useEffect(() => {
    fetchHeroes();
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

  const allPlayersForChart = [
    ...amberSorted.map((p) => ({ ...p, side: "amber" })),
    ...sapphireSorted.map((p) => ({ ...p, side: "sapphire" })),
  ];

  const soulsChartData = {
    labels: allPlayersForChart.map((p) => getHeroName(p.hero_id)),
    datasets: [
      {
        data: allPlayersForChart.map((p) => p.net_worth || 0),
        backgroundColor: allPlayersForChart.map((p) =>
          p.side === "amber" ? "rgba(245, 158, 11, 0.7)" : "rgba(59, 130, 246, 0.7)"
        ),
        borderColor: allPlayersForChart.map((p) =>
          p.side === "amber" ? "rgba(245, 158, 11, 1)" : "rgba(59, 130, 246, 1)"
        ),
        borderWidth: 1,
        borderRadius: 3,
      },
    ],
  };

  const soulsChartOptions = {
    indexAxis: "y",
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: {
        callbacks: {
          label: (ctx) => ` ${ctx.raw.toLocaleString()} souls`,
          afterLabel: (ctx) => {
            const player = allPlayersForChart[ctx.dataIndex];
            return player?.persona_name ? ` ${player.persona_name}` : "";
          },
        },
      },
    },
    scales: {
      x: {
        grid: { color: "rgba(255,255,255,0.05)" },
        ticks: {
          color: "#9ca3af",
          callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
        },
      },
      y: {
        grid: { display: false },
        ticks: { color: "#d1d5db", font: { size: 12 } },
      },
    },
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
    const nameLink = player.account_id ? (
      <Link
        to={`/player/${player.account_id}`}
        className="block w-[110px] truncate text-xs text-gray-100 hover:underline"
        title={player.persona_name || "Anonymous"}
      >
        {player.persona_name || "Anonymous"}
      </Link>
    ) : (
      <span className="block w-[110px] truncate text-xs text-gray-100" title={player.persona_name || "Anonymous"}>
        {player.persona_name || "Anonymous"}
      </span>
    );
    const hero = player.hero_id ? (
      <Link to={`/hero/${player.hero_id}`} title={getHeroName(player.hero_id)} className="shrink-0">
        <HeroIcon src={getHeroIcon(player.hero_id)} name={getHeroName(player.hero_id)} />
      </Link>
    ) : null;
    const kda = (
      <span className="text-[11px] text-gray-400">
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

      {/* Scoreboard (always visible) */}
      <div className="mb-6 w-full max-w-[1300px] mx-auto">
        {/* Mirrored scoreboard */}
        <div className="text-gray-300 shadow border border-gray-700/60 overflow-x-auto">
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
                        <span className="text-xs font-semibold text-gray-200">{meta?.name || "—"}</span>
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
          <h3 className="text-gray-300 font-semibold text-lg mb-4">Souls Comparison</h3>

          {/* Dominance bar */}
          <div className="flex items-center gap-3 mb-1">
            <span className="text-amber-300 font-semibold text-sm w-20 text-right shrink-0">
              {amberTotalSouls.toLocaleString()}
            </span>
            <div className="flex-1 flex rounded overflow-hidden h-5">
              <div
                className="bg-amber-400/80 transition-all duration-500"
                style={{ width: `${amberPct}%` }}
              />
              <div
                className="bg-blue-500/80 transition-all duration-500"
                style={{ width: `${100 - amberPct}%` }}
              />
            </div>
            <span className="text-blue-300 font-semibold text-sm w-20 shrink-0">
              {sapphireTotalSouls.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-3 mb-5">
            <span className="text-amber-300/60 text-xs w-20 text-right shrink-0">
              {amberTeamName || "Amber"}
            </span>
            <div className="flex-1 text-center text-xs text-gray-400">
              {amberTotalSouls !== sapphireTotalSouls && (
                <>
                  {amberTotalSouls > sapphireTotalSouls
                    ? <span className="text-amber-300">{amberTeamName || "Amber"} lead</span>
                    : <span className="text-blue-300">{sapphireTeamName || "Sapphire"} lead</span>
                  }
                  {" "}
                  <span className="text-gray-300 font-semibold">
                    +{Math.abs(amberTotalSouls - sapphireTotalSouls).toLocaleString()}
                  </span>
                </>
              )}
              {amberTotalSouls === sapphireTotalSouls && <span>Even</span>}
            </div>
            <span className="text-blue-300/60 text-xs w-20 shrink-0">
              {sapphireTeamName || "Sapphire"}
            </span>
          </div>

          {/* Per-player bar chart */}
          <div style={{ height: `${allPlayersForChart.length * 36 + 20}px` }}>
            <Bar data={soulsChartData} options={soulsChartOptions} />
          </div>

          {/* Souls over time line chart */}
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

            const lineDatasets = playerList.map((p) => {
              const rgb = p.team === 0 ? "245,158,11" : "59,130,246";
              return {
                label: p.persona_name || getHeroName(p.hero_id) || `Player ${p.account_id}`,
                heroId: p.hero_id,
                team: p.team,
                color: rgb,
                data: p.snapshots.map((s) => s.net_worth ?? null),
                borderColor: `rgba(${rgb},0.9)`,
                backgroundColor: `rgba(${rgb},0.15)`,
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.3,
                fill: false,
              };
            });

            const buildSoulsTooltip = (context) => {
              const { chart, tooltip } = context;
              if (tooltip.opacity === 0) {
                setSoulsTooltip(null);
                return;
              }
              const dataIndex = tooltip.dataPoints?.[0]?.dataIndex;
              if (dataIndex == null) return;
              const timeLabel = labels[dataIndex];
              const entries = lineDatasets
                .map((ds) => ({
                  label: ds.label,
                  heroId: ds.heroId,
                  team: ds.team,
                  color: ds.color,
                  souls: ds.data[dataIndex] ?? 0,
                }))
                .sort((a, b) => b.souls - a.souls);
              const totalSouls = entries.reduce((sum, e) => sum + e.souls, 0);
              const canvasRect = chart.canvas.getBoundingClientRect();
              const containerRect = chart.canvas.parentElement.getBoundingClientRect();
              const x = tooltip.caretX + canvasRect.left - containerRect.left;
              const y = tooltip.caretY + canvasRect.top - containerRect.top;
              const flipLeft = x + 240 > containerRect.width;
              setSoulsTooltip({ x, y, timeLabel, entries, totalSouls, flipLeft });
            };

            const lineOptions = {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: true,
                  position: "bottom",
                  labels: { color: "#d1d5db", boxWidth: 12, font: { size: 11 } },
                },
                tooltip: {
                  enabled: false,
                  external: buildSoulsTooltip,
                  mode: "index",
                  intersect: false,
                },
              },
              scales: {
                x: {
                  grid: { color: "rgba(255,255,255,0.05)" },
                  ticks: { color: "#9ca3af", font: { size: 11 } },
                },
                y: {
                  grid: { color: "rgba(255,255,255,0.05)" },
                  ticks: {
                    color: "#9ca3af",
                    callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
                  },
                },
              },
            };

            return (
              <>
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-gray-400 text-sm font-semibold">Souls Over Time</h4>
                </div>
                <div style={{ height: "320px", position: "relative" }} onMouseLeave={() => setSoulsTooltip(null)}>
                  <Line id="soulsOverTime" data={{ labels, datasets: lineDatasets }} options={lineOptions} />
                  {soulsTooltip && (() => {
                    const { flipLeft } = soulsTooltip;
                    return (
                      <div
                        style={{
                          position: "absolute",
                          top: Math.max(0, soulsTooltip.y - 10),
                          left: flipLeft ? soulsTooltip.x - 228 : soulsTooltip.x + 12,
                          pointerEvents: "none",
                          zIndex: 50,
                          minWidth: "180px",
                        }}
                        className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl overflow-hidden"
                      >
                        <div className="text-center text-white font-bold text-sm py-1.5 px-3 bg-gray-800 border-b border-gray-600">
                          {soulsTooltip.timeLabel}
                        </div>
                        <div className="py-1">
                          {soulsTooltip.entries.map((entry, i) => {
                            const pct = soulsTooltip.totalSouls > 0
                              ? Math.round((entry.souls / soulsTooltip.totalSouls) * 100)
                              : 0;
                            const rgb = entry.color || "156,163,175";
                            const teamRgb = entry.team === 0 ? "245,158,11" : "59,130,246";
                            return (
                              <div
                                key={entry.label}
                                style={{ backgroundColor: `rgba(${teamRgb},0.08)` }}
                                className="flex items-center gap-0 py-1 overflow-hidden"
                              >
                                {/* individual graph colour stripe on the left */}
                                <span
                                  className="shrink-0 self-stretch w-1 mr-2"
                                  style={{ background: `rgba(${rgb},0.9)` }}
                                />
                                <img
                                  src={getHeroIcon(entry.heroId)}
                                  alt={entry.label}
                                  className="w-7 h-7 rounded-sm object-cover shrink-0"
                                  onError={(e) => { e.target.style.display = "none"; }}
                                />
                                <span
                                  className="text-xs text-white font-roboto tracking-wide font-semibold flex-1 truncate ml-2"
                                >
                                  {entry.souls.toLocaleString()}
                                </span>
                                <span className="text-xs text-gray-400 shrink-0 w-8 text-right pr-2">{pct}%</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>

              {/* Team souls over time chart */}
              {(() => {
                const teamDefs = [
                  { team: 0, name: amberTeamName || "Amber", rgb: "245,158,11" },
                  { team: 1, name: sapphireTeamName || "Sapphire", rgb: "59,130,246" },
                ];
                const teamDatasets = teamDefs.map(({ team, name, rgb }) => ({
                  label: name,
                  rgb,
                  data: Array.from({ length: maxSnaps }, (_, i) =>
                    playerList
                      .filter((p) => p.team === team)
                      .reduce((sum, p) => sum + (p.snapshots[i]?.net_worth ?? 0), 0)
                  ),
                  borderColor: `rgba(${rgb},0.9)`,
                  backgroundColor: `rgba(${rgb},0.1)`,
                  borderWidth: 2,
                  pointRadius: 0,
                  tension: 0.3,
                  fill: false,
                }));

                const buildTeamTooltip = (context) => {
                  const { chart, tooltip } = context;
                  if (tooltip.opacity === 0) { setTeamTooltip(null); return; }
                  const dataIndex = tooltip.dataPoints?.[0]?.dataIndex;
                  if (dataIndex == null) return;
                  const timeLabel = labels[dataIndex];
                  const entries = teamDatasets
                    .map((ds) => ({ label: ds.label, rgb: ds.rgb, souls: ds.data[dataIndex] ?? 0 }))
                    .sort((a, b) => b.souls - a.souls);
                  const totalSouls = entries.reduce((sum, e) => sum + e.souls, 0);
                  const canvasRect = chart.canvas.getBoundingClientRect();
                  const containerRect = chart.canvas.parentElement.getBoundingClientRect();
                  const x = tooltip.caretX + canvasRect.left - containerRect.left;
                  const y = tooltip.caretY + canvasRect.top - containerRect.top;
                  const flipLeft = x + 240 > containerRect.width;
                  setTeamTooltip({ x, y, timeLabel, entries, totalSouls, flipLeft });
                };

                const teamOptions = {
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: {
                      display: true,
                      position: "bottom",
                      labels: { color: "#d1d5db", boxWidth: 12, font: { size: 11 } },
                    },
                    tooltip: {
                      enabled: false,
                      external: buildTeamTooltip,
                      mode: "index",
                      intersect: false,
                    },
                  },
                  scales: {
                    x: {
                      grid: { color: "rgba(255,255,255,0.05)" },
                      ticks: { color: "#9ca3af", font: { size: 11 } },
                    },
                    y: {
                      grid: { color: "rgba(255,255,255,0.05)" },
                      ticks: {
                        color: "#9ca3af",
                        callback: (v) => (v >= 1000 ? (v / 1000).toFixed(0) + "k" : v),
                      },
                    },
                  },
                };

                return (
                  <div className="mt-8">
                    <h4 className="text-gray-400 text-sm font-semibold mb-3">Team Souls Over Time</h4>
                    <div style={{ height: "200px", position: "relative" }} onMouseLeave={() => setTeamTooltip(null)}>
                      <Line data={{ labels, datasets: teamDatasets }} options={teamOptions} />
                      {teamTooltip && (() => {
                        const { flipLeft } = teamTooltip;
                        return (
                          <div
                            style={{
                              position: "absolute",
                              top: Math.max(0, teamTooltip.y - 10),
                              left: flipLeft ? teamTooltip.x - 180 : teamTooltip.x + 12,
                              pointerEvents: "none",
                              zIndex: 50,
                              minWidth: "160px",
                            }}
                            className="bg-gray-900 border border-gray-600 rounded-lg shadow-xl overflow-hidden"
                          >
                            <div className="text-center text-white font-bold text-sm py-1.5 px-3 bg-gray-800 border-b border-gray-600">
                              {teamTooltip.timeLabel}
                            </div>
                            <div className="py-1">
                              {teamTooltip.entries.map((entry, i) => {
                                const pct = teamTooltip.totalSouls > 0
                                  ? Math.round((entry.souls / teamTooltip.totalSouls) * 100)
                                  : 0;
                                const isTop = i === 0;
                                return (
                                  <div
                                    key={entry.label}
                                    style={isTop ? { backgroundColor: `rgba(${entry.rgb},0.15)` } : {}}
                                    className="flex items-center gap-2 px-3 py-1.5"
                                  >
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0"
                                      style={{ background: `rgba(${entry.rgb},0.9)` }}
                                    />
                                    <span
                                      style={{ color: `rgba(${entry.rgb},1)` }}
                                      className="text-xs font-semibold flex-1 truncate"
                                    >
                                      {entry.label}
                                    </span>
                                    <span className="text-xs text-gray-200 font-semibold shrink-0">
                                      {entry.souls.toLocaleString()}
                                    </span>
                                    <span className="text-xs text-gray-400 shrink-0 w-8 text-right">{pct}%</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()}
                    </div>
                  </div>
                );
              })()}
            </>
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
