import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import TeamIdentityCard from "../components/team/TeamIdentityCard";
import TeamOverviewTab from "../components/team/TeamOverviewTab";
import TeamPlayersTab from "../components/team/TeamPlayersTab";
import TeamSeriesTab from "../components/team/TeamSeriesTab";
import { formatRecord } from "../utils/format";

const TABS = ["Overview", "Series", "Players"];

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

  const {
    team_name,
    max_week,
    players = [],
    matches = [],
    hero_picks = [],
    record = {},
    form = [],
    durations,
  } = data;

  // Split current roster (appeared in latest week) vs alumni
  const currentPlayers = players.filter(
    (p) => max_week == null || p.last_week === max_week
  );
  const rosterPlayers = currentPlayers.length > 0 ? currentPlayers : players;
  const historicPlayers = players.filter(
    (p) => max_week != null && p.last_week < max_week
  );

  const seriesRecord = formatRecord(record.series?.wins, record.series?.losses);
  const gameRecord = formatRecord(record.games?.wins, record.games?.losses);

  return (
    <div className="w-full px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <TeamIdentityCard
          teamName={team_name}
          seriesRecord={seriesRecord}
          gameRecord={gameRecord}
          form={form}
        />
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
          players={rosterPlayers}
          maxWeek={max_week}
          durations={durations}
          heroPicks={hero_picks}
        />
      )}
      {activeTab === "Series" && (
        <TeamSeriesTab team_name={team_name} matches={matches} />
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
