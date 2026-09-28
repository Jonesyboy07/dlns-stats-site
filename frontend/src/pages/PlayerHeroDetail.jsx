import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import HeroCard from "../components/HeroCard";
import HeroIcon from "../components/HeroIcon";
import HeroRankBadges from "../components/player/HeroRankBadges";
import PlayerAvatar from "../components/PlayerAvatar";
import AbilityBuildBody from "../components/player/AbilityBuildBody";
import FormStrip from "../components/player/FormStrip";
import HeroItemBuildBody from "../components/player/HeroItemBuildBody";
import HeroStatTiles from "../components/player/HeroStatTiles";
import LaneCardBody from "../components/player/LaneCardBody";
import Panel from "../components/player/Panel";
import PlayerMatchTable from "../components/player/PlayerMatchTable";
import SegmentedControl from "../components/player/SegmentedControl";
import TrendChart from "../components/player/TrendChart";
import { laneBreakdown } from "../utils/lanes";
import { headlineStats, heroPool, heroTrend } from "../utils/playerStats";

/** The metrics the trend can plot, in toggle order. */
const TREND_METRICS = [
  { id: "kda", label: "KDA" },
  { id: "spm", label: "Souls/min" },
];

/** The two views the card beside the trend can show. */
const SIDE_TABS = [
  { id: "lane", label: "Lane" },
  { id: "matchups", label: "Matchups" },
];

/**
 * Player × Hero (layout 2a): how good this player is on one hero.
 *
 * The player's own numbers (tiles, form, trend, lane split) are derived from the
 * match list the page already loads, so they follow exactly the same rules as the
 * player page. Only the cross-player figures — league baselines on this hero, the
 * standings, the ability orders and the matchups — come from
 * `/db/users/:id/hero/:heroId`.
 */
