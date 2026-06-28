import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import LoadingSkeleton from "../components/LoadingSkeleton";

function TeamsList() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    fetch("/db/teams")
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load teams");
        return r.json();
      })
      .then((d) => setTeams(d.teams || []))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  if (loading)
    return <LoadingSkeleton variant="card" />;
  if (error)
    return <div className="p-8 text-red-400">Error: {error}</div>;

  const filtered = teams.filter((t) =>
    t.team_name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="w-full px-4 py-8">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-white mb-1">Teams</h1>
        <p className="text-gray-400 text-sm">{teams.length} teams</p>
      </div>

      <input
        type="text"
        placeholder="Search teams…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-8 w-full md:w-80 px-4 py-2 rounded-lg border border-gray-600 bg-gray-800 text-gray-200 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500"
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map((team) => (
          <Link
            key={team.team_name}
            to={`/team/${encodeURIComponent(team.team_name)}`}
            className="block p-5 rounded-xl border border-gray-700 bg-gray-800/50 hover:bg-gray-700/50 hover:border-purple-500/50 transition-all group"
          >
            <h2 className="text-lg font-semibold text-white group-hover:text-purple-300 transition-colors">
              {team.team_name}
            </h2>
            <p className="text-sm text-gray-400 mt-1">
              {team.matches} match{team.matches !== 1 ? "es" : ""}
            </p>
          </Link>
        ))}
      </div>

      {filtered.length === 0 && (
        <p className="text-gray-500 text-center py-12">No teams found.</p>
      )}
    </div>
  );
}

export default TeamsList;
