import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import TeamOverviewTab from "../components/team/TeamOverviewTab";
import TeamSeriesTab from "../components/team/TeamSeriesTab";
import TeamMatchesTab from "../components/team/TeamMatchesTab";
import TeamPlayersTab from "../components/team/TeamPlayersTab";

const TABS = ["Overview", "Series", "Matches", "Players"];

function TeamDetail() {
  const { teamName } = useParams();
  const decodedName = decodeURIComponent(teamName);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("Overview");

  useEffect(() => {
    setLoading(true);
    setData(null);
    fetch(`/db/team/${encodeURIComponent(decodedName)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Team not found");
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [decodedName]);

  if (loading)
    return <div className="p-8 text-center text-gray-300">Loading team...</div>;
  if (error) return <div className="p-8 text-red-400">Error: {error}</div>;
  if (!data) return null;

  const { team_name, max_week, total_matches, players, matches, hero_picks } = data;

  // Split current roster (appeared in latest week) vs alumni
  const currentPlayers = players.filter((p) => p.last_week === max_week);
  const historicPlayers = players.filter(
    (p) => max_week == null || p.last_week < max_week
  );

  // Compute win/loss where side data is available
  let wins = 0,
    losses = 0;
  for (const m of matches) {
    const side = m.event_team_a_ingame_side;
    if (side == null) continue;
    const isTeamA = m.event_team_a?.toLowerCase() === team_name.toLowerCase();
    const teamWon = isTeamA
      ? m.winning_team === side
      : m.winning_team !== side;
    if (teamWon) wins++;
    else losses++;
  }
  const hasRecord = wins + losses > 0;

  // Group matches into series and count Night Shift series wins (excluding Challenger Match titles)
  const seriesMap = new Map();
  for (const m of matches) {
    const key = [m.event_team_a, m.event_team_b, m.event_title, m.event_week].join("||");
    if (!seriesMap.has(key)) seriesMap.set(key, []);
    seriesMap.get(key).push(m);
  }
  let nsSeriesWins = 0,
    nsSeriesLosses = 0;
  for (const games of seriesMap.values()) {
    const first = games[0];
    if (first.event_title?.toLowerCase().includes("challenger")) continue;
    let sw = 0, sl = 0;
    for (const m of games) {
      const side = m.event_team_a_ingame_side;
      if (side == null || m.winning_team == null) continue;
      const isTeamA = m.event_team_a?.toLowerCase() === team_name.toLowerCase();
      const won = isTeamA ? m.winning_team === side : m.winning_team !== side;
      if (won) sw++; else sl++;
    }
    if (sw + sl === 0) continue;
    if (sw > sl) nsSeriesWins++;
    else if (sl > sw) nsSeriesLosses++;
  }
  const hasNsRecord = nsSeriesWins + nsSeriesLosses > 0;

  return (
    <div className="w-full px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-2">{team_name}</h1>
        <div className="flex flex-wrap items-center gap-4 text-sm text-gray-400">
          <span>{total_matches} match{total_matches !== 1 ? "es" : ""}</span>
          {max_week != null && <span>Latest: Week {max_week}</span>}
          {hasRecord && (
            <span>
              <span className="text-green-400 font-semibold">{wins}W</span>
              {" – "}
              <span className="text-red-400 font-semibold">{losses}L</span>
            </span>
          )}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-gray-700 mb-6">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-5 py-2 text-sm font-semibold rounded-t transition-colors ${
              activeTab === tab
                ? "bg-gray-800 text-white border-b-2 border-blue-400"
                : "text-gray-400 hover:text-gray-200"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "Overview" && (
        <TeamOverviewTab
          team_name={team_name}
          max_week={max_week}
          total_matches={total_matches}
          currentPlayers={currentPlayers}
          historicPlayers={historicPlayers}
          wins={wins}
          losses={losses}
          hasRecord={hasRecord}
          nsWins={nsSeriesWins}
          nsLosses={nsSeriesLosses}
          hasNsRecord={hasNsRecord}
          heroPicks={hero_picks || []}
        />
      )}
      {activeTab === "Series" && (
        <TeamSeriesTab team_name={team_name} matches={matches} />
      )}
      {activeTab === "Matches" && (
        <TeamMatchesTab team_name={team_name} matches={matches} />
      )}
      {activeTab === "Players" && (
        <TeamPlayersTab
          currentPlayers={currentPlayers}
          historicPlayers={historicPlayers}
          max_week={max_week}
        />
      )}
    </div>
  );
}

export default TeamDetail;
