import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import ErrorMessage from "../components/ErrorMessage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import ScoreChip from "../components/player/ScoreChip";
import TeamLogo from "../components/TeamLogo";

const DASH = "—";

function TeamsList() {
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const navigate = useNavigate();

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
    return <ErrorMessage message={error} />;

  const query = search.toLowerCase();
  // The endpoint already orders by games played (its default sort), and filtering
  // preserves that order — nothing is re-sorted here on purpose.
  const filtered = teams.filter((t) => t.team_name.toLowerCase().includes(query));

  return (
    <div className="w-full px-4 py-6">
      <header className="mb-4">
        <h1 className="font-valve-oracle text-[24px] leading-tight text-primary">Teams</h1>
        <p className="mt-0.5 text-[13px] text-muted">
          {teams.length} team{teams.length === 1 ? "" : "s"} recorded
        </p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Search teams…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full rounded-lg border border-border-light bg-input px-3.5 py-2 text-[13px] text-secondary outline-none placeholder:text-dim focus:border-accent-secondary-border md:w-80"
        />
        <span className="ml-auto text-[12px] tabular-nums text-dim">
          Showing {filtered.length} of {teams.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border-lighter px-4 py-10 text-center text-[13px] text-muted">
          {search.trim() ? `No teams match “${search.trim()}”.` : "No teams recorded yet."}
        </div>
      ) : (
        <div className="scroll-thin overflow-x-auto rounded-xl border border-border-light bg-card shadow">
          <table className="w-full min-w-[560px]">
            <thead>
              <tr className="border-b border-border-light bg-table text-[11px] uppercase tracking-[.05em] text-muted">
                <th className="px-4 py-2.5 text-left font-normal">Team</th>
                <th className="px-4 py-2.5 text-right font-normal">Matches</th>
                <th className="px-4 py-2.5 text-right font-normal">W–L</th>
                <th className="px-4 py-2.5 text-right font-normal">Latest NS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.map((team) => {
                const href = `/team/${encodeURIComponent(team.team_name)}`;
                return (
                  <tr
                    key={team.team_name}
                    role="button"
                    tabIndex={0}
                    aria-label={`Open ${team.team_name}`}
                    onClick={() => navigate(href)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        navigate(href);
                      }
                    }}
                    className="cursor-pointer transition-colors hover:bg-accent-secondary/[0.08]"
                  >
                    <td className="px-4 py-2.5">
                      {/* The link carries the row's own target, so it only has to
                          stop the click from navigating twice. */}
                      <Link
                        to={href}
                        onClick={(event) => event.stopPropagation()}
                        className="group flex items-center gap-3"
                      >
                        <TeamLogo name={team.team_name} size="h-8 w-8" rounded="rounded-lg" />
                        <span className="truncate text-[13px] font-semibold text-accent-secondary-light group-hover:underline">
                          {team.team_name}
                        </span>
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums text-secondary">
                      {team.matches}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {team.wins == null || team.losses == null ? (
                        <span className="text-dim">{DASH}</span>
                      ) : (
                        <ScoreChip wins={team.wins} losses={team.losses} className="text-[13px]" />
                      )}
                    </td>
                    <td className="px-4 py-2.5 text-right text-[13px] tabular-nums">
                      {team.latest_week == null ? (
                        <span className="text-dim" title="No Night Shift week recorded">
                          {DASH}
                        </span>
                      ) : (
                        <Link
                          to={`/week/${team.latest_week}`}
                          title={`Night Shift ${team.latest_week}`}
                          onClick={(event) => event.stopPropagation()}
                          className="text-dim transition-colors hover:text-secondary"
                        >
                          NS {team.latest_week}
                        </Link>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default TeamsList;
