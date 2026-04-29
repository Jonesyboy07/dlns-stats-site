import React, { useState, useEffect } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
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
import zoomPlugin from "chartjs-plugin-zoom";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Tooltip, Legend, zoomPlugin);

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
  const [itemsByPlayer, setItemsByPlayer] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("stats");
  const [timeline, setTimeline] = useState(null);

  useEffect(() => {
    fetchHeroes();
    fetchMatchPlayers();
    fetchAdjacentMatches();
    fetchMatchItems();
    fetchWeekMeta();
    fetchTimeline();
  }, [matchId]);

  const fetchTimeline = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/timeline`);
      if (response.ok) {
        const data = await response.json();
        setTimeline(data);
      }
    } catch (err) {
      console.error("Failed to fetch timeline:", err);
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
      console.error("Failed to fetch heroes:", err);
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
      console.error("Failed to fetch adjacent matches:", err);
    }
  };

  const fetchMatchItems = async () => {
    try {
      const response = await fetch(`/db/matches/${matchId}/items`);
      if (response.ok) {
        const data = await response.json();
        setItemsByPlayer(data);
      }
    } catch (err) {
      console.error("Failed to fetch match items:", err);
    }
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
      console.error('Failed to fetch week metadata:', err);
    }
  };

  const getLocalItemImage = (item) => {
    if (!item.name) return null;
    const filename = item.name.toLowerCase().replace(/ /g, "_") + "_psd.png";
    const folder = item.item_tier === 5 ? "legendaries" : item.item_slot_type;
    return folder ? `/static/images/items/${folder}/${filename}` : null;
  };

  const getHeroName = (heroId) => {
    const hero = heroes[heroId];
    return hero?.name || hero || `Hero ${heroId}`;
  };

  const getHeroIcon = (heroId) => {
    const heroName = getHeroName(heroId);
    // Convert hero name to lowercase and replace spaces with underscores
    const formattedName = heroName.toLowerCase().replace(/\s+/g, "_");
    return `/static/images/hero icons/${formattedName}_sm_psd.png`;
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
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl">Loading match details...</div>
      </div>
    );
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

  // Per-column maximums across all players (for highlight)
  const maxOf = (field) => Math.max(0, ...players.map((p) => p[field] || 0));
  const maxKills = maxOf("kills");
  const maxAssists = maxOf("assists");
  const maxNetWorth = maxOf("net_worth");
  const maxPlayerDmg = maxOf("player_damage");
  const maxObjDmg = maxOf("obj_damage");
  const maxHealing = maxOf("player_healing");

  const isMax = (val, max) => max > 0 && (val || 0) === max;

  const displayEventTitle =
    adjacentMatches.event_title || weekMeta?.series || weekMeta?.title || null;
  const displayEventWeek =
    adjacentMatches.event_week != null ? adjacentMatches.event_week : weekMeta?.week;

  return (
    <div className="w-full p-8">
      <div className="flex items-center justify-between mb-6 hidden">
        <Link to="/" className="text-blue-600 hover:underline">
          ← Back to Match List
        </Link>

        {/* Match Navigation */}
        <div className="flex gap-2 hidden">
          <button
            onClick={() =>
              previousMatchId && navigate(`/match/${previousMatchId}`)
            }
            disabled={!previousMatchId}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            ← Previous Match
          </button>
          <button
            onClick={() => nextMatchId && navigate(`/match/${nextMatchId}`)}
            disabled={!nextMatchId}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            Next Match →
          </button>
        </div>
      </div>

      <div className="flex gap-4 justify-between items-start bg-gray-800 rounded-lg p-4 mb-2">
        <div>
          <h1 className="text-gray-300 text-2xl font-bold mb-4">
            Match {matchId}
          </h1>
          <div className="flex flex-col ">
            {(adjacentMatches.event_team_a || adjacentMatches.event_team_b) && (
              <p className="text-gray-300 text-xl font-semibold">
                {adjacentMatches.event_team_a ? (
                  <Link to={`/team/${encodeURIComponent(adjacentMatches.event_team_a)}`} className="hover:underline">{adjacentMatches.event_team_a}</Link>
                ) : "—"}
                <span className="text-gray-500 mx-2 font-normal">vs</span>
                {adjacentMatches.event_team_b ? (
                  <Link to={`/team/${encodeURIComponent(adjacentMatches.event_team_b)}`} className="hover:underline">{adjacentMatches.event_team_b}</Link>
                ) : "—"}
                {adjacentMatches.event_game && (
                  <p className="text-gray-500 text-base font-normal">
                    {adjacentMatches.event_game}
                  </p>
                )}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end justify-end">
          {displayEventTitle && (
            <p className="text-gray-300 text-lg font-semibold mb-1">
              {displayEventWeek != null ? (
                <Link
                  to={`/week/${displayEventWeek}`}
                  className="hover:underline"
                >
                  {displayEventTitle} #{displayEventWeek}
                </Link>
              ) : (
                displayEventTitle
              )}
            </p>
          )}

          {adjacentMatches.start_time && (
            <p className="text-gray-500 mb-2">
              {formatDate(adjacentMatches.start_time)}
            </p>
          )}

          {adjacentMatches.event_team_a && (
            <Link
              to={`/series/${matchId}`}
              className="text-sm text-blue-400 hover:underline"
            >
              View full series →
            </Link>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-700">
        {["stats", "graphs"].map((tab) => (
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
              const isAmber = p.team === 0;
              const baseColor = isAmber ? "245,158,11" : "59,130,246";
              return {
                label: p.persona_name || getHeroName(p.hero_id) || `Player ${p.account_id}`,
                data: p.snapshots.map((s) => s.net_worth ?? null),
                borderColor: `rgba(${baseColor},0.9)`,
                backgroundColor: `rgba(${baseColor},0.15)`,
                borderWidth: 2,
                pointRadius: 2,
                tension: 0.3,
                fill: false,
              };
            });

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
                  callbacks: {
                    label: (ctx) => ` ${ctx.dataset.label}: ${(ctx.raw || 0).toLocaleString()} souls`,
                  },
                },
                zoom: {
                  pan: {
                    enabled: true,
                    mode: "x",
                  },
                  zoom: {
                    wheel: { enabled: true },
                    pinch: { enabled: true },
                    mode: "x",
                  },
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
              <div className="mt-6">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-gray-400 text-sm font-semibold">Souls Over Time</h4>
                  <button
                    onClick={() => {
                      const chart = ChartJS.getChart("soulsOverTime");
                      chart?.resetZoom();
                    }}
                    className="text-xs text-gray-400 hover:text-gray-200 border border-gray-600 hover:border-gray-400 px-2 py-1 rounded transition-colors"
                  >
                    Reset zoom
                  </button>
                </div>
                <p className="text-xs text-gray-500 mb-2">Scroll to zoom · drag to pan</p>
                <div style={{ height: "320px" }}>
                  <Line id="soulsOverTime" data={{ labels, datasets: lineDatasets }} options={lineOptions} />
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

      {/* Stats tab */}
      {activeTab === "stats" && (
        <div className="mb-6">
        <div className="text-gray-300 shadow py-6 ">
          <table className="w-full table-auto rounded-lg ">
            <thead className="">
              <tr className="border-b h-10">
                <th className="text-left py-3 w-50 relative overflow-visible align-bottom">
                  <div className="absolute bottom-0 left-2 flex items-end gap-3 pb-1 pointer-events-none">
                    {amberTeamName && (
                      <Link to={`/team/${encodeURIComponent(amberTeamName)}`} className="pointer-events-auto">
                        <h2 className="text-amber-300 text-2xl font-bold mb-2 uppercase hover:underline">
                          {amberTeamName}
                        </h2>
                      </Link>
                    )}
                    {winningTeam === 0 && (
                      <span className="pointer-events-none mb-2.5 text-xs font-semibold px-2 py-0.5 rounded bg-amber-400/20 text-amber-300 border border-amber-400/40 uppercase tracking-wider">
                        WIN
                      </span>
                    )}
                  </div>
                </th>
                <th className="text-center p-3 w-30 align-bottom">K/D/A</th>
                <th className="text-center p-3 w-25 align-bottom">Souls</th>
                <th className="text-center p-3 w-30 align-bottom">
                  Player DMG
                </th>
                <th className="text-center p-3 w-25 align-bottom">Obj DMG</th>
                <th className="text-center p-3 w-25 align-bottom">Healing</th>
                <th className="text-left p-3 align-bottom hidden lg:table-cell">
                  Items
                </th>
              </tr>
            </thead>
            <tbody>
              {amberPlayers.map((player, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-amber-900/30 truncate ${idx % 2 === 0 ? "bg-yellow-700/20 hover:bg-yellow-700/60" : "bg-orange-950/20 hover:bg-orange-900/30"}`}
                >
                  <td className="p-3 text-lg font-bold flex flex-row gap-4 w-40 max-w-40 overflow-hidden">
                    {player.hero_id ? (
                      <Link
                        to={`/hero/${player.hero_id}`}
                        className="block flex items-center gap-2 object-cover flex-shrink-0"
                        title={getHeroName(player.hero_id)}
                      >
                        <img
                          src={getHeroIcon(player.hero_id)}
                          alt={getHeroName(player.hero_id)}
                          className="w-8 h-8 rounded-md object-cover"
                          onError={(e) => {
                            e.target.style.display = "none";
                            e.target.parentElement.innerHTML = getHeroName(
                              player.hero_id,
                            );
                          }}
                        />
                      </Link>
                    ) : (
                      "-"
                    )}
                    <div className="flex flex-col min-w-0 overflow-hidden">
                      {player.account_id ? (
                        <Link
                          to={`/player/${player.account_id}`}
                          className="hover:underline w-56 truncate"
                          title={player.persona_name || "Anonymous"}
                        >
                          {player.persona_name || "Anonymous"}
                        </Link>
                      ) : (
                        <span
                          className="truncate"
                          title={player.persona_name || "Anonymous"}
                        >
                          {player.persona_name || "Anonymous"}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 font-normal">
                        {getHeroName(player.hero_id)}
                      </span>
                    </div>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={`font-semibold ${isMax(player.kills, maxKills) ? "text-yellow-300" : "text-green-400"}`}
                    >
                      {player.kills || 0}
                    </span>
                    <span className="text-gray-400"> / </span>
                    <span className="text-red-400">{player.deaths || 0}</span>
                    <span className="text-gray-400"> / </span>
                    <span
                      className={`${isMax(player.assists, maxAssists) ? "text-yellow-300 font-semibold" : "text-orange-400"}`}
                    >
                      {player.assists || 0}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.net_worth, maxNetWorth)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.net_worth || 0).toLocaleString()}
                    >
                      {formatK(player.net_worth)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.player_damage, maxPlayerDmg)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.player_damage || 0).toLocaleString()}
                    >
                      {formatK(player.player_damage)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.obj_damage, maxObjDmg)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.obj_damage || 0).toLocaleString()}
                    >
                      {formatK(player.obj_damage)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.player_healing, maxHealing)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={`Total: ${(player.player_healing || 0).toLocaleString()}${player.self_healing != null ? ` | Self: ${(player.self_healing || 0).toLocaleString()}` : ""}${player.teammate_healing != null ? ` | Teammate: ${(player.teammate_healing || 0).toLocaleString()}` : ""}`}
                    >
                      {formatK(player.player_healing)}
                    </span>
                  </td>
                  <td className="p-3 hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {(itemsByPlayer[String(player.account_id)] || []).map(
                        (item, i) => {
                          const src = getLocalItemImage(item);
                          return src ? (
                            <img
                              key={i}
                              src={src}
                              alt={item.name}
                              title={item.name}
                              width={28}
                              height={28}
                              loading="lazy"
                              decoding="async"
                              className="w-7 h-7 rounded object-contain bg-slate-700/50"
                              onError={(e) => {
                                e.target.style.display = "none";
                              }}
                            />
                          ) : null;
                        },
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-amber-500/40">
                <td></td>
                <td></td>
                <td className="text-center p-3 text-sm font-semibold text-amber-300" title={amberTotalSouls.toLocaleString()}>{amberTotalSouls.toLocaleString()}</td>
                <td></td>
                <td></td>
                <td></td>
                <td className="hidden lg:table-cell"></td>
              </tr>
            </tfoot>
          </table>
        </div>

        {/* Team Sapphire */}
        <div className="text-gray-300 shadow rounded-lg py-6">
          <table className="w-full table-auto">
            <thead>
              <tr className="border-b h-10">
                <th className="text-left py-3 w-50 relative overflow-visible align-bottom">
                  <div className="absolute bottom-0 left-2 flex items-end gap-3 pb-1 pointer-events-none">
                    {sapphireTeamName && (
                      <Link to={`/team/${encodeURIComponent(sapphireTeamName)}`} className="pointer-events-auto">
                        <h2 className="text-team-sapphire text-2xl font-bold mb-2 uppercase hover:underline">
                          {sapphireTeamName}
                        </h2>
                      </Link>
                    )}
                    {winningTeam === 1 && (
                      <span className="pointer-events-none mb-2.5 text-xs font-semibold px-2 py-0.5 rounded bg-blue-400/20 text-blue-300 border border-blue-400/40 uppercase tracking-wider">
                        WIN
                      </span>
                    )}
                  </div>
                </th>
                <th className="text-center p-3 w-30 align-bottom">K/D/A</th>
                <th className="text-center p-3 w-25 align-bottom">Souls</th>
                <th className="text-center p-3 w-30 align-bottom">
                  Player DMG
                </th>
                <th className="text-center p-3 w-25 align-bottom">Obj DMG</th>
                <th className="text-center p-3 w-25 align-bottom">Healing</th>
                <th className="text-left p-3 align-bottom">Items</th>
              </tr>
            </thead>
            <tbody>
              {sapphirePlayers.map((player, idx) => (
                <tr
                  key={idx}
                  className={`border-b border-blue-900/30 truncate ${idx % 2 === 0 ? "bg-blue-950/30 hover:bg-blue-900/40" : "bg-indigo-950/20 hover:bg-indigo-900/30"}`}
                >
                  <td className="p-3 text-lg font-bold flex flex-row gap-4 w-40 max-w-40 overflow-hidden">
                    {player.hero_id ? (
                      <Link
                        to={`/hero/${player.hero_id}`}
                        className="block flex items-center gap-2 object-cover flex-shrink-0"
                        title={getHeroName(player.hero_id)}
                      >
                        <img
                          src={getHeroIcon(player.hero_id)}
                          alt={getHeroName(player.hero_id)}
                          className="w-8 h-8 rounded-md object-cover"
                          onError={(e) => {
                            e.target.style.display = "none";
                            e.target.parentElement.innerHTML = getHeroName(
                              player.hero_id,
                            );
                          }}
                        />
                      </Link>
                    ) : (
                      "-"
                    )}
                    <div className="flex flex-col min-w-0 overflow-hidden">
                      {player.account_id ? (
                        <Link
                          to={`/player/${player.account_id}`}
                          className="hover:underline truncate"
                          title={player.persona_name || "Anonymous"}
                        >
                          {player.persona_name || "Anonymous"}
                        </Link>
                      ) : (
                        <span
                          className="truncate"
                          title={player.persona_name || "Anonymous"}
                        >
                          {player.persona_name || "Anonymous"}
                        </span>
                      )}
                      <span className="text-xs text-gray-400 font-normal">
                        {getHeroName(player.hero_id)}
                      </span>
                    </div>
                  </td>

                  <td className="text-center p-3">
                    <span
                      className={`font-semibold ${isMax(player.kills, maxKills) ? "text-yellow-300" : "text-green-400"}`}
                    >
                      {player.kills || 0}
                    </span>
                    <span className="text-gray-400"> / </span>
                    <span className="text-red-400">{player.deaths || 0}</span>
                    <span className="text-gray-400"> / </span>
                    <span
                      className={`${isMax(player.assists, maxAssists) ? "text-yellow-300 font-semibold" : "text-orange-400"}`}
                    >
                      {player.assists || 0}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.net_worth, maxNetWorth)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.net_worth || 0).toLocaleString()}
                    >
                      {formatK(player.net_worth)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.player_damage, maxPlayerDmg)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.player_damage || 0).toLocaleString()}
                    >
                      {formatK(player.player_damage)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.obj_damage, maxObjDmg)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={(player.obj_damage || 0).toLocaleString()}
                    >
                      {formatK(player.obj_damage)}
                    </span>
                  </td>
                  <td className="text-center p-3">
                    <span
                      className={
                        isMax(player.player_healing, maxHealing)
                          ? "text-yellow-300 font-semibold"
                          : ""
                      }
                      title={`Total: ${(player.player_healing || 0).toLocaleString()}${player.self_healing != null ? ` | Self: ${(player.self_healing || 0).toLocaleString()}` : ""}${player.teammate_healing != null ? ` | Teammate: ${(player.teammate_healing || 0).toLocaleString()}` : ""}`}
                    >
                      {formatK(player.player_healing)}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1">
                      {(itemsByPlayer[String(player.account_id)] || []).map(
                        (item, i) => {
                          const src = getLocalItemImage(item);
                          return src ? (
                            <img
                              key={i}
                              src={src}
                              alt={item.name}
                              title={item.name}
                              width={28}
                              height={28}
                              loading="lazy"
                              decoding="async"
                              className="w-7 h-7 rounded object-contain bg-slate-700/50"
                              onError={(e) => {
                                e.target.style.display = "none";
                              }}
                            />
                          ) : null;
                        },
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-blue-500/40">
                <td></td>
                <td></td>
                <td className="text-center p-3 text-sm font-semibold text-blue-300" title={sapphireTotalSouls.toLocaleString()}>{sapphireTotalSouls.toLocaleString()}</td>
                <td></td>
                <td></td>
                <td></td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
      )}
    </div>
  );
}

export default MatchDetail;