function PlayerHeroDetail() {
  const { accountId, heroId } = useParams();
  const [user, setUser] = useState(null);
  const [matches, setMatches] = useState([]);
  const [hero, setHero] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [metric, setMetric] = useState("kda");
  const [sideTab, setSideTab] = useState("lane");

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [userRes, matchesRes, heroRes] = await Promise.all([
          fetch(`/db/users/${accountId}`),
          fetch(`/db/users/${accountId}/matches`),
          fetch(`/db/users/${accountId}/hero/${heroId}`),
        ]);
        if (!userRes.ok) throw new Error("Player not found");
        const userData = await userRes.json();
        const matchesData = matchesRes.ok ? await matchesRes.json() : { matches: [] };
        const heroData = heroRes.ok ? await heroRes.json() : null;
        if (!alive) return;
        setUser(userData.user);
        setMatches(matchesData.matches || []);
        setHero(heroData);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [accountId, heroId, reloadKey]);

  const heroMatches = useMemo(
    () => matches.filter((match) => String(match.hero_id) === String(heroId)),
    [matches, heroId],
  );
  const pool = useMemo(() => heroPool(heroMatches)[0] ?? null, [heroMatches]);
  const own = useMemo(() => headlineStats(matches), [matches]);
  const trend = useMemo(() => heroTrend(heroMatches, metric), [heroMatches, metric]);
  const lanes = useMemo(() => laneBreakdown(heroMatches), [heroMatches]);

  if (loading) return <LoadingSkeleton variant="detail" />;
  if (error) {
    return <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  const persona = user?.persona_name || "Unknown Player";
  const heroName = hero?.hero_name || heroMatches[0]?.hero_name || `Hero ${heroId}`;
  const hasGames = heroMatches.length > 0;

  return (
    <div className="w-full px-4 py-6">
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-xs text-dim">
        <Link to={`/player/${accountId}`} className="transition-colors hover:text-secondary">
          {persona}
        </Link>
        <span>/</span>
        <span className="min-w-0 truncate text-muted">{heroName}</span>
        <span className="ml-auto">
          <Link to={`/hero/${heroId}`} className="transition-colors hover:text-secondary">
            {heroName} hero page →
          </Link>
        </span>
      </nav>

      <section className="mb-4 grid items-end gap-6 rounded-xl border border-border-light bg-card p-5 shadow md:grid-cols-[120px_minmax(0,1fr)_auto]">
        <div className="relative h-[200px] w-[120px]">
          <HeroCard name={heroName} size="h-[200px] w-[120px]" className="rounded-xl" />
          <span className="absolute -bottom-2.5 -right-2.5 rounded-[10px] border-[3px] border-card bg-input p-0.5">
            <HeroIcon name={heroName} size="h-9 w-9" className="rounded-lg" />
          </span>
        </div>

        <div className="flex min-w-0 flex-col gap-2.5 pb-1">
          <span className="text-[11px] uppercase tracking-[.08em] text-dim">Player on hero</span>
          <h1 className="truncate font-valve-pulp text-[40px] leading-[.95] text-primary md:text-[52px]">
            {heroName}
          </h1>
          <Link
            to={`/player/${accountId}`}
            className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-secondary"
          >
            <PlayerAvatar player={user} size="h-8 w-8" rounded="rounded-lg" />
            <span className="flex min-w-0 flex-col">
              <b className="truncate text-[15px] text-primary">{persona}</b>
              <span className="truncate text-[12px] text-muted">
                {hero?.team ? `${hero.team} · ` : ""}
                {hasGames ? `${heroMatches.length} games on ${heroName}` : `no ${heroName} games`}
                {hero?.first_week != null
                  ? ` · first NS ${hero.first_week} · last NS ${hero.last_week}`
                  : ""}
              </span>
            </span>
          </Link>

          {hasGames && (
            <FormStrip
              matches={heroMatches}
              size={10}
              showSummary={false}
              direction="row"
              label={`Last 10 on ${heroName}`}
            />
          )}
        </div>

        <HeroRankBadges rank={hero?.rank} heroName={heroName} />
      </section>

      {!hasGames ? (
        <section className="rounded-xl border border-dashed border-border-lighter px-5 py-10 text-center">
          <h2 className="font-valve-oracle text-lg text-primary">No {heroName} games yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted">
            {persona} has not played {heroName} in a league game, so there are no numbers
            for this pairing. The hero page holds the league-wide picture instead.
          </p>
          <Link
            to={`/hero/${heroId}`}
            className="mt-4 inline-block rounded-lg border border-border-light bg-input px-4 py-2 text-[13px] font-semibold text-secondary transition-colors hover:bg-hover"
          >
            {heroName} hero page
          </Link>
        </section>
      ) : (
        <div className="flex flex-col gap-4">
          <HeroStatTiles
            pool={pool}
            own={own}
            league={hero?.league ?? {}}
            rank={hero?.rank}
            heroName={heroName}
            totalGames={matches.length}
          />

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title="Performance Trend"
              subtitle="One bar per game, oldest → newest · dashed line = average"
              action={
                <SegmentedControl
                  options={TREND_METRICS}
                  value={metric}
                  onChange={setMetric}
                  label="Trend metric"
                />
              }
            >
              <TrendChart trend={trend} metric={metric} />
            </Panel>

            <Panel
              title={sideTab === "lane" ? "Lane" : "Matchups"}
              subtitle={
                sideTab === "lane"
                  ? "Where they played · win rate per lane"
                  : `Record against the heroes faced on ${heroName}`
              }
              action={
                <SegmentedControl
                  options={SIDE_TABS}
                  value={sideTab}
                  onChange={setSideTab}
                  label="Lane or matchups"
                />
              }
            >
              <LaneCardBody
                tab={sideTab}
                lanes={lanes}
                matchups={hero?.matchups ?? []}
                heroName={heroName}
              />
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              title="Ability Build"
              subtitle={`Ability point order on ${heroName} · one column per unlock or upgrade, in order`}
            >
              <AbilityBuildBody builds={hero?.ability_builds} heroName={heroName} />
            </Panel>

            <Panel
              title="Item Build"
              subtitle={`Most common order on ${heroName} · median buy time`}
            >
              <HeroItemBuildBody items={hero?.items} heroName={heroName} />
            </Panel>
          </div>

          <PlayerMatchTable
            accountId={accountId}
            heroId={heroId}
            totalGames={heroMatches.length}
            pageSize={10}
            title={`Match History on ${heroName}`}
            firstColumn="lane"
          />
        </div>
      )}
    </div>
  );
}

export default PlayerHeroDetail;
