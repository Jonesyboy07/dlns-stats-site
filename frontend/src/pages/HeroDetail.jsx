import React, { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import heroNamesData from "../../../data/hero_names.json";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import HeroIcon from "../components/HeroIcon";
import HeroIdentityCard from "../components/heroes/HeroIdentityCard";
import HeroHeadlineTiles from "../components/heroes/HeroHeadlineTiles";
import HeroCombatPanel from "../components/heroes/HeroCombatPanel";
import HeroItemBuildPanel from "../components/heroes/HeroItemBuildPanel";
import HeroMatchupsPanel from "../components/heroes/HeroMatchupsPanel";
import HeroTopPlayersPanel from "../components/heroes/HeroTopPlayersPanel";
import HeroRecordsPanel from "../components/heroes/HeroRecordsPanel";
import HeroBestDuoPanel from "../components/heroes/HeroBestDuoPanel";
import HeroHeadToHeadPanel from "../components/heroes/HeroHeadToHeadPanel";
import PlaceholderPanel from "../components/heroes/PlaceholderPanel";
import {
  HeroAbilityBuildPanel,
  HeroGameLengthPanel,
  HeroLanePanel,
  HeroMetaTrendPanel,
  HeroRecentGamesPanel,
  HeroSideSplitPanel,
  HeroSoulsCurvePanel,
} from "../components/heroes/HeroPanels";
import { formatInteger } from "../utils/format";
import { LANE_META } from "../utils/lanes";
import { formatPercent, ordinal, signedPoints } from "../utils/heroPages";

const DASH = "—";
/** Panels only unlock once a hero has this many games. */
const MIN_GAMES = 10;

/**
 * Hero detail (layout 2a): the identity card, five headline tiles and the
 * analysis panels, all driven by one profile payload.
 *
 * The scope is fixed — the whole Night Shift league run, every week to date — and
 * every comparison is against the league average. Per-week samples are far too
 * small for a hero to mean anything, so there is no scope selector. The label
 * itself comes from the API (`profile.scope.label`) so it stays true as weeks
 * are added; never hard-code the range here.
 *
 * Ban rate and the Death Profile need data that does not exist yet and render
 * "Adding Soon".
 */
function HeroDetail() {
  const { heroId } = useParams();
  const [meta, setMeta] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    fetch(`/db/heroes/${heroId}/meta`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (alive) setMeta(data);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [heroId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(`/db/heroes/${heroId}/profile`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load hero profile");
        return res.json();
      })
      .then((data) => {
        if (!alive) return;
        setProfile(data);
      })
      .catch((err) => {
        if (alive) setError(err.message);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [heroId, reloadKey]);

  const names = heroNamesData.heroes ?? {};
  const heroName = profile?.hero_name ?? names[heroId]?.name ?? `Hero ${heroId}`;

  const released = useMemo(
    () =>
      Object.entries(heroNamesData.heroes ?? {})
        .filter(([, data]) => data.released)
        .map(([id, data]) => ({ id, name: data.name }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );
  const index = released.findIndex((hero) => hero.id === heroId);
  const prevHero = index >= 0 ? released[(index - 1 + released.length) % released.length] : null;
  const nextHero = index >= 0 ? released[(index + 1) % released.length] : null;

  const abilities = useMemo(
    () =>
      (meta?.abilities ?? []).map((ability) => ({
        name: ability.name,
        image: ability.image,
        invert: ability.invert,
      })),
    [meta],
  );

  const perHero = profile?.per_hero ?? [];

  const rankLabel = (key, label) => {
    const entry = profile?.rank?.[key];
    return entry ? `${ordinal(entry.rank)} of ${entry.of} by ${label}` : "Adding Soon";
  };

  const meanOf = (key) => {
    const values = perHero.map((row) => row[key]).filter((value) => value != null);
    return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  };

  const rankIn = (key, lower = false) => {
    const ranked = perHero
      .filter((row) => row[key] != null)
      .sort((a, b) => (lower ? a[key] - b[key] : b[key] - a[key]));
    const at = ranked.findIndex((row) => row.hero_id === profile?.hero_id);
    return at === -1 ? null : { rank: at + 1, of: ranked.length };
  };

  if (loading) return <LoadingSkeleton variant="detail" />;
  if (error && !profile) {
    return <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />;
  }

  const games = profile?.games ?? 0;
  const wins = profile?.wins ?? 0;
  const losses = profile?.losses ?? 0;
  const sparse = games < MIN_GAMES;
  const league = profile?.league ?? {};
  const leagueWinRate = league.win_rate ?? 0.5;

  const tiles = [
    {
      label: "Win rate",
      value: formatPercent(profile?.win_rate),
      delta:
        profile?.win_rate == null
          ? null
          : {
              text: signedPoints((profile.win_rate - leagueWinRate) * 100),
              tone: profile.win_rate >= leagueWinRate ? "good" : "bad",
              title: `League-average hero: ${formatPercent(leagueWinRate)}`,
            },
      sub: `vs league-average hero (${formatPercent(leagueWinRate)})`,
      rank: sparse ? "Unranked · needs 10+ games" : rankLabel("by_win_rate", "win rate"),
      rankDim: sparse,
    },
    {
      label: "Pick rate",
      value: formatPercent(perHero.find((row) => row.hero_id === profile?.hero_id)?.pick_rate),
      delta: null,
      sub: `vs average hero (${formatPercent(league.pick_rate)})`,
      rank: sparse ? "Unranked · needs 10+ games" : rankLabel("by_pick_rate", "pick rate"),
      rankDim: sparse,
    },
    {
      label: "Ban rate",
      value: DASH,
      sub: "of drafts banned · Adding Soon",
      rank: "Adding Soon",
      rankDim: true,
    },
    {
      label: "Games played",
      value: games ? String(games) : DASH,
      sub:
        profile?.total_matches != null
          ? `of ${profile.total_matches.toLocaleString()} league games in scope`
          : "Adding Soon",
      rank: sparse ? "Unranked · needs 10+ games" : rankLabel("by_games", "games"),
      rankDim: sparse,
    },
    {
      label: "Wins",
      value: wins ? String(wins) : DASH,
      wl: { wins, losses },
      sub: "Win–loss record in scope",
      rank: sparse ? "Unranked · needs 10+ games" : rankLabel("by_wins", "wins"),
      rankDim: sparse,
    },
  ];

  const damageRank = rankIn("damage_per_game");
  const soulsRank = rankIn("souls_per_game");
  const deathsRank = rankIn("deaths_per_game", true);
  const rankText = (rank) => (rank ? `${ordinal(rank.rank)} of ${rank.of}` : "Adding Soon");

  const combat = profile?.combat ?? {};
  const rates = [
    {
      label: "Damage",
      value: formatInteger(combat.damage) ?? DASH,
      caption: `League avg ${formatInteger(meanOf("damage_per_game")) ?? DASH} · ${rankText(damageRank)}`,
    },
    {
      label: "Souls",
      value: formatInteger(combat.souls) ?? DASH,
      caption: `League avg ${formatInteger(meanOf("souls_per_game")) ?? DASH} · ${rankText(soulsRank)}`,
    },
    {
      label: "Deaths",
      value: combat.deaths == null ? DASH : combat.deaths.toFixed(1),
      caption: `League avg ${
        meanOf("deaths_per_game") == null ? DASH : meanOf("deaths_per_game").toFixed(1)
      } · ${rankText(deathsRank)} (lower is better)`,
    },
  ];

  const duos = (profile?.matchups?.with ?? [])
    .slice()
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .slice(0, 3)
    .map((row) => ({
      heroId: String(row.hero_id),
      name: row.hero_name,
      games: row.games,
      winRate: row.win_rate ?? 0,
      delta: (row.win_rate ?? 0) - (profile?.win_rate ?? 0),
    }));

  const placeholder = (title, subtitle) => (
    <PlaceholderPanel
      key={title}
      title={title}
      subtitle={subtitle}
      note={sparse ? "Not enough games" : "Adding Soon"}
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-[14px]">
          <Link to="/heroes" className="text-muted no-underline transition-colors hover:text-accent-secondary-light">
            Heroes
          </Link>
          <span className="text-dim">/</span>
          <span className="font-semibold text-primary">{heroName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {prevHero && (
            <Link
              to={`/hero/${prevHero.id}`}
              title={prevHero.name}
              className="flex max-w-[170px] items-center gap-2 rounded-full border border-border-light bg-card py-1 pl-1.5 pr-3 text-[13px] text-secondary no-underline transition-colors hover:bg-hover"
            >
              <span className="text-dim">‹</span>
              <HeroIcon name={prevHero.name} size="h-6 w-6" className="rounded-full" />
              <span className="truncate">{prevHero.name}</span>
            </Link>
          )}
          {nextHero && (
            <Link
              to={`/hero/${nextHero.id}`}
              title={nextHero.name}
              className="flex max-w-[170px] items-center gap-2 rounded-full border border-border-light bg-card py-1 pl-3 pr-1.5 text-[13px] text-secondary no-underline transition-colors hover:bg-hover"
            >
              <span className="truncate">{nextHero.name}</span>
              <HeroIcon name={nextHero.name} size="h-6 w-6" className="rounded-full" />
              <span className="text-dim">›</span>
            </Link>
          )}
        </div>
      </div>

      <HeroIdentityCard name={heroName} tagline={meta?.tagline ?? []} abilities={abilities} />

      {sparse && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4">
          <p className="m-0 font-semibold text-warning">Not enough games</p>
          <p className="m-0 mt-0.5 text-[13px] text-secondary">
            {heroName} has {games} game{games === 1 ? "" : "s"} in the Night Shift league.
            Profile panels unlock at {MIN_GAMES} games.
          </p>
        </div>
      )}

      <HeroHeadlineTiles tiles={tiles} rates={rates} />

      {sparse ? (
        <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}>
          {[
            ["Meta Trend", "Win % and pick % by week"],
            ["Recent Games", "Last 8 games in scope"],
            ["Combat & Economy", "Per-minute and per-game averages"],
            ["Item Builds", "Most-bought items by slot"],
            ["Ability Build", "Ability point order"],
            ["Matchups", "Win rate with and against other heroes"],
            ["Souls Curve", "Net worth over game time"],
            ["Lane Profile", "Assigned lane vs actual"],
            ["Side Split", "Win rate by team side"],
            ["Game-Length Profile", "Win rate by game length"],
            ["Best Duo", "Standout partner hero"],
            ["Top Players", "Most successful players"],
            ["Death Profile", "When and where this hero dies"],
            ["Records", "Best single games"],
          ].map(([title, subtitle]) => placeholder(title, subtitle))}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[7_1_560px] flex-col gap-4">
            <HeroMetaTrendPanel weekly={profile?.weekly ?? []} heroName={heroName} />
            <HeroRecentGamesPanel recent={profile?.recent ?? []} />
            <HeroCombatPanel combat={combat} league={profile?.league_combat} />
            <HeroItemBuildPanel slots={profile?.items?.slots} />
            <HeroAbilityBuildPanel abilityBuilds={profile?.ability_builds} heroName={heroName} />
            <HeroMatchupsPanel
              matchups={profile?.matchups}
              overallWinRate={profile?.win_rate ?? 0}
            />
            <HeroSoulsCurvePanel souls={profile?.souls} heroName={heroName} />
          </div>

          <div className="flex min-w-0 flex-[5_1_360px] flex-col gap-4">
            <HeroLanePanel lane={profile?.lane} laneNames={LANE_META} />
            <HeroSideSplitPanel sides={profile?.sides} />
            <HeroGameLengthPanel lengths={profile?.lengths} />
            <HeroBestDuoPanel heroName={heroName} duos={duos} />
            <HeroTopPlayersPanel players={profile?.top_players} />
            {placeholder("Death Profile", "When and where this hero dies")}
            <HeroRecordsPanel records={profile?.records} />
          </div>
        </div>
      )}

      {!sparse && (
        <HeroHeadToHeadPanel
          heroId={profile?.hero_id ?? Number(heroId)}
          heroName={heroName}
          perHero={perHero}
        />
      )}
    </div>
  );
}

export default HeroDetail;
