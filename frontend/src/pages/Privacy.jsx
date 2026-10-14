import React, { useEffect, useState } from "react";

const OPTOUT_KEY = "dlns_analytics_optout";

function browserSignals() {
  return navigator.doNotTrack === "1" || navigator.globalPrivacyControl === true;
}

export default function Privacy() {
  const [optedOut, setOptedOut] = useState(false);
  const [signal, setSignal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSignal(browserSignals());
    let local = false;
    try {
      local = localStorage.getItem(OPTOUT_KEY) === "1";
    } catch {
      /* storage unavailable */
    }
    setOptedOut(local);
    fetch("/api/a/status", { credentials: "same-origin" })
      .then((r) => r.json())
      .then((s) => {
        if (s.optedOut) setOptedOut(true);
      })
      .catch(() => {});
  }, []);

  const toggle = async (next) => {
    setSaving(true);
    setError("");
    try {
      try {
        if (next) localStorage.setItem(OPTOUT_KEY, "1");
        else localStorage.removeItem(OPTOUT_KEY);
      } catch {
        /* the cookie below still applies */
      }
      const res = await fetch(next ? "/api/a/optout" : "/api/a/optin", {
        method: "POST",
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`Request failed (${res.status})`);
      setOptedOut(next);
    } catch (err) {
      setError(err.message || "Could not save your choice.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-panel text-white p-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <header>
          <h1 className="text-3xl font-bold">Privacy &amp; analytics</h1>
          <p className="text-slate-300 mt-2">
            This site counts page views with its own simple analytics. It uses no tracking cookies and no third parties.
          </p>
        </header>

        <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-xl font-semibold">Your choice</h2>
          {signal ? (
            <p className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-emerald-200 text-sm">
              Your browser is sending Do Not Track or Global Privacy Control, so your visits are already not counted.
            </p>
          ) : null}
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="h-5 w-5 accent-purple-500"
              checked={optedOut}
              disabled={saving}
              onChange={(e) => toggle(e.target.checked)}
            />
            <span>Don&apos;t count my visits</span>
          </label>
          <p className="text-sm text-slate-400">
            Saved with one small first-party preference cookie (<code>dlns_optout</code>, 1 year) and a matching
            browser setting. It contains no identifier and is only used to remember that you opted out.
          </p>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </section>

        <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-xl font-semibold">What we collect</h2>
          <ul className="list-disc pl-5 space-y-2 text-slate-300">
            <li>
              The page you viewed (no query string), the date, the website you came from (domain only) and a device
              type: desktop, mobile or tablet.
            </li>
            <li>
              A count of unique visitors per day. This uses a one-way hash of your IP address and browser details
              that is deleted at the end of the day. Your IP address itself is never stored.
            </li>
          </ul>
        </section>

        <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-xl font-semibold">What we don&apos;t collect</h2>
          <p className="text-slate-300">
            Tracking cookies, IP addresses, user agents, account or Steam/Discord IDs, location, or anything that
            follows you between days or sites. The data is not shared or sold.
          </p>
        </section>

        <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 space-y-3">
          <h2 className="text-xl font-semibold">Why, and for how long</h2>
          <p className="text-slate-300">
            To see which parts of the site are used (legitimate interest). Aggregate counts are deleted after 13
            months. Only site admins can view them.
          </p>
        </section>
      </div>
    </div>
  );
}
