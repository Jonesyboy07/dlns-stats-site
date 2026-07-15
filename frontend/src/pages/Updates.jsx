import React, { useEffect, useState } from "react";

export default function Updates() {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    fetch("/api/updates")
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load updates");
        }
        return res.json();
      })
      .then((data) => {
        if (!cancelled) {
          setHtml(String(data.content_html || ""));
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "Failed to load updates");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold">Updates</h1>
          <p className="text-slate-300 mt-2">Latest project changes and announcements.</p>
        </header>

        {loading ? <p className="text-slate-300">Loading updates...</p> : null}
        {error ? <p className="text-red-300">{error}</p> : null}

        {!loading && !error ? (
          <article
            className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 prose prose-invert prose-headings:text-white prose-a:text-indigo-300 max-w-none"
            dangerouslySetInnerHTML={{ __html: html || "<p>No updates yet.</p>" }}
          />
        ) : null}
      </div>
    </div>
  );
}
