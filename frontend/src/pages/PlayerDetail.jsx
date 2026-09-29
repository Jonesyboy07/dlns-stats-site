import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import HeroPool from "../components/player/HeroPool";
import HeroWeekMatrix from "../components/player/HeroWeekMatrix";
import OpponentsPanel from "../components/player/OpponentsPanel";
import PlayerIdentityCard from "../components/player/PlayerIdentityCard";
import PlayerMatchTable from "../components/player/PlayerMatchTable";
import ProfileTab from "../components/player/ProfileTab";
import StatTiles from "../components/player/StatTiles";
import TeammatesPanel from "../components/player/TeammatesPanel";
import TenureTimeline from "../components/player/TenureTimeline";
import { heroPool, playedTeams } from "../utils/playerStats";
import { useUrlParam } from "../utils/useUrlParam";

/** Layout 1a: identity card first, then tabs underneath it. */
const TABS = ["Overview", "Heroes", "Matches", "Teams", "Profile"];

/** A player who exists but has never played a league game. */
function NoGamesYet({ persona }) {
  return (
    <section className="rounded-xl border border-dashed border-border-lighter px-5 py-10 text-center">
      <h2 className="font-valve-oracle text-lg text-primary">No league games yet</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-muted">
        {persona} has no Night Shift games on record, so there are no stats to show. Their
        matches may still be sitting in a pre-season bracket.
      </p>
    </section>
  );
}

function PlayerDetail() {
  const { accountId } = useParams();
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // The tab lives in the URL, so refreshing keeps you where you were.
  const [activeTab, setActiveTab] = useUrlParam("tab", TABS, "Overview");
  const [reloadKey, setReloadKey] = useState(0);
  // Shared by the hero pool and the match table's hero filter.
  const heroOptions = useMemo(() => heroPool(matches), [matches]);

  useEffect(() => {
    // Guard against a stale response landing after the id changed.
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [userRes, matchesRes] = await Promise.all([
          fetch(`/db/users/${accountId}`),
          fetch(`/db/users/${accountId}/matches`),
        ]);
        if (!userRes.ok) throw new Error("Player not found");
        const userData = await userRes.json();
        const matchesData = matchesRes.ok ? await matchesRes.json() : { matches: [] };
        if (!alive) return;
        setUser(userData.user);
        setMatches(matchesData.matches || []);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [accountId, reloadKey]);

  if (loading) return <LoadingSkeleton variant="detail" />;
  if (error) {
    return (
      <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />
    );
  }

  const persona = user?.persona_name || "Unknown Player";
  const teamMeta = playedTeams(matches);

  return (
    <div className="w-full px-4 py-6">
      <nav className="mb-3 flex items-center gap-1.5 text-xs text-dim">
        <Link to="/players" className="transition-colors hover:text-secondary">
          Players
        </Link>
        <span>/</span>
        <span className="min-w-0 truncate text-muted" title={persona}>
          {persona}
        </span>
      </nav>

      <PlayerIdentityCard
        user={user}
        accountId={accountId}
        matches={matches}
        teamMeta={teamMeta}
      />

      {matches.length === 0 ? (
        // Identity plus the tiles (all dashes) and one explanation — no tab bar,
        // because every tab would be empty.
        <div className="mt-6 flex flex-col gap-4">
          <StatTiles matches={matches} />
          <NoGamesYet persona={persona} />
        </div>
      ) : (
        <>
          <div role="tablist" className="mt-6 flex gap-1 border-b border-border-light">
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

          <div className="mt-4 flex flex-col gap-4">
            {activeTab === "Overview" && (
              <>
                <StatTiles matches={matches} />
                <HeroPool
                  matches={matches}
                  accountId={accountId}
                  playerName={persona}
                  limit={6}
                />
                <PlayerMatchTable
                  accountId={accountId}
                  totalGames={matches.length}
                  heroOptions={heroOptions}
                  pageSize={8}
                  title="Recent matches"
                />
                <TenureTimeline matches={matches} />
              </>
            )}

            {activeTab === "Heroes" && (
              <>
                <HeroPool
                  matches={matches}
                  accountId={accountId}
                  playerName={persona}
                  limit={20}
                />
                <HeroWeekMatrix matches={matches} />
              </>
            )}

            {activeTab === "Matches" && (
              <PlayerMatchTable
                accountId={accountId}
                totalGames={matches.length}
                heroOptions={heroOptions}
                pageSize={20}
                title="All matches"
                syncUrl
              />
            )}

            {activeTab === "Teams" && (
              <>
                <TenureTimeline matches={matches} />
                <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
                  <TeammatesPanel accountId={accountId} />
                  <OpponentsPanel accountId={accountId} />
                </div>
              </>
            )}

            {activeTab === "Profile" && (
              <ProfileTab accountId={accountId} matches={matches} />
            )}
          </div>
        </>
      )}
    </div>
  );
}

export default PlayerDetail;
