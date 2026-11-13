import { useEffect, useState } from 'react';

export const SUGGEST_DEBOUNCE_MS = 200;

/**
 * Debounced typeahead over /db/search/suggest (players, teams, heroes and
 * match IDs), used by the header search.
 *
 * Keeps the previous results while a new request is in flight, so lists
 * don't flicker between keystrokes. `error` is true when the last request
 * failed (non-2xx or network error); results are then empty.
 */
export default function useSearchSuggest(query) {
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setResults([]);
      setSearching(false);
      setError(false);
      return undefined;
    }

    let cancelled = false;
    setSearching(true);

    const timer = setTimeout(() => {
      fetch(`/db/search/suggest?q=${encodeURIComponent(term)}`)
        .then((res) => {
          if (!res.ok) throw new Error(`suggest ${res.status}`);
          return res.json();
        })
        .then((data) => {
          if (cancelled) return;
          setResults(data.results || []);
          setError(false);
        })
        .catch(() => {
          if (cancelled) return;
          setResults([]);
          setError(true);
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  return { results, searching, error };
}
