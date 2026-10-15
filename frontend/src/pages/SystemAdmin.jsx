import React, { useCallback, useEffect, useState } from 'react';

function formatDuration(totalSeconds) {
  let s = Math.max(0, Math.floor(totalSeconds));
  const d = Math.floor(s / 86400);
  s -= d * 86400;
  const h = Math.floor(s / 3600);
  s -= h * 3600;
  const m = Math.floor(s / 60);
  s -= m * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (d || h) parts.push(`${h}h`);
  if (d || h || m) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatBytes(bytes) {
  if (bytes == null) return 'N/A';
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function formatDate(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'N/A' : date.toLocaleString();
}

function formatCommit(c) {
  if (!c?.sha) return 'Unknown';
  const text = `${c.sha.slice(0, 7)}${c.subject ? ` - ${c.subject}` : ''}`;
  if (!c.url) return text;
  return (
    <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-blue-400 hover:underline">
      {text}
    </a>
  );
}

function Stat({ label, value, description }) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-5">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 break-words text-xl font-semibold text-white">{value}</div>
      {description && <p className="mt-2 text-xs leading-relaxed text-gray-400">{description}</p>}
    </div>
  );
}

const adminLinks = [
  { label: 'Admin hub', href: '/react-admin' },
  { label: 'Flask admin', href: '/admin/' },
  { label: 'Bulk match submit', href: '/admin/matches' },
  { label: 'Brackets', href: '/admin/brackets/' },
  { label: 'Submitted brackets', href: '/admin/brackets/view' },
  { label: 'Help config', href: '/react-admin/help-config' },
  { label: 'Analytics', href: '/admin/analytics' },
];

