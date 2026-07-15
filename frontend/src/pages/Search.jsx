import React, { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

function normalizeResultUrl(url) {
  const raw = String(url || "");
  if (raw.startsWith("/matches/")) {
    return raw.replace("/matches/", "/match/");
  }
  if (raw.startsWith("/users/")) {
    return raw.replace("/users/", "/player/");
  }
  return raw;
}

export default function Search() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const initialQ = searchParams.get("q") || "";
  const [inputValue, setInputValue] = useState(initialQ);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const q = useMemo(() => (searchParams.get("q") || "").trim(), [searchParams]);

  useEffect(() => {
    setInputValue(initialQ);
  }, [initialQ]);

  useEffect(() => {
    if (!q) {
      setResults([]);
      setError("");
      return;
    }

    if (/^\d+$/.test(q)) {
      navigate(`/match/${q}`);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError("");

    fetch(`/db/search/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) {
          throw new Error("Search request failed");
        }
        return res.json();
      })
      .then((data) => {
        const list = Array.isArray(data.results) ? data.results : [];
        setResults(list);
      })
      .catch((err) => {
        if (err?.name !== "AbortError") {
          setError(err?.message || "Search failed");
        }
      })
      .finally(() => {
        setLoading(false);
      });

    return () => controller.abort();
  }, [q, navigate]);

  const onSubmit = (event) => {
    event.preventDefault();
    const nextQ = String(inputValue || "").trim();
    if (!nextQ) {
      setSearchParams({});
      return;
    }
    setSearchParams({ q: nextQ });
  };

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold">Search</h1>
          <p className="text-slate-300 mt-2">Find players by name, or jump straight to a match by ID.</p>
        </header>

        <form onSubmit={onSubmit} className="flex gap-2">
          <input
            type="search"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Match ID or player name"
            className="w-full rounded-md border border-slate-600 bg-slate-900/50 px-3 py-2 text-white"
          />
          <button
            type="submit"
            className="rounded-md bg-indigo-600 px-4 py-2 font-medium text-white hover:bg-indigo-500"
          >
            Search
          </button>
        </form>

        {!q ? (
          <div className="rounded-lg border border-slate-700/50 bg-slate-900/40 p-4 text-slate-300 text-sm">
            Tip: numeric input opens a match directly. Name input shows player suggestions.
          </div>
        ) : null}

        {loading ? <p className="text-slate-300">Searching...</p> : null}
        {error ? <p className="text-red-300">{error}</p> : null}

        {!loading && q && results.length === 0 && !error ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-amber-100 text-sm">
            No results for "{q}".
          </div>
        ) : null}

        {results.length > 0 ? (
          <div className="space-y-2">
            {results.map((item, idx) => {
              const href = normalizeResultUrl(item.url);
              const isMatch = item.type === "match";
              return (
                <Link
                  key={`${item.type || "item"}-${idx}-${item.text || ""}`}
                  to={href}
                  className="block rounded-lg border border-slate-700/50 bg-slate-900/40 p-4 hover:border-indigo-500/60"
                >
                  <div className="text-xs uppercase tracking-wider text-slate-400">
                    {isMatch ? "Match" : "Player"}
                  </div>
                  <div className="mt-1 text-white font-medium">{item.text}</div>
                </Link>
              );
            })}
          </div>
        ) : null}
      </div>
    </div>
  );
}
