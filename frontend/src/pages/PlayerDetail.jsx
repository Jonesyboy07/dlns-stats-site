import React, { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";

function PlayerDetail() {
  const { accountId } = useParams();
  const [user, setUser] = useState(null);
  const [stats, setStats] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchPlayerData();
  }, [accountId]);

  const fetchPlayerData = async () => {
    try {
      setLoading(true);

      // Fetch user info
      const userResponse = await fetch(`/db/users/${accountId}`);
      if (!userResponse.ok) {
        throw new Error("Player not found");
      }
      const userData = await userResponse.json();
      setUser(userData.user);

      // Fetch user stats
      const statsResponse = await fetch(`/db/users/${accountId}/stats`);
      if (statsResponse.ok) {
        const statsData = await statsResponse.json();
        setStats(statsData.stats);
      }

      // Fetch recent matches
      const matchesResponse = await fetch(`/db/users/${accountId}/matches`);
      if (matchesResponse.ok) {
        const matchesData = await matchesResponse.json();
        setMatches(matchesData.matches || []);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleString();
  };

  const teamName = (team) => {
    return team === 0 ? "Amber" : team === 1 ? "Sapphire" : "Unknown";
  };

  const heroCardUrl = (heroName) => {
    const slug = heroName
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/\s+/g, "_");
    return `/static/images/cardicons/${slug}_card_psd.png`;
  };

  const [expandedTeams, setExpandedTeams] = useState({});

  const toggleTeam = (name) =>
    setExpandedTeams((prev) => ({ ...prev, [name]: !prev[name] }));

  const getTeamHistory = () => {
    const teamMap = {};
    for (const match of matches) {
      const { event_team_a, event_team_b, event_team_a_ingame_side, team, result, event_week } = match;
      if (!event_team_a && !event_team_b) continue;
      let teamName = null;
      if (event_team_a_ingame_side != null) {
        teamName = team === event_team_a_ingame_side ? event_team_a : event_team_b;
      }
      if (!teamName) continue;
      if (!teamMap[teamName]) {
        teamMap[teamName] = { name: teamName, games: 0, wins: 0, weeks: new Set() };
      }
      teamMap[teamName].games++;
      if (result === "Win") teamMap[teamName].wins++;
      if (event_week != null) teamMap[teamName].weeks.add(event_week);
    }
    return Object.values(teamMap)
      .map((t) => ({
        ...t,
        weeks: [...t.weeks].sort((a, b) => a - b),
        weekStats: Object.fromEntries(
          [...t.weeks].sort((a, b) => a - b).map((w) => [
            w,
            (() => {
              const wMatches = matches.filter(
                (m) =>
                  m.event_week === w &&
                  m.event_team_a_ingame_side != null &&
                  (m.team === m.event_team_a_ingame_side
                    ? m.event_team_a
                    : m.event_team_b) === t.name
              );
              return {
                games: wMatches.length,
                wins: wMatches.filter((m) => m.result === "Win").length,
              };
            })()
          ])
        ),
      }))
      .sort((a, b) => b.games - a.games);
  };

  const getPlayerStats = () => {
    const played = matches.filter((m) => m.kills != null || m.deaths != null);
    if (played.length === 0) return null;
    const fields = [
      { key: "kills", label: "Kills" },
      { key: "deaths", label: "Deaths" },
      { key: "assists", label: "Assists" },
      { key: "net_worth", label: "Net Worth" },
      { key: "player_damage", label: "Player Dmg" },
      { key: "obj_damage", label: "Obj Dmg" },
      { key: "player_healing", label: "Healing" },
    ];
    return fields.map(({ key, label }) => {
      const values = played.map((m) => m[key] || 0);
      const highest = Math.max(...values);
      const avg = values.reduce((s, v) => s + v, 0) / played.length;
      return { key, label, highest, avg };
    });
  };

  const getMostPlayedHeroes = () => {
    const heroMap = {};
    for (const match of matches) {
      const id = match.hero_id;
      if (!id) continue;
      if (!heroMap[id]) {
        heroMap[id] = {
          hero_id: id,
          hero_name: match.hero_name || `Hero ${id}`,
          games: 0,
          wins: 0,
          kills: 0,
          deaths: 0,
          assists: 0,
        };
      }
      heroMap[id].games++;
      if (match.result === "Win") heroMap[id].wins++;
      heroMap[id].kills += match.kills || 0;
      heroMap[id].deaths += match.deaths || 0;
      heroMap[id].assists += match.assists || 0;
    }
    return Object.values(heroMap)
      .sort((a, b) => b.games - a.games)
      .slice(0, 5);
  };

  if (loading) {
    return (
      <div className="w-full p-8">
        <div className="text-center text-xl">Loading player details...</div>
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

  return (
    <div className="w-full p-8">
      {/* Player Header */}
      <div className="mb-6">
        <h1 className="text-white text-3xl font-bold mb-2">
          {user?.persona_name || "Unknown Player"}
        </h1>
        <p className="text-gray-600">Account ID: {accountId}</p>
      </div>


      {/* Team History */}
      {(() => {
        const teamHistory = getTeamHistory();
        return teamHistory.length > 0 ? (
          <div className="bg-panel text-gray-300 shadow rounded-lg p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4">Team History</h2>
            <div className="space-y-2">
              {teamHistory.map((t) => (
                <div key={t.name} className="rounded-lg border border-gray-700 bg-gray-800/40 overflow-hidden">
                  {/* Header row */}
                  <button
                    onClick={() => toggleTeam(t.name)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700/50 transition-all text-left"
                  >
                    <Link
                      to={`/team/${encodeURIComponent(t.name)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="font-semibold text-gray-100 hover:underline"
                    >
                      {t.name}
                    </Link>
                    <div className="flex items-center gap-4 text-sm text-gray-400">
                      <span>{t.games} match{t.games !== 1 ? "es" : ""}</span>
                      <span>
                        <span className="text-green-400 font-semibold">{t.wins}W</span>
                        {" – "}
                        <span className="text-red-400 font-semibold">{t.games - t.wins}L</span>
                      </span>
                      {t.weeks.length > 0 && (
                        <span>Wk {t.weeks[0]}{t.weeks.length > 1 ? `–${t.weeks[t.weeks.length - 1]}` : ""}</span>
                      )}
                      <span className="text-gray-500 text-xs">{expandedTeams[t.name] ? "▲" : "▼"}</span>
                    </div>
                  </button>

                  {/* Expanded week list */}
                  {expandedTeams[t.name] && (
                    <div className="border-t border-gray-700/60 divide-y divide-gray-700/40">
                      {t.weeks.map((w) => {
                        const ws = t.weekStats[w];
                        return (
                          <Link
                            key={w}
                            to={`/week/${w}`}
                            className="flex items-center justify-between px-6 py-2.5 hover:bg-gray-700/40 transition-all"
                          >
                            <span className="text-sm text-gray-300">Week {w}</span>
                            <div className="flex items-center gap-3 text-xs text-gray-400">
                              <span>{ws.games} match{ws.games !== 1 ? "es" : ""}</span>
                              <span>
                                <span className="text-green-400">{ws.wins}W</span>
                                {" – "}
                                <span className="text-red-400">{ws.games - ws.wins}L</span>
                              </span>
                            </div>
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : null;
      })()}

      {/* Most Played Heroes */}
      {matches.length > 0 && (
        <div className="bg-panel text-gray-300 shadow rounded-lg p-6 mb-6">
          <h2 className="text-2xl font-bold mb-4">Most Played Heroes</h2>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left">Hero</th>
                  <th className="text-left ">Games</th>

                  <th className="text-left ">W-L</th>
                  <th className="text-left">Avg KDA</th>
                  <th className="text-left ">Win Rate</th>
                </tr>
              </thead>
              <tbody>
                {getMostPlayedHeroes().map((hero) => (
                  <tr
                    key={hero.hero_id}
                    className="border-b border-gray-700 hover:bg-slate-800/90"
                  >
                    <td className="p-2">
                      <Link
                        to={`/player/${accountId}/hero/${hero.hero_id}`}
                        className="flex items-center gap-3 hover:opacity-80 transition-opacity"
                      >
                        <img
                          src={heroCardUrl(hero.hero_name)}
                          alt={hero.hero_name}
                          className="w-10 h-12 object-cover border border-slate-800/90 rounded-xs"
                          onError={(e) => {
                            e.target.style.display = "none";
                          }}
                        />
                        <span className="font-medium text-blue-600 hover:underline">
                          {hero.hero_name}
                        </span>
                      </Link>
                    </td>

                    <td className="">{hero.games}</td>

                    <td className="">
                      <span className="text-green-600">{hero.wins}</span>
                      <span className="text-gray-400"> - </span>
                      <span className="text-red-600">
                        {hero.games - hero.wins}
                      </span>
                    </td>
                    <td className="">
                      {(
                        (hero.kills + hero.assists) /
                        Math.max(hero.deaths, 1)
                      ).toFixed(2)}
                      <span className="text-gray-400 text-xs ml-1">
                        ({(hero.kills / hero.games).toFixed(1)} /{" "}
                        {(hero.deaths / hero.games).toFixed(1)} /{" "}
                        {(hero.assists / hero.games).toFixed(1)})
                      </span>
                    </td>
                    <td className="">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-slate-600 rounded-full h-2">
                          <div
                            className="bg-green-500 h-2 rounded-full"
                            style={{
                              width: `${((hero.wins / hero.games) * 100).toFixed(0)}%`,
                            }}
                          />
                        </div>
                        <span>
                          {((hero.wins / hero.games) * 100).toFixed(0)}%
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Stats Summary */}
      {(() => {
        const playerStats = getPlayerStats();
        if (!playerStats) return null;
        const fmtK = (v) => v >= 1000 ? (v / 1000).toFixed(1) + "k" : v.toFixed(0);
        return (
          <div className="bg-panel text-gray-300 shadow rounded-lg p-6 mb-6">
            <h2 className="text-2xl font-bold mb-4">Stats Summary</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-700">
                    <th className="text-left py-2 pr-4 text-gray-400 font-semibold">Stat</th>
                    <th className="text-right py-2 px-4 text-gray-400 font-semibold">Highest</th>
                    <th className="text-right py-2 pl-4 text-gray-400 font-semibold">Average</th>
                  </tr>
                </thead>
                <tbody>
                  {playerStats.map(({ key, label, highest, avg }) => (
                    <tr key={key} className="border-b border-gray-700/50 hover:bg-gray-800/40">
                      <td className="py-2 pr-4 text-gray-300 font-medium">{label}</td>
                      <td className="py-2 px-4 text-right">
                        <span className="text-yellow-300 font-semibold" title={highest.toLocaleString()}>
                          {fmtK(highest)}
                        </span>
                      </td>
                      <td className="py-2 pl-4 text-right">
                        <span className="text-gray-200" title={avg.toLocaleString()}>
                          {fmtK(avg)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Recent Matches */}
      <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
        <h2 className="text-2xl font-bold mb-4">Recent Matches</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b">
              <th className="text-left p-3">Match</th>
              <th className="text-left p-3">Hero</th>
              <th className="text-left p-3">Result</th>
              <th className="text-left p-3">Team</th>
              <th className="text-left p-3">K/D/A</th>
              <th className="text-left p-3">Date</th>
            </tr>
          </thead>
          <tbody>
            {matches.length === 0 ? (
              <tr>
                <td colSpan="6" className="p-4 text-center text-gray-400">
                  No matches found
                </td>
              </tr>
            ) : (
              matches.slice(0, 20).map((match) => (
                <tr
                  key={match.match_id}
                  className="border-b border-gray-700 hover:bg-slate-800/90"
                >
                  <td className="p-3">
                    <Link
                      to={`/match/${match.match_id}`}
                      className="text-blue-600 hover:underline"
                    >
                      {match.match_id}
                    </Link>
                  </td>
                  <td className="p-3">
                    {match.hero_name || match.hero_id || "-"}
                  </td>
                  <td className="p-3">
                    <span
                      className={`font-semibold ${
                        match.result === "Win"
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {match.result || "-"}
                    </span>
                  </td>
                  <td className="p-3">{teamName(match.team)}</td>
                  <td className="p-3">
                    {match.kills || 0} / {match.deaths || 0} /{" "}
                    {match.assists || 0}
                  </td>
                  <td className="p-3 text-sm text-gray-400">
                    {formatDate(match.start_time || match.created_at)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default PlayerDetail;
