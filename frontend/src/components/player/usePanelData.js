import { useEffect, useState } from "react";

/**
 * Fetch one profile panel's data.
 *
 * Every panel owns its own request so that a failure degrades to that panel
 * alone — the tab's other panels still render, which is what the design calls
 * for. Returns `{ data, loading, error, reload }`; `reload` backs a Retry button.
 */
export default function usePanelData(url, { errorMessage = "Could not load this panel" } = {}) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);

    fetch(url)
      .then((response) => {
        if (!response.ok) throw new Error(errorMessage);
        return response.json();
      })
      .then((json) => {
        if (alive) setData(json);
      })
      .catch((err) => {
        if (alive) setError(err?.message || errorMessage);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [url, reloadKey, errorMessage]);

  return { data, loading, error, reload: () => setReloadKey((key) => key + 1) };
}