export default function SystemAdmin() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [offsetS, setOffsetS] = useState(0);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const res = await fetch('/admin/api/system', {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setInfo(data);
      setOffsetS(0);
      setLastUpdated(Date.now());
      setError('');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  useEffect(() => {
    if (restarting) return undefined;
    const tick = setInterval(() => setOffsetS((v) => v + 1), 1000);
    const refresh = setInterval(() => load().catch((err) => setError(err.message)), 30000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [load, restarting]);

  useEffect(() => {
    if (!restarting) return undefined;
    const poll = setInterval(async () => {
      try {
        await load();
        setRestarting(false);
      } catch {
        // The service is still restarting.
      }
    }, 2000);
    return () => clearInterval(poll);
  }, [restarting, load]);

  const restart = async () => {
    if (!window.confirm('Restart the website now? It will be unavailable for a few seconds.')) return;
    try {
      const res = await fetch('/admin/api/system/restart', {
        method: 'POST',
        credentials: 'include',
        headers: { Accept: 'application/json' },
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setRestarting(true);
    } catch (err) {
      setError(err.message);
    }
  };

  if (error && !info) {
    return (
      <div className="w-full p-8">
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>
      </div>
    );
  }

  if (!info) return <div className="w-full p-8 text-gray-300">Loading system information...</div>;

  const commits = info.git?.history || [];

  return (
    <div className="w-full max-w-6xl space-y-6 p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">System Status</h1>
          <p className="mt-2 text-gray-300">
            Live process health, deployment version, recent repository activity, and tracked file sizes.
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {lastUpdated ? `Last updated ${formatDate(lastUpdated)}` : 'Waiting for system information'}
            {' · '}refreshes every 30 seconds
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => load().catch((err) => setError(err.message))}
            disabled={refreshing || restarting}
            className="rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-400/70 disabled:opacity-50"
          >
            {refreshing ? 'Refreshing...' : 'Refresh now'}
          </button>
          <a
            href="/react-admin"
            className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-400/70"
          >
            Back to Admin
          </a>
        </div>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>
      )}

      {restarting && (
        <div className="rounded border border-yellow-500/40 bg-yellow-900/20 px-4 py-3 text-yellow-200">
          Restart requested. This page will reconnect automatically when the server is back.
        </div>
      )}

      <section className="space-y-3" aria-labelledby="health-heading">
        <div>
          <h2 id="health-heading" className="text-xl font-semibold text-white">Process health</h2>
          <p className="mt-1 text-sm text-gray-400">Values describe the current web-server process; uptime advances locally between refreshes.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Stat label="Uptime" value={formatDuration(info.uptime_s + offsetS)} description="Time since this process started." />
          <Stat label="Last restart" value={formatDate(info.started_at * 1000)} description="Time when the process started, shown in your browser's local time." />
          <Stat label="Process ID" value={info.pid} description="Operating-system process identifier." />
          <Stat label="Python" value={info.python} description="Runtime version used by the server." />
          <Stat label="Active threads" value={info.threads} description="Threads currently active in this process." />
          <Stat label="Platform" value={info.platform} description="Operating system and runtime platform." />
          <Stat label="Database size" value={formatBytes(info.db_size_bytes)} description="Current size of the configured SQLite database file." />
          <Stat label="Restart mode" value={info.restart_mode} description="Configured service or process restart mechanism." />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="deployment-heading">
        <div>
          <h2 id="deployment-heading" className="text-xl font-semibold text-white">Deployment and repository</h2>
          <p className="mt-1 text-sm text-gray-400">
            Running commit is checked out locally. Latest GitHub commit is the head of the configured deployment branch.
            {info.git?.repository_url && (
              <> Repository: <a className="text-blue-400 hover:underline" href={info.git.repository_url} target="_blank" rel="noopener noreferrer">{info.git.repository_url}</a>.</>
            )}
          </p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Stat
            label="Running commit"
            value={formatCommit(info.git?.local)}
            description={`${info.git?.local?.author || 'Author unavailable'} · ${formatDate(info.git?.local?.date)}`}
          />
          <Stat
            label={`Latest GitHub commit (${info.git?.branch || 'main'})${info.git?.up_to_date === false ? ' — update available' : ''}`}
            value={formatCommit(info.git?.remote)}
            description={`${info.git?.remote?.author || 'Author unavailable'} · ${formatDate(info.git?.remote?.date)}`}
          />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="files-heading">
        <div>
          <h2 id="files-heading" className="text-xl font-semibold text-white">Important file sizes</h2>
          <p className="mt-1 text-sm text-gray-400">Tracked source and project files, plus the active database above. Missing files are shown as N/A.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-700/60">
          {(info.file_sizes || []).map((file) => (
            <div key={file.path} className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-700/60 px-4 py-3 last:border-b-0">
              <code className="text-sm text-gray-200">{file.path}</code>
              <span className="text-sm font-semibold text-white">{formatBytes(file.size_bytes)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="history-heading">
        <div>
          <h2 id="history-heading" className="text-xl font-semibold text-white">Recent commit history</h2>
          <p className="mt-1 text-sm text-gray-400">Most recent commits available in this checkout, including the commit author and timestamp.</p>
        </div>
        <div className="overflow-hidden rounded-xl border border-gray-700/60">
          {commits.length ? commits.map((commit) => (
            <div key={commit.sha} className="border-b border-gray-700/60 px-4 py-3 last:border-b-0">
              <div className="break-words text-sm font-medium text-white">{formatCommit(commit)}</div>
              <div className="mt-1 text-xs text-gray-400">{commit.author || 'Author unavailable'} · {formatDate(commit.date)}</div>
            </div>
          )) : <p className="px-4 py-3 text-sm text-gray-400">Commit history is unavailable.</p>}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="admin-links-heading">
        <div>
          <h2 id="admin-links-heading" className="text-xl font-semibold text-white">Admin tools</h2>
          <p className="mt-1 text-sm text-gray-400">Quick links to the other admin pages. Access depends on your account permissions.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {adminLinks.map((link) => (
            <a key={link.href} href={link.href} className="rounded border border-gray-700 px-3 py-2 text-sm text-gray-200 hover:border-blue-400/70 hover:text-white">
              {link.label}
            </a>
          ))}
        </div>
      </section>

      <div className="border-t border-gray-700/60 pt-5">
        <p className="mb-3 text-sm text-gray-400">Restarting interrupts active requests. Use this only when you intend to restart the web service.</p>
        <button
          type="button"
          onClick={restart}
          disabled={restarting}
          className="rounded bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
        >
          {restarting ? 'Restarting...' : 'Restart website'}
        </button>
      </div>
    </div>
  );
}
