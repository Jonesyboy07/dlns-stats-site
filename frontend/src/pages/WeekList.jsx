import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";

function WeekList() {
  const [weeks, setWeeks] = useState([]);
  const [title, setTitle] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetch("/db/weeks")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load weeks");
        return r.json();
      })
      .then((data) => {
        const details = data.details || {};
        setTitle(data.title || "Night Shift");

        // Build a map of week -> { series, matchCount, seriesSet }
        const weekMap = {};
        for (const entry of Object.values(details)) {
          const w = entry.week;
          if (w == null) continue;
          if (!weekMap[w]) {
            weekMap[w] = { week: w, series: entry.series || "", matchCount: 0 };
          }
          weekMap[w].matchCount += 1;
        }

        const sorted = Object.values(weekMap).sort((a, b) => b.week - a.week);
        setWeeks(sorted);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return <div className="p-8 text-center text-gray-300">Loading…</div>;
  if (error)
    return <div className="p-8 text-red-400">Error: {error}</div>;

  return (
    <div className="w-full px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">{title}</h1>
        <p className="text-gray-400 text-sm">{weeks.length} week{weeks.length !== 1 ? "s" : ""}</p>
      </div>

      <div className="flex flex-col gap-2 max-w-lg">
        {weeks.map(({ week, series, matchCount }) => (
          <Link
            key={week}
            to={`/week/${week}`}
            className="flex items-center justify-between px-5 py-4 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-700/50 hover:border-purple-500/50 transition-all group"
          >
            <div>
              <span className="text-white font-semibold group-hover:text-purple-300 transition-colors">
                Week {week}
              </span>
              {series && (
                <span className="ml-2 text-gray-500 text-sm">{series}</span>
              )}
            </div>
            <span className="text-gray-400 text-sm">
              {matchCount} match{matchCount !== 1 ? "es" : ""}
            </span>
          </Link>
        ))}

        {weeks.length === 0 && (
          <p className="text-gray-500 text-center py-12">No weeks found.</p>
        )}
      </div>
    </div>
  );
}

export default WeekList;
