import React, { useEffect, useMemo, useState } from "react";

const RANGES = [
  { id: "24h", label: "24 hours" },
  { id: "7", label: "7 days" },
  { id: "30", label: "30 days" },
  { id: "90", label: "90 days" },
  { id: "365", label: "1 year" },
];

const nf = new Intl.NumberFormat();

function Change({ now, before }) {
  if (!before) return <span className="text-slate-500">No earlier data to compare</span>;
  const pct = Math.round(((now - before) / before) * 100);
  const cls = pct > 0 ? "text-emerald-300" : pct < 0 ? "text-red-300" : "text-slate-400";
  const arrow = pct > 0 ? "▲" : pct < 0 ? "▼" : "•";
  return (
    <span className={cls}>
      {arrow} {Math.abs(pct)}% vs previous period
    </span>
  );
}

function Card({ title, value, hint, children }) {
  return (
    <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
      <div className="text-xs uppercase tracking-wider text-slate-400">{title}</div>
      <div className="mt-1 text-3xl font-bold text-white">{value}</div>
      <div className="mt-1 text-sm">{children}</div>
      {hint ? <div className="mt-2 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function BarList({ title, subtitle, items, total, empty }) {
  const max = Math.max(1, ...items.map((i) => i.views));
  return (
    <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {subtitle ? <p className="text-xs text-slate-500 mb-3">{subtitle}</p> : <div className="mb-3" />}
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li key={item.label} className="text-sm">
              <div className="flex justify-between gap-3">
                <span className="truncate text-slate-200" title={item.label}>
                  {item.label === "/" ? "/ (home)" : item.label}
                </span>
                <span className="shrink-0 text-slate-400">
                  {nf.format(item.views)}
                  {total ? <span className="text-slate-500"> · {Math.round((item.views / total) * 100)}%</span> : null}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-slate-800">
                <div className="h-1.5 rounded bg-purple-500" style={{ width: `${(item.views / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function BarChart({ title, subtitle, series, metric, unit, color, hoverColor }) {
  const [hover, setHover] = useState(null);
  const max = Math.max(1, ...series.map((d) => d[metric]));
  const shown = hover != null ? series[hover] : null;
  return (
    <section className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold text-white">{title}</h2>
        <span className="text-sm text-slate-300 min-h-5">
          {shown ? `${shown.label}: ${nf.format(shown[metric])} ${unit}` : "Hover a bar for details"}
        </span>
      </div>
      {subtitle ? <p className="text-xs text-slate-500">{subtitle}</p> : null}
      <div className="mt-4 flex h-40 items-end gap-px" onMouseLeave={() => setHover(null)}>
        {series.map((d, i) => (
          <div
            key={d.key}
            className="flex-1 h-full flex items-end"
            onMouseEnter={() => setHover(i)}
            title={`${d.label}: ${d[metric]} ${unit}`}
          >
            <div
              className={`w-full rounded-t ${hover === i ? hoverColor : color}`}
              style={{ height: `${d[metric] ? Math.max(3, (d[metric] / max) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-slate-500">
        <span>{series[0]?.label}</span>
        <span>{series[series.length - 1]?.label}</span>
      </div>
    </section>
  );
}
export default function AnalyticsAdmin() {
  const [range, setRange] = useState("30");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch(`/admin/api/analytics?range=${range}`, {
      credentials: "include",
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const body = await res.json().catch(() => ({}));
        if (!res.ok || !body?.ok) {
          const err = new Error(body?.error || `Request failed (${res.status})`);
          err.status = res.status;
          throw err;
        }
        if (!cancelled) {
          setData(body);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range]);

  const devicesTotal = useMemo(() => (data ? data.devices.reduce((s, d) => s + d.views, 0) : 0), [data]);
  const referrerItems = useMemo(() => {
    if (!data) return [];
    const items = [...data.referrers];
    if (data.direct_views) items.unshift({ label: "Direct / unknown", views: data.direct_views });
    return items.sort((a, b) => b.views - a.views);
  }, [data]);

  if (error && !data) {
    const denied = error.status === 401 || error.status === 403;
    return (
      <div className="w-full p-8 max-w-3xl">
        <h1 className="text-3xl font-bold text-white mb-3">Analytics</h1>
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">
          {denied ? "You need to be logged in as an admin to view this page." : error.message}
        </div>
        {error.status === 401 ? (
          <a
            href="/auth/login"
            className="mt-4 inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-500"
          >
            Login with Discord
          </a>
        ) : null}
      </div>
    );
  }

  const hourly = data?.granularity === "hour";
  const periodLabel = hourly ? "last 24 hours" : `last ${data?.buckets} days`;
  const unitLabel = hourly ? "hour" : "day";
  const avg = data ? Math.round(data.current.views / data.buckets) : 0;
  const empty = data && data.current.views === 0;

  return (
    <div className="w-full p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="text-slate-300 mt-2">How people are using the site. Private: admins only.</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-700 overflow-hidden" role="group" aria-label="Time range">
            {RANGES.map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => setRange(r.id)}
                className={`px-3 py-2 text-sm font-medium ${
                  range === r.id ? "bg-purple-600 text-white" : "bg-slate-900/40 text-slate-300 hover:bg-slate-800"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <a
            href="/react-admin"
            className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-400/70"
          >
            Back to Admin
          </a>
        </div>
      </div>

      {!data ? (
        <p className="text-slate-300">Loading...</p>
      ) : (
        <div className={loading ? "opacity-60 transition-opacity space-y-6" : "space-y-6"}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card
              title={`Page views (${periodLabel})`}
              value={nf.format(data.current.views)}
              hint="Every time a page was opened."
            >
              <Change now={data.current.views} before={data.previous.views} />
            </Card>
            <Card
              title="Visitors"
              value={nf.format(data.current.visitors)}
              hint={
                hourly
                  ? "Unique visitors in each hour, added up. Someone active in 3 different hours counts 3 times."
                  : "Unique visitors per day, added up. Someone visiting on 3 different days counts 3 times, because we can't recognise people across days (that's the privacy design)."
              }
            >
              <Change now={data.current.visitors} before={data.previous.visitors} />
            </Card>
            <Card title={`Average per ${unitLabel}`} value={nf.format(avg)} hint={`Page views per ${unitLabel} over this period.`} />
          </div>

          {empty ? (
            <div className="rounded-xl border border-slate-700/50 bg-slate-900/40 p-6 text-slate-300">
              No visits recorded in this period yet. Visits from people who opt out, bots, and admin pages are never
              counted.
            </div>
          ) : null}

          <BarChart
            title={`Unique visitors per ${unitLabel}`}
            subtitle={
              hourly
                ? "Different people active in each hour (UTC)."
                : "Different people who visited on each day. The same person on two days is counted on both."
            }
            series={data.series}
            metric="visitors"
            unit="visitors"
            color="bg-emerald-500"
            hoverColor="bg-emerald-300"
          />
          <BarChart
            title={`Page views per ${unitLabel}`}
            subtitle="Total pages opened, including repeat views by the same person."
            series={data.series}
            metric="views"
            unit="views"
            color="bg-purple-500"
            hoverColor="bg-purple-300"
          />

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <BarList
              title="Most viewed pages"
              subtitle="Top 15 pages by views."
              items={data.pages}
              total={data.current.views}
              empty="No page views yet."
            />
            <div className="space-y-4">
              <BarList
                title="Where visitors come from"
                subtitle="The site they were on before. “Direct / unknown” means typed in, bookmarked, or hidden by the other site."
                items={referrerItems}
                total={data.current.views}
                empty="No traffic yet."
              />
              <BarList
                title="Devices"
                subtitle="Desktop, mobile or tablet."
                items={data.devices}
                total={devicesTotal}
                empty="No traffic yet."
              />
            </div>
          </div>

          <p className="text-xs text-slate-500">
            Privacy: no cookies, IPs or user agents are stored. Daily totals are kept for {data.retention_days} days and
            hourly totals for 3 days. Times are in UTC. See the <a className="text-indigo-300 hover:underline" href="/privacy">privacy page</a>.
          </p>
        </div>
      )}
    </div>
  );
}
