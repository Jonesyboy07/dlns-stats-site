import React, { useState, useEffect } from "react";
import { Link, useParams } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import TeamIdentityCard from "../components/team/TeamIdentityCard";
import TeamOverviewTab from "../components/team/TeamOverviewTab";
import TeamPlayersTab from "../components/team/TeamPlayersTab";
import TeamSeriesTab from "../components/team/TeamSeriesTab";
import { formatPercent, formatRecord } from "../utils/format";
import { recordOf, teamWeekRange } from "../utils/team";
import { isActivePlayer } from "../utils/timeline";
import { useUrlParam } from "../utils/useUrlParam";

const TABS = ["Overview", "Series", "Players"];

function TeamDetail() {
  const { teamName } = useParams();
  const decodedName = decodeURIComponent(teamName);

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The tab lives in the URL, so refreshing keeps you where you were.
  const [activeTab, setActiveTab] = useUrlParam("tab", TABS, "Overview");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError(null);
    fetch(`/db/team/${encodeURIComponent(decodedName)}`)
      .then((r) => {
        if (!r.ok) throw new Error("Team not found");
        return r.json();
      })
      .then((json) => {
        if (alive) setData(json);
      })
      .catch((e) => {
        if (alive) setError(e.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [decodedName]);

  if (loading) return <LoadingSkeleton variant="detail" />;
  if (error) return <ErrorMessage message={error} />;
  if (!data) return null;

  const {
    team_name,
    max_week,
    roster_weeks = [],
    players = [],
    matches = [],
    hero_picks = [],
    record = {},
    form = [],
    durations,
    leaderboard,
    hero_usage,
  } = data;

  // Current roster = players who turned out in the team's latest week. The tenure
  // grid covers everyone, so there is no separate alumni list.
  const currentPlayers = players.filter((p) => isActivePlayer(p, max_week));
  const rosterPlayers = currentPlayers.length > 0 ? currentPlayers : players;

  const gameRecord = recordOf(record.games?.wins, record.games?.losses);
  const weekRange = teamWeekRange(matches);

  return (
    <div className="w-full px-4 py-6">
      <div className="mb-6 flex flex-col gap-3">
        <nav aria-label="Breadcrumb" className="flex items-center gap-2 text-[13px] font-semibold">
          <Link to="/teams" className="text-muted transition-colors hover:text-primary">
            Teams
          </Link>
          <span className="text-dim">/</span>
          <span className="min-w-0 truncate text-secondary">{team_name}</span>
        </nav>

        <TeamIdentityCard
          teamName={team_name}
          seriesRecord={formatRecord(record.series?.wins, record.series?.losses)}
          gameRecord={formatRecord(record.games?.wins, record.games?.losses)}
          winRate={gameRecord.played ? formatPercent(gameRecord.barPct) : null}
          weekRange={weekRange}
          activePlayers={currentPlayers.length > 0 ? currentPlayers.length : null}
          form={form}
        />
      </div>

      {/* Same tab treatment as the player pages: a rule under the row with the
          active tab's underline sitting on it, rather than a filled pill. */}
      <div role="tablist" className="mb-6 flex gap-1 border-b border-border-light">
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            onClick={() => setActiveTab(tab)}
            className={`-mb-px border-b-2 px-4 py-2.5 font-valve-oracle text-[15px] font-semibold transition-colors ${
              activeTab === tab
                ? "border-accent-secondary text-primary"
                : "border-transparent text-muted hover:text-secondary"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

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
          players={players}
          rosterWeeks={roster_weeks}
          max_week={max_week}
          leaderboard={leaderboard}
          heroUsage={hero_usage}
        />
      )}
    </div>
  );
}

export default TeamDetail;
