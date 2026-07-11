import React, { useEffect, useState } from 'react';

const adminCards = [
  {
    title: 'Flask Admin Panel',
    description: 'Open the classic admin dashboard for server-level controls and stats.',
    href: '/admin/',
  },
  {
    title: 'Bulk Match Submit',
    description: 'Ingest a full week with multiple sets and matches in one job.',
    href: '/admin/matches',
  },
  {
    title: 'Help Config Editor',
    description: 'Edit the modular help page content and the shared help banner.',
    href: '/react-admin/help-config',
  },
];

export default function ReactAdmin() {
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState({ logged_in: false, is_admin: false, user: null });
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;

    const loadAccess = async () => {
      try {
        setLoading(true);
        setError('');

        const res = await fetch('/admin/api/access', { credentials: 'include' });
        const data = await res.json();
        if (!res.ok || !data?.ok) throw new Error(data?.error || 'Failed to load access info');

        if (!cancelled) {
          setAccess({
            logged_in: Boolean(data.logged_in),
            is_admin: Boolean(data.is_admin),
            user: data.user || null,
          });
        }
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Failed to load access info');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadAccess();
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <div className="w-full p-8 text-gray-300">Loading admin tools...</div>;
  }

  if (error) {
    return (
      <div className="w-full p-8">
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>
      </div>
    );
  }

  if (!access.logged_in) {
    return (
      <div className="w-full p-8 max-w-3xl">
        <h1 className="text-3xl font-bold text-white mb-3">React Admin Hub</h1>
        <p className="text-gray-300 mb-6">Sign in first to access admin tools.</p>
        <a
          href="/auth/login"
          className="inline-flex items-center rounded bg-blue-600 px-4 py-2 text-white font-semibold hover:bg-blue-500"
        >
          Login with Discord
        </a>
      </div>
    );
  }

  if (!access.is_admin) {
    return (
      <div className="w-full p-8 max-w-3xl">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h1 className="text-3xl font-bold text-white">React Admin Hub</h1>
          <a
            href="/auth/logout"
            className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-red-400/70 hover:text-red-200"
          >
            Logout
          </a>
        </div>
        <p className="text-gray-300">
          You are logged in as <span className="text-white font-semibold">{access.user?.username || 'Unknown user'}</span>,
          but this account does not have admin privileges.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full p-8 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">React Admin Hub</h1>
          <p className="text-gray-300 mt-2">Quick access to admin tools used across React-backed pages.</p>
        </div>
        <a
          href="/auth/logout"
          className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-red-400/70 hover:text-red-200"
        >
          Logout
        </a>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {adminCards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            className="block rounded-xl border border-gray-700/60 bg-gray-800/30 p-5 hover:border-blue-500/50 hover:bg-gray-800/50 transition"
          >
            <h2 className="text-lg font-semibold text-white mb-2">{card.title}</h2>
            <p className="text-sm text-gray-300">{card.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
