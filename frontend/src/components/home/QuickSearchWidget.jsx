import React, { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Widget from "./Widget";

const TYPE_LABELS = {
  user: "Player",
  team: "Team",
  hero: "Hero",
  match: "Match",
};

/**
 * QuickSearchWidget — sidebar typeahead over players, teams, heroes and match
 * IDs. Suggestions come from /db/search/suggest; submitting the form hands the
 * term to the full /search page.
 */
export default function QuickSearchWidget() {
  const navigate = useNavigate();
  const boxRef = useRef(null);

  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);
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

  /* Debounced typeahead. */
  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(() => {
      fetch(`/db/search/suggest?q=${encodeURIComponent(term)}`)
        .then((res) => (res.ok ? res.json() : { results: [] }))
        .then((data) => {
          if (!cancelled) setResults(data.results || []);
        })
        .catch(() => {
          if (!cancelled) setResults([]);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  /* Dismiss the suggestion list on outside click. */
  useEffect(() => {
    const onPointerDown = (event) => {
      if (boxRef.current && !boxRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, []);

  const handleSubmit = (event) => {
    event.preventDefault();
    const term = query.trim();
    if (!term) return;
    setOpen(false);
    navigate(`/search?q=${encodeURIComponent(term)}`);
  };

  const handleSelect = (result) => {
    setOpen(false);
    setQuery("");
    navigate(result.url);
  };

  const showList = open && query.trim().length > 0;

  return (
    <Widget title="Quick Search">
      <div ref={boxRef} className="relative">
        <form onSubmit={handleSubmit}>
          <div className="flex items-center gap-2 rounded-md border border-border bg-input px-3 py-2 focus-within:border-accent-secondary-border-strong transition-colors">
            <svg
              aria-hidden="true"
              viewBox="0 0 20 20"
              fill="none"
              className="h-4 w-4 shrink-0 text-dim"
            >
              <circle
                cx="9"
                cy="9"
                r="5.5"
                stroke="currentColor"
                strokeWidth="1.6"
              />
              <path
                d="M13.5 13.5 17 17"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              onKeyDown={(event) => {
                if (event.key === "Escape") setOpen(false);
              }}
              placeholder="Player, team or hero"
              aria-label="Search players, teams and heroes"
              className="w-full bg-transparent text-sm text-primary placeholder:text-dim outline-none"
            />
          </div>
        </form>

        {showList && (
          <ul className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border border-border-light bg-panel shadow-heavy">
            {results.map((result) => (
              <li key={`${result.type}-${result.url}`}>
                <button
                  type="button"
                  onClick={() => handleSelect(result)}
                  className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm text-primary hover:bg-white/[0.06] transition-colors"
                >
                  <span className="truncate">{result.text}</span>
                  <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[.08em] text-dim">
                    {TYPE_LABELS[result.type] || result.type}
                  </span>
                </button>
              </li>
            ))}

            {!results.length && (
              <li className="px-3 py-2 text-xs text-dim">
                {searching ? "Searching…" : "No matches"}
              </li>
            )}
          </ul>
        )}
      </div>

      {chips.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {chips.map((team) => (
            <Link
              key={team.team_name}
              to={`/team/${encodeURIComponent(team.team_name)}`}
              className="rounded-full border border-border bg-white/[0.03] px-2.5 py-1 text-[11px] text-muted hover:border-accent-secondary-border hover:text-accent-secondary-light transition-colors"
            >
              {team.team_name}
            </Link>
          ))}
        </div>
      )}
    </Widget>
  );
}
