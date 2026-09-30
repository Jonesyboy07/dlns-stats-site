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
import { formatInteger } from "../utils/format";
import { formatPercent, ordinal, signedPoints } from "../utils/heroPages";

const DASH = "—";
/** Analysis panels only appear once a hero has this many games. */
const MIN_GAMES = 10;

/** The panels that render as "Adding Soon" (or "Not enough games") for now. */
const PLACEHOLDER_PANELS = [
  ["Meta Trend", "Win % and pick % by week"],
  ["Recent Games", "Last 8 games in scope"],
  ["Ability Build", "Ability point order, one column per unlock or upgrade"],
  ["Souls Curve", "Average net worth over game time vs the league-average hero"],
  ["Lane Profile", "Assigned lane vs where the hero actually played"],
  ["Side Split", "Win rate by team side"],
  ["Game-Length Profile", "Win rate by game length"],
  ["Death Profile", "When and where this hero dies"],
];

/**
 * Hero detail (layout 2a): a scope chip, the identity card, five headline tiles,
 * and the analysis panels. Panels whose data the API cannot supply yet render an
 * "Adding Soon" placeholder; the whole panel column collapses to placeholders when
 * the hero has fewer than ten games.
 */
function HeroDetail() {
  const { heroId } = useParams();
  const [meta, setMeta] = useState(null);
  const [stats, setStats] = useState(null);
  const [items, setItems] = useState([]);
  const [matchups, setMatchups] = useState(null);
  const [players, setPlayers] = useState([]);
  const [selection, setSelection] = useState([]);
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const [metaRes, statsRes, itemsRes, matchupsRes, playersRes, selectionRes, overviewRes] =
          await Promise.all([
            fetch(`/db/heroes/${heroId}/meta`),
            fetch(`/db/heroes/${heroId}/stats`),
            fetch(`/db/heroes/${heroId}/top_items`),
            fetch(`/db/heroes/${heroId}/matchups`),
            fetch(`/db/heroes/${heroId}/top_players`),
            fetch("/db/stats/hero-selection"),
            fetch("/db/stats/overview"),
          ]);
        if (!alive) return;
        setMeta(metaRes.ok ? await metaRes.json() : null);
        setStats(statsRes.ok ? (await statsRes.json()).stats ?? null : null);
        setItems(itemsRes.ok ? (await itemsRes.json()).items ?? [] : []);
        setMatchups(matchupsRes.ok ? await matchupsRes.json() : null);
        setPlayers(playersRes.ok ? (await playersRes.json()).players ?? [] : []);
        setSelection(selectionRes.ok ? (await selectionRes.json()).heroes ?? [] : []);
        setOverview(overviewRes.ok ? (await overviewRes.json()).overview ?? null : null);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
    };
  }, [heroId, reloadKey]);

  const names = heroNamesData.heroes ?? {};
  const heroName = names[heroId]?.name ?? `Hero ${heroId}`;

  // `hero_names.json` stores each hero as { name, released }; child components
  // that only need a label get a plain id -> name map, not the raw entry.
  const heroNameById = useMemo(
    () => Object.fromEntries(Object.entries(names).map(([id, data]) => [id, data.name])),
    [names],
  );

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

  const totalGames = overview?.total_matches ?? null;
  const selectionById = useMemo(
    () => new Map((selection ?? []).map((row) => [String(row.hero_id), row])),
    [selection],
  );

  const pickRateOf = (id) => {
    const games = selectionById.get(String(id))?.pick_count;
    return games != null && totalGames ? games / totalGames : null;
  };

  const pool = useMemo(
    () => (selection ?? []).filter((row) => (row.pick_count ?? 0) > 0),
    [selection],
  );

  const rankBy = (key) => {
    const sorted = pool.slice().sort((a, b) => (b[key] ?? 0) - (a[key] ?? 0));
    const at = sorted.findIndex((row) => String(row.hero_id) === String(heroId));
    return at === -1 ? null : at + 1;
  };

  const rankTxt = (key, label) => {
    const rank = rankBy(key);
    return rank == null ? "Adding Soon" : `${ordinal(rank)} of ${pool.length} by ${label}`;
  };

  const avgWin = pool.length
    ? pool.reduce((sum, row) => sum + (row.win_rate ?? 0), 0) / pool.length
    : null;
  const avgPick = pool.length
    ? pool.reduce((sum, row) => sum + (row.pick_count ?? 0) / (totalGames || 1), 0) / pool.length
    : null;

  const games = stats?.games_played ?? 0;
  const wins = stats?.wins ?? 0;
  const losses = Math.max(0, games - wins);
  const sparse = games < MIN_GAMES;
  const selfPickRate = pickRateOf(heroId);

  const abilities = useMemo(
    () =>
      (meta?.abilities ?? []).map((ability) => ({
        name: ability.name,
        image: ability.image,
        invert: ability.invert,
      })),
    [meta],
  );

  const tiles = [
    {
      label: "Win rate",
      value: formatPercent(stats?.win_rate),
      delta:
        stats?.win_rate == null
          ? null
          : {
              text: signedPoints((stats.win_rate - 0.5) * 100),
              tone: stats.win_rate >= 0.5 ? "good" : "bad",
              title: "League-average hero: 50.0%",
            },
      sub: "vs league-average hero (50.0%)",
      rank: sparse ? "Unranked · needs 10+ games" : rankTxt("win_rate", "win rate"),
      rankDim: sparse,
    },
    {
      label: "Pick rate",
      value: formatPercent(selfPickRate),
      delta:
        selfPickRate == null || avgPick == null
          ? null
          : {
              text: signedPoints((selfPickRate - avgPick) * 100),
              tone: selfPickRate >= avgPick ? "good" : "bad",
              title: `Average hero pick rate ${formatPercent(avgPick)}`,
            },
      sub: `vs average hero (${formatPercent(avgPick)})`,
      rank: sparse ? "Unranked · needs 10+ games" : rankTxt("pick_count", "pick rate"),
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
      value: String(games || DASH),
      sub:
        totalGames != null
          ? `of ${totalGames.toLocaleString()} league games in scope`
          : "Adding Soon",
      rank: sparse ? "Unranked · needs 10+ games" : rankTxt("pick_count", "games"),
      rankDim: sparse,
    },
    {
      label: "Wins",
      value: String(wins || DASH),
      wl: { wins, losses },
      sub: "Win–loss record in scope",
      rank: "Adding Soon",
      rankDim: true,
    },
  ];

  const rates = [
    {
      label: "Damage / min",
      value: formatInteger(stats?.damage_per_min) ?? DASH,
      caption: "League avg · Adding Soon",
    },
    {
      label: "Souls / min",
      value: formatInteger(stats?.souls_per_min) ?? DASH,
      caption: "League avg · Adding Soon",
    },
    {
      label: "Deaths / min",
      value: stats?.deaths_per_min == null ? DASH : Number(stats.deaths_per_min).toFixed(2),
      caption: "League avg · Adding Soon",
    },
  ];

  const combatCells = [
    { label: "Kills / min", value: stats?.kills_per_min?.toFixed(2) ?? DASH },
    { label: "Deaths / min", value: stats?.deaths_per_min?.toFixed(2) ?? DASH },
    { label: "Assists / min", value: stats?.assists_per_min?.toFixed(2) ?? DASH },
    { label: "Last hits", soon: true },
    { label: "Denies", soon: true },
    { label: "Hit %", soon: true },
    { label: "Objective dmg", value: formatInteger(stats?.avg_obj_damage) ?? DASH },
    { label: "Healing", value: formatInteger(stats?.avg_healing) ?? DASH },
    { label: "Pings / game", soon: true },
    { label: "Avg level", soon: true },
  ].map((cell) => (cell.soon ? cell : { ...cell, avg: "Adding Soon", delta: "", tone: null }));

  const records = [
    { label: "Highest damage", value: formatInteger(stats?.max_damage) ?? DASH },
    { label: "Most kills", value: stats?.max_kills != null ? String(stats.max_kills) : DASH },
    { label: "Most healing", value: formatInteger(stats?.max_healing) ?? DASH },
    { label: "Highest obj damage", value: formatInteger(stats?.max_obj_damage) ?? DASH },
  ];

  const duos = (matchups?.effective_with ?? [])
    .slice()
    .sort((a, b) => (b.win_rate ?? 0) - (a.win_rate ?? 0))
    .slice(0, 3)
    .map((row) => ({
      heroId: String(row.hero_id),
      name: names[String(row.hero_id)]?.name ?? `Hero ${row.hero_id}`,
      games: row.games ?? 0,
      winRate: row.win_rate ?? 0,
      delta: (row.win_rate ?? 0) - (stats?.win_rate ?? 0),
    }));

  if (loading) return <LoadingSkeleton variant="detail" />;
  if (error) return <ErrorMessage message={error} onRetry={() => setReloadKey((key) => key + 1)} />;

  const placeholderNote = sparse ? "Not enough games" : "Adding Soon";
  const placeholder = (title, subtitle) => (
    <PlaceholderPanel key={title} title={title} subtitle={subtitle} note={placeholderNote} />
  );

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-6">
      {/* Top bar: breadcrumb, prev/next, scope */}
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
          <div className="flex items-center gap-2">
            <span className="text-[12px] uppercase tracking-[.05em] text-dim">Scope</span>
            <span
              title="Adding Soon"
              className="rounded-lg border border-border-light bg-input px-3 py-2 text-[13px] text-secondary"
            >
              All time
            </span>
            <span className="text-[12px] font-semibold text-dim">Adding Soon</span>
          </div>
        </div>
      </div>

      <HeroIdentityCard name={heroName} tagline={meta?.tagline ?? []} abilities={abilities} />

      {sparse && (
        <div className="rounded-xl border border-warning-border bg-warning-bg px-5 py-4">
          <p className="m-0 font-semibold text-warning">Not enough games</p>
          <p className="m-0 mt-0.5 text-[13px] text-secondary">
            {heroName} has {games} game{games === 1 ? "" : "s"} in All time. Profile panels unlock
            at 10 games — try a wider scope such as All time.
          </p>
        </div>
      )}

      <HeroHeadlineTiles tiles={tiles} rates={rates} />

      {sparse ? (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))" }}
        >
          {PLACEHOLDER_PANELS.map(([title, subtitle]) => placeholder(title, subtitle))}
        </div>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          <div className="flex min-w-0 flex-[7_1_560px] flex-col gap-4">
            {placeholder("Meta Trend", "Win % and pick % by week")}
            {placeholder("Recent Games", "Last 8 games in scope")}
            <HeroCombatPanel cells={combatCells} />
            <HeroItemBuildPanel items={items} />
            {placeholder("Ability Build", "Ability point order, one column per unlock or upgrade")}
            <HeroMatchupsPanel
              matchups={matchups}
              overallWinRate={stats?.win_rate ?? 0}
              heroNames={heroNameById}
            />
            {placeholder("Souls Curve", "Average net worth over game time vs the league-average hero")}
          </div>

          <div className="flex min-w-0 flex-[5_1_360px] flex-col gap-4">
            {placeholder("Lane Profile", "Assigned lane vs where the hero actually played")}
            {placeholder("Side Split", "Win rate by team side")}
            {placeholder("Game-Length Profile", "Win rate by game length")}
            <HeroBestDuoPanel heroName={heroName} duos={duos} />
            <HeroTopPlayersPanel players={players} />
            {placeholder("Death Profile", "When and where this hero dies")}
            <HeroRecordsPanel records={records} />
          </div>
        </div>
      )}

      {!sparse && (
        <HeroHeadToHeadPanel
          selfId={heroId}
          selfStats={stats}
          heroOptions={released}
          selectionById={selectionById}
          totalGames={totalGames}
        />
      )}
    </div>
  );
}

export default HeroDetail;
