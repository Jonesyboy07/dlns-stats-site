import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import Widget from "./Widget";

/**
 * QuickSearchWidget — home rail shortcuts to the three teams with the most
 * matches played. The search field that used to live here was removed in
 * favour of the header search, which covers players, teams, heroes and
 * match IDs.
 */
export default function QuickSearchWidget() {
  const [chips, setChips] = useState([]);

  /* Suggested teams — the three with the most matches played. */
  useEffect(() => {
    let cancelled = false;

    fetch("/db/teams")
      .then((res) => (res.ok ? res.json() : { teams: [] }))
      .then((data) => {
        if (cancelled) return;
        const top = [...(data.teams || [])]
          .sort((a, b) => (b.matches || 0) - (a.matches || 0))
          .slice(0, 3);
        setChips(top);
      })
      .catch(() => {
        if (!cancelled) setChips([]);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  /* Nothing to show without teams; skip the empty heading. */
  if (chips.length === 0) return null;

  return (
    <Widget title="Quick Search">
      <div className="flex flex-wrap gap-1.5">
        {chips.map((team) => (
          <Link
            key={team.team_name}
            to={`/team/${encodeURIComponent(team.team_name)}`}
            className="rounded-full bg-accent-bg px-2.5 py-1 text-[11px] font-semibold text-accent-light transition-colors hover:bg-accent-bg-strong"
          >
            {team.team_name}
          </Link>
        ))}
      </div>
    </Widget>
  );
}
