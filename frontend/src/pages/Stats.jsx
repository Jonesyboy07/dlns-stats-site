import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { cdnImage } from "../utils/cdn";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ErrorMessage from "../components/ErrorMessage";
import { Bar, Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
} from "chart.js";

ChartJS.register(
  BarElement,
  LineElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Filler,
);

function Stats() {
  const [selectedSeries, setSelectedSeries] = useState("Night Shift");
  const [seriesOptions, setSeriesOptions] = useState([]);
  const [overview, setOverview] = useState(null);
  const [weeklyData, setWeeklyData] = useState([]);
  const [heroSelection, setHeroSelection] = useState([]);
  const [records, setRecords] = useState(null);
  const [averages, setAverages] = useState(null);
  const [heroes, setHeroes] = useState({});
  const [loadingSeriesOptions, setLoadingSeriesOptions] = useState(true);
  const [loadingStats, setLoadingStats] = useState(true);
  const [error, setError] = useState(null);
  const [expandedRecords, setExpandedRecords] = useState(new Set());
  const [expandedAverages, setExpandedAverages] = useState(new Set());
  const loading = loadingSeriesOptions || loadingStats;
  const toggleRecord = (key) =>
    setExpandedRecords((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  const toggleAverage = (key) =>
    setExpandedAverages((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });

  useEffect(() => {
    fetchSeriesOptions();
  }, []);

  useEffect(() => {
    fetchData(selectedSeries);
  }, [selectedSeries]);

  const fetchSeriesOptions = async () => {
    try {
      setLoadingSeriesOptions(true);
      const res = await fetch("/db/weeks");
      if (!res.ok) return;
      const data = await res.json();
      const titles = Array.isArray(data.series_titles)
        ? data.series_titles
        : [];
      setSeriesOptions(titles);
      if (titles.length > 0 && selectedSeries && !titles.includes(selectedSeries)) {
        setSelectedSeries(titles[0]);
      } else if (titles.length === 0 && selectedSeries !== "") {
        setSelectedSeries("");
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingSeriesOptions(false);
    }
  };

  const fetchData = async (seriesTitle) => {
    try {
      setLoadingStats(true);
      const eventTitle = seriesTitle || "";
      const query = eventTitle ? `?event_title=${encodeURIComponent(eventTitle)}` : "";
      const requests = [
        fetch(`/db/stats/overview${query}`),
        fetch(`/db/stats/records${query}`),
        fetch(`/db/stats/averages${query}`),
        fetch(`/db/stats/hero-selection${query}`),
        fetch("/db/heroes"),
        fetch(`/db/stats/weekly${query}`),
      ];

      const responses = await Promise.all(requests);
      const [overviewRes, recordsRes, averagesRes, heroSelectionRes, heroesRes, weeklyRes] = responses;

      if (overviewRes.ok) setOverview((await overviewRes.json()).overview);
      if (recordsRes.ok) setRecords((await recordsRes.json()).records);
      if (averagesRes.ok) setAverages((await averagesRes.json()).averages);
      if (heroSelectionRes.ok) setHeroSelection((await heroSelectionRes.json()).heroes ?? []);
      if (heroesRes.ok) setHeroes(await heroesRes.json());
      if (weeklyRes?.ok) {
        setWeeklyData((await weeklyRes.json()).weeks ?? []);
      } else if (!eventTitle) {
        setWeeklyData([]);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingStats(false);
    }
  };

  if (loading) {
    return <LoadingSkeleton variant="text" />;
  }

  if (error) {
    return <ErrorMessage message={error} onRetry={() => { fetchSeriesOptions(); fetchData(selectedSeries); }} />;
  }

  const selectedSeriesLabel = selectedSeries || "Combined";

  const totalMatches = overview?.total_matches ?? 0;
  const amberWins = overview?.amber_wins ?? 0;
  const sapphireWins = overview?.sapphire_wins ?? 0;
  const avgDuration = overview?.avg_duration ?? 0;

  const formatDuration = (seconds) => {
    if (!seconds) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, "0")}`;
  };

  return (
    <div className="w-full p-8">
      <h1 className="text-3xl text-white font-bold mb-6">Statistics</h1>

      <div className="mb-8 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[0.25em] text-gray-500 mb-1">
            Series filter
          </p>
          <label className="inline-flex items-center gap-3 bg-panel border border-slate-700 rounded-lg px-4 py-3 text-sm text-gray-300">
            <span className="text-gray-400 font-semibold">Series</span>
            <select
              value={selectedSeries}
              onChange={(e) => setSelectedSeries(e.target.value)}
              className="bg-transparent text-white outline-none min-w-48"
            >
              <option value="">Combined</option>
              {seriesOptions.map((series) => (
                <option key={series} value={series}>
                  {series}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="text-sm text-gray-500">
          Showing {selectedSeriesLabel} stats.
        </p>
      </div>

      <div className="">
        <h1 className="text-xl text-white font-bold mb-4 uppercase">
          Match Trend
        </h1>

        {/* Hidden King vs Archmother */}
        <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
          <div className="flex flex-col md:flex-row items-center gap-8">
            {/* Labels */}
            <div className="flex md:flex-col items-center gap-3 md:w-36 shrink-0">
              <div className="flex flex-col items-center gap-1">
                <img
                  src={cdnImage("teamNames/team1_patron_logo_psd.png")}
                  alt="Hidden King"
                  className="h-10"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(64%) sepia(14%) saturate(3308%) hue-rotate(1deg) brightness(106%) contrast(103%)",
                  }}
                />
                <span className="text-2xl font-bold text-amber-400">
                  {amberWins}
                </span>
                <span className="text-xs text-gray-500">
                  {totalMatches > 0
                    ? ((amberWins / totalMatches) * 100).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
            </div>

            {/* Bar */}
            <div className="flex-1 min-w-0 relative h-12">
              <Bar
                data={{
                  labels: [""],
                  datasets: [
                    {
                      label: "Hidden King",
                      data: [amberWins],
                      backgroundColor: "#f39c12",
                      borderRadius: {
                        topLeft: 4,
                        bottomLeft: 4,
                        topRight: 0,
                        bottomRight: 0,
                      },
                      borderSkipped: false,
                      barPercentage: 1.0,
                      categoryPercentage: 1.0,
                    },
                    {
                      label: "Archmother",
                      data: [sapphireWins],
                      backgroundColor: "#3498db",
                      borderRadius: {
                        topLeft: 0,
                        bottomLeft: 0,
                        topRight: 4,
                        bottomRight: 4,
                      },
                      borderSkipped: false,
                      barPercentage: 1.0,
                      categoryPercentage: 1.0,
                    },
                  ],
                }}
                options={{
                  indexAxis: "y",
                  responsive: true,
                  maintainAspectRatio: false,
                  layout: { padding: 0 },
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => {
                          const wins = ctx.raw;
                          const pct =
                            totalMatches > 0
                              ? ((wins / totalMatches) * 100).toFixed(1)
                              : 0;
                          return ` ${wins} wins (${pct}%)`;
                        },
                      },
                    },
                  },
                  scales: {
                    x: {
                      stacked: true,
                      display: false,
                      min: 0,
                      max: totalMatches,
                    },
                    y: { stacked: true, display: false },
                  },
                }}
              />
            </div>

            {/* Labels */}
            <div className="flex md:flex-col items-center gap-3 md:w-36 shrink-0">
              <div className="flex flex-col items-center gap-1">
                <img
                  src={cdnImage("teamNames/team2_patron_logo_psd.png")}
                  alt="Archmother"
                  className="h-10"
                  style={{
                    filter:
                      "brightness(0) saturate(100%) invert(24%) sepia(96%) saturate(1698%) hue-rotate(203deg) brightness(94%) contrast(97%)",
                  }}
                />
                <span className="text-2xl font-bold text-blue-400">
                  {sapphireWins}
                </span>
                <span className="text-xs text-gray-500">
                  {totalMatches > 0
                    ? ((sapphireWins / totalMatches) * 100).toFixed(1)
                    : 0}
                  %
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Duration Trend */}
        {selectedSeries && weeklyData.length > 0 && (
          <div className="bg-panel text-gray-300 shadow rounded-lg p-6 my-8">
            <h2 className="text-xl font-bold mb-4">
              Avg Match Duration per Week
            </h2>
            <div className="relative h-56">
              <Line
                data={{
                  labels: weeklyData.map((w) => `${selectedSeriesLabel} #${w.event_week}`),
                  datasets: [
                    {
                      label: "Avg Duration (min)",
                      data: weeklyData.map((w) => w.avg_duration_min),
                      borderColor: "#60a5fa",
                      backgroundColor: "rgba(96,165,250,0.15)",
                      pointBackgroundColor: "#60a5fa",
                      fill: true,
                      tension: 0.3,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  plugins: {
                    legend: { display: false },
                    tooltip: {
                      callbacks: {
                        label: (ctx) => ` ${ctx.raw} min`,
                      },
                    },
                  },
                  scales: {
                    x: {
                      ticks: { color: "#9ca3af" },
                      grid: { color: "rgba(255,255,255,0.05)" },
                    },
                    y: {
                      ticks: { color: "#9ca3af", callback: (v) => `${v}m` },
                      grid: { color: "rgba(255,255,255,0.05)" },
                    },
                  },
                }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-8">
        <h1 className="text-xl text-white font-bold mb-4 uppercase flex items-center gap-2">
          <span className="text-red-400" aria-hidden="true">🦸</span>
          Hero Selection
        </h1>
        <div className="bg-panel text-gray-300 shadow rounded-lg p-6">
          <div className="mb-4 text-sm text-gray-500">
            Most popular heroes across {selectedSeriesLabel} matches.
          </div>
          {heroSelection.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full border-separate border-spacing-y-2">
                <thead>
                  <tr className="text-xs uppercase tracking-widest text-gray-500">
                    <th className="text-left font-semibold pb-2">Hero</th>
                    <th className="text-left font-semibold pb-2 hidden sm:table-cell">Picks</th>
                    <th className="text-left font-semibold pb-2 hidden sm:table-cell">Win Rate</th>
                    <th className="text-left font-semibold pb-2">Popularity</th>
                  </tr>
                </thead>
                <tbody>
                  {heroSelection.map((hero) => {
                    const heroName = heroes[hero.hero_id]?.name || heroes[hero.hero_id] || `Hero ${hero.hero_id}`;
                    const popularity = Number(hero.pick_percentage || 0) * 100;
                    const winRate = Number(hero.win_rate || 0) * 100;
                    return (
                      <tr key={hero.hero_id} className="align-middle">
                        <td className="py-2 pr-4">
                          <div className="font-semibold text-white">{heroName}</div>
                          <div className="text-xs text-gray-500 sm:hidden mt-1">
                            {hero.pick_count} picks • {winRate.toFixed(1)}% wins
                          </div>
                        </td>
                        <td className="py-2 pr-4 hidden sm:table-cell">
                          <span className="inline-flex min-w-14 justify-center rounded-full border border-slate-600 bg-slate-800 px-3 py-1 text-xs font-semibold text-gray-200">
                            {hero.pick_count}
                          </span>
                        </td>
                        <td className="py-2 pr-4 hidden sm:table-cell">
                          <span className={`inline-flex min-w-14 justify-center rounded-full px-3 py-1 text-xs font-semibold ${winRate >= 50 ? "bg-emerald-500/15 text-emerald-300 border border-emerald-500/30" : "bg-red-500/15 text-red-300 border border-red-500/30"}`}>
                            {winRate.toFixed(1)}%
                          </span>
                        </td>
                        <td className="py-2">
                          <div className="flex items-center gap-3">
                            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-700/70">
                              <div
                                className="h-full rounded-full bg-blue-400"
                                style={{ width: `${Math.max(4, popularity)}%` }}
                              />
                            </div>
                            <span className="w-14 text-right text-xs text-gray-400">
                              {popularity.toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-sm text-gray-500">No hero selection data available for this series.</div>
          )}
        </div>
      </div>

      <div className="">
        <h1 className="text-xl text-white font-bold mb-8 mt-16 uppercase">Player Records</h1>
        <h2 className="text-xl text-white font-bold my-4">Highest</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Most Kills',      key: 'kills',   fmt: (v) => v },
            { label: 'Most Assists',    key: 'assists', fmt: (v) => v },
            { label: 'Most Deaths',     key: 'deaths',  fmt: (v) => v },
            { label: 'Most Obj Damage', key: 'obj_damage', fmt: (v) => v?.toLocaleString() },
            { label: 'Most Healing',    key: 'healing', fmt: (v) => v?.toLocaleString() },
            { label: 'Highest Souls',   key: 'souls',   fmt: (v) => v?.toLocaleString() },
          ].map(({ label, key, fmt }) => {
            const list = records?.[key] ?? [];
            const r = list[0] ?? null;
            const heroName = r?.hero_id ? (heroes[r.hero_id]?.name || heroes[r.hero_id] || `Hero ${r.hero_id}`) : null;
            const durationMin = r?.duration_s ? `${Math.floor(r.duration_s / 60)}:${String(r.duration_s % 60).padStart(2, '0')}` : null;
            const verticalImg = heroName
              ? cdnImage(`vertical/${heroName.toLowerCase().replace(/\s+/g, '_')}_vertical_psd.png`)
              : null;
            const isExpanded = expandedRecords.has(key);
            return (
              <div key={label} className="relative">
                <div className="bg-panel text-gray-300 shadow rounded-lg overflow-hidden flex flex-col h-full">
                <div className="flex flex-1">
                  {verticalImg && (
                    <img
                      src={verticalImg}
                      alt={heroName}
                      className="h-full w-24 object-cover object-top shrink-0"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="p-4 flex flex-col justify-between min-w-0 flex-1">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</p>
                      <p className="text-3xl font-bold text-white">{fmt(r?.value) ?? '—'}</p>
                        {r?.account_id
                          ? <Link to={`/player/${r.account_id}`} className="text-sm text-blue-400 hover:underline mt-2 truncate font-medium block">{r?.persona_name ?? 'Unknown'}</Link>
                          : <p className="text-sm text-gray-200 mt-2 truncate font-medium">{r?.persona_name ?? 'Unknown'}</p>
                        }
                      {heroName && <p className="text-xs text-gray-400 mt-0.5">{heroName}</p>}
                    </div>
                    <div className="flex flex-wrap gap-x-3 mt-3">
                      {r?.match_id && (
                        <a href={`/match/${r.match_id}`} className="text-xs text-blue-400 hover:underline">
                          #{r.match_id}
                        </a>
                      )}
                      {durationMin && <span className="text-xs text-gray-500">{durationMin}</span>}
                      {r?.event_week != null && (
                        <span className="text-xs text-gray-500">
                          {r?.event_title || selectedSeriesLabel} #{r.event_week}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                {list.length > 1 && (
                  <div className="border-t border-slate-700">
                    <button
                      onClick={() => toggleRecord(key)}
                      className="w-full text-xs text-blue-400 hover:text-blue-300 py-1.5 px-4 text-left hover:bg-slate-800 transition-colors"
                    >
                      {isExpanded ? 'Hide top 5 ▲' : 'See top 5 ▼'}
                    </button>
                  </div>
                )}
                </div>
                {isExpanded && (
                  <ol className="absolute top-full left-0 right-0 z-20 bg-slate-800 border border-slate-600 rounded-b-lg px-4 py-3 space-y-2 shadow-xl">
                    {list.map((entry, i) => {
                      const eName = entry.hero_id ? (heroes[entry.hero_id]?.name || heroes[entry.hero_id] || `Hero ${entry.hero_id}`) : null;
                      return (
                        <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                          <span className="text-gray-500 w-4 text-right">{i + 1}.</span>
                          <span className="font-bold text-white">{fmt(entry.value)}</span>
                          {entry.account_id
                            ? <Link to={`/player/${entry.account_id}`} className="truncate flex-1 text-blue-400 hover:underline">{entry.persona_name ?? 'Unknown'}</Link>
                            : <span className="truncate flex-1">{entry.persona_name ?? 'Unknown'}</span>
                          }
                          {eName && <span className="text-gray-500 shrink-0">{eName}</span>}
                          {entry.match_id && (
                            <a href={`/match/${entry.match_id}`} className="text-blue-400 hover:underline shrink-0">
                              #{entry.match_id}
                            </a>
                          )}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Player Averages */}
      <div className="mt-8">
        <h1 className="text-xl text-white font-bold my-4">Averages</h1>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {[
            { label: 'Avg Kills',      key: 'kills',      fmt: (v) => v?.toFixed(1) },
            { label: 'Avg Assists',    key: 'assists',    fmt: (v) => v?.toFixed(1) },
            { label: 'Avg Deaths',     key: 'deaths',     fmt: (v) => v?.toFixed(1) },
            { label: 'Avg Obj Damage', key: 'obj_damage', fmt: (v) => Number(v)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
            { label: 'Avg Healing',    key: 'healing',    fmt: (v) => Number(v)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
            { label: 'Avg Souls',      key: 'souls',      fmt: (v) => Number(v)?.toLocaleString(undefined, { maximumFractionDigits: 0 }) },
          ].map(({ label, key, fmt }) => {
            const list = averages?.[key] ?? [];
            const r = list[0] ?? null;
            const heroName = r?.top_hero_id ? (heroes[r.top_hero_id]?.name || heroes[r.top_hero_id] || null) : null;
            const verticalImg = heroName
              ? cdnImage(`vertical/${heroName.toLowerCase().replace(/\s+/g, '_')}_vertical_psd.png`)
              : null;
            const isExpanded = expandedAverages.has(key);
            return (
              <div key={label} className="relative">
                <div className="bg-panel text-gray-300 shadow rounded-lg overflow-hidden flex flex-col h-full">
                  <div className="flex flex-1">
                    {verticalImg && (
                      <img
                        src={verticalImg}
                        alt={heroName}
                        className="h-full w-24 object-cover object-top shrink-0"
                        onError={(e) => { e.target.style.display = 'none'; }}
                      />
                    )}
                    <div className="p-4 flex flex-col justify-between min-w-0 flex-1">
                      <div>
                        <p className="text-xs text-gray-500 uppercase tracking-widest mb-1">{label}</p>
                        <p className="text-3xl font-bold text-white">{fmt(r?.value) ?? '—'}</p>
                        {r?.account_id
                          ? <Link to={`/player/${r.account_id}`} className="text-sm text-blue-400 hover:underline mt-2 truncate font-medium block">{r?.persona_name ?? 'Unknown'}</Link>
                          : <p className="text-sm text-gray-200 mt-2 truncate font-medium">{r?.persona_name ?? 'Unknown'}</p>
                        }
                        {r?.games_played != null && (
                          <p className="text-xs text-gray-500 mt-0.5">{r.games_played} games</p>
                        )}
                      </div>
                    </div>
                  </div>
                  {list.length > 1 && (
                    <div className="border-t border-slate-700">
                      <button
                        onClick={() => toggleAverage(key)}
                        className="w-full text-xs text-blue-400 hover:text-blue-300 py-1.5 px-4 text-left hover:bg-slate-800 transition-colors"
                      >
                        {isExpanded ? 'Hide top 5 ▲' : 'See top 5 ▼'}
                      </button>
                    </div>
                  )}
                </div>
                {isExpanded && (
                  <ol className="absolute top-full left-0 right-0 z-20 bg-slate-800 border border-slate-600 rounded-b-lg px-4 py-3 space-y-2 shadow-xl">
                    {list.map((entry, i) => (
                      <li key={i} className="flex items-center gap-2 text-xs text-gray-300">
                        <span className="text-gray-500 w-4 text-right">{i + 1}.</span>
                        <span className="font-bold text-white">{fmt(entry.value)}</span>
                        {entry.account_id
                          ? <Link to={`/player/${entry.account_id}`} className="truncate flex-1 text-blue-400 hover:underline">{entry.persona_name ?? 'Unknown'}</Link>
                          : <span className="truncate flex-1">{entry.persona_name ?? 'Unknown'}</span>
                        }
                        <span className="text-gray-500 shrink-0">{entry.games_played}g</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default Stats;
