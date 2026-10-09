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

function formatCommit(c) {
  if (!c?.sha) return 'Unknown';
  return `${c.sha.slice(0, 7)}${c.subject ? ` - ${c.subject}` : ''}`;
}

function Stat({ label, value }) {
  return (
    <div className="rounded-xl border border-gray-700/60 bg-gray-800/30 p-5">
      <div className="text-xs uppercase tracking-wide text-gray-400">{label}</div>
      <div className="mt-1 text-xl font-semibold text-white break-words">{value}</div>
    </div>
  );
}

export default function SystemAdmin() {
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [restarting, setRestarting] = useState(false);
  const [offsetS, setOffsetS] = useState(0);

  const load = useCallback(async () => {
    const res = await fetch('/admin/api/system', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.ok) throw new Error(data?.error || `Request failed (${res.status})`);
    setInfo(data);
    setOffsetS(0);
    setError('');
  }, []);

  useEffect(() => {
    load().catch((err) => setError(err.message));
  }, [load]);

  // Tick uptime locally, refresh from the server periodically.
  useEffect(() => {
    if (restarting) return undefined;
    const tick = setInterval(() => setOffsetS((v) => v + 1), 1000);
    const refresh = setInterval(() => load().catch(() => {}), 30000);
    return () => {
      clearInterval(tick);
      clearInterval(refresh);
    };
  }, [load, restarting]);

  // After a restart, poll until the server answers again.
  useEffect(() => {
    if (!restarting) return undefined;
    const poll = setInterval(async () => {
      try {
        await load();
        setRestarting(false);
      } catch {
        /* still down */
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

  if (!info) return <div className="w-full p-8 text-gray-300">Loading...</div>;

  return (
    <div className="w-full p-8 max-w-4xl space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">System Status</h1>
          <p className="text-gray-300 mt-2">Server health and controls.</p>
        </div>
        <a
          href="/react-admin"
          className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-400/70"
        >
          Back to Admin
        </a>
      </div>

      {error && (
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>
      )}

      {restarting && (
        <div className="rounded border border-yellow-500/40 bg-yellow-900/20 px-4 py-3 text-yellow-200">
          Restarting... waiting for the server to come back.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Stat label="Uptime" value={formatDuration(info.uptime_s + offsetS)} />
        <Stat label="Last restart" value={new Date(info.started_at * 1000).toLocaleString()} />
        <Stat label="Process ID" value={info.pid} />
        <Stat label="Python" value={info.python} />
        <Stat label="Database size" value={formatBytes(info.db_size_bytes)} />
        <Stat label="Active threads" value={info.threads} />
        <Stat label="Platform" value={info.platform} />
        <Stat label="Restart mode" value={info.restart_mode} />
        <Stat label="Running commit" value={formatCommit(info.git?.local)} />
        <Stat
          label={`Latest GitHub commit (${info.git?.branch || 'main'})${info.git?.up_to_date === false ? ' - update available' : ''}`}
          value={formatCommit(info.git?.remote)}
        />
      </div>

      <button
        type="button"
        onClick={restart}
        disabled={restarting}
        className="rounded bg-red-600 px-5 py-2.5 font-semibold text-white hover:bg-red-500 disabled:opacity-50"
      >
        {restarting ? 'Restarting...' : 'Restart website'}
      </button>
    </div>
  );
}
