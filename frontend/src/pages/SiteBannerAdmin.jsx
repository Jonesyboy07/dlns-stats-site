import React, { useEffect, useState } from 'react';

const emptyConfig = {
  title: 'Help & Contribute',
  intro: 'Want to help improve DLNS Stats? Pick a task that fits your time and skill level.',
  banner: {
    enabled: true,
    badge: 'Help wanted',
    title: 'Want to help the project?',
    message: 'We are looking for people who can help improve DLNS Stats with data cleanup, UI polish, and documentation.',
    details: [
      'Match data cleanup and validation',
      'UI, accessibility, and layout polish',
      'Documentation, bug fixes, and feature ideas',
    ],
    cta: {
      label: 'Read the help page',
      url: '/help',
    },
  },
  sections: [],
  support: {
    title: 'Other Ways to Help',
    body: 'Not a developer? You can still help by supporting the project, sharing it, or sending feedback.',
    links: [],
  },
};

function configToForm(config) {
  const source = config && typeof config === 'object' ? config : emptyConfig;
  return {
    pageTitle: source.title || emptyConfig.title,
    intro: source.intro || emptyConfig.intro,
    enabled: Boolean(source.banner?.enabled),
    badge: source.banner?.badge || emptyConfig.banner.badge,
    title: source.banner?.title || emptyConfig.banner.title,
    message: source.banner?.message || emptyConfig.banner.message,
    detailsText: Array.isArray(source.banner?.details) ? source.banner.details.join('\n') : emptyConfig.banner.details.join('\n'),
    ctaLabel: source.banner?.cta?.label || emptyConfig.banner.cta.label,
    ctaUrl: source.banner?.cta?.url || emptyConfig.banner.cta.url,
    sectionsJson: JSON.stringify(source.sections || emptyConfig.sections, null, 2),
    supportTitle: source.support?.title || emptyConfig.support.title,
    supportBody: source.support?.body || emptyConfig.support.body,
    supportLinksJson: JSON.stringify(source.support?.links || emptyConfig.support.links, null, 2),
  };
}

function formToConfig(form) {
  let sections = [];
  let supportLinks = [];
  try {
    sections = JSON.parse(form.sectionsJson || '[]');
  } catch {
    sections = [];
  }
  try {
    supportLinks = JSON.parse(form.supportLinksJson || '[]');
  } catch {
    supportLinks = [];
  }

  return {
    title: form.pageTitle.trim(),
    intro: form.intro.trim(),
    banner: {
      enabled: Boolean(form.enabled),
      badge: form.badge.trim(),
      title: form.title.trim(),
      message: form.message.trim(),
      details: form.detailsText
        .split('\n')
        .map((entry) => entry.trim())
        .filter(Boolean),
      cta: {
        label: form.ctaLabel.trim(),
        url: form.ctaUrl.trim() || '/help',
      },
    },
    sections,
    support: {
      title: form.supportTitle.trim(),
      body: form.supportBody.trim(),
      links: supportLinks,
    },
  };
}

export default function SiteBannerAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [access, setAccess] = useState({ logged_in: false, is_admin: false, user: null });
  const [form, setForm] = useState(configToForm(emptyConfig));

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError('');

        const [accessResponse, bannerResponse] = await Promise.all([
          fetch('/admin/api/access', { credentials: 'include' }),
          fetch('/db/help-config', { headers: { Accept: 'application/json' }, credentials: 'include' }),
        ]);

        const accessData = await accessResponse.json();
        if (!accessResponse.ok || !accessData?.ok) {
          throw new Error(accessData?.error || 'Failed to load access info');
        }

        const bannerData = await bannerResponse.json();
        if (!bannerResponse.ok) {
          throw new Error(bannerData?.error || 'Failed to load help config');
        }

        if (!cancelled) {
          setAccess({
            logged_in: Boolean(accessData.logged_in),
            is_admin: Boolean(accessData.is_admin),
            user: accessData.user || null,
          });
          setForm(configToForm(bannerData));
        }
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load help config editor');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const saveBanner = async (event) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    setStatus('');

    try {
      const response = await fetch('/db/help-config', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(formToConfig(form)),
      });

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save banner');
      }

      setForm(configToForm(data.help_config));
      setStatus('Help config saved.');
    } catch (err) {
      setError(err?.message || 'Failed to save help config');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="w-full p-8 text-gray-300">Loading help config editor...</div>;
  }

  if (error && !access.logged_in) {
    return (
      <div className="w-full p-8">
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>
      </div>
    );
  }

  if (!access.logged_in) {
    return (
      <div className="w-full p-8 max-w-3xl">
        <h1 className="text-3xl font-bold text-white mb-3">Help Config Editor</h1>
        <p className="text-gray-300 mb-6">Sign in first to edit the help config.</p>
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
          <h1 className="text-3xl font-bold text-white">Help Config Editor</h1>
          <a
            href="/auth/logout"
            className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-red-400/70 hover:text-red-200"
          >
            Logout
          </a>
        </div>
        <p className="text-gray-300">
          You are logged in as <span className="text-white font-semibold">{access.user?.username || 'Unknown user'}</span>, but this account does not have admin privileges.
        </p>
      </div>
    );
  }

  const preview = formToConfig(form);

  return (
    <div className="w-full p-8 space-y-6 max-w-7xl">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold text-white">Help Config Editor</h1>
          <p className="text-gray-300 mt-2">Edit the shared help config used on the home page, help page, and match-related pages.</p>
        </div>
        <a
          href="/react-admin"
          className="inline-flex items-center rounded border border-gray-600 px-3 py-2 text-sm font-semibold text-gray-200 hover:border-blue-400/70 hover:text-white"
        >
          Back to admin hub
        </a>
      </div>

      {error && <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">{error}</div>}
      {status && <div className="rounded border border-emerald-500/40 bg-emerald-900/20 px-4 py-3 text-emerald-200">{status}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-[1.2fr_0.8fr] gap-6">
        <form onSubmit={saveBanner} className="space-y-5 rounded-2xl border border-gray-700/60 bg-gray-900/40 p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Banner settings</h2>
              <p className="text-sm text-gray-400">Toggle the top banner and edit the text shown to users.</p>
            </div>
            <label className="inline-flex items-center gap-2 text-sm text-gray-200">
              <input
                type="checkbox"
                checked={form.enabled}
                onChange={(event) => updateField('enabled', event.target.checked)}
                className="h-4 w-4 rounded border-gray-500 bg-gray-900 text-blue-500"
              />
              Enabled
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <label className="space-y-2">
              <span className="block text-sm font-medium text-gray-200">Badge</span>
              <input
                value={form.badge}
                onChange={(event) => updateField('badge', event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
              />
            </label>
            <label className="space-y-2">
              <span className="block text-sm font-medium text-gray-200">CTA label</span>
              <input
                value={form.ctaLabel}
                onChange={(event) => updateField('ctaLabel', event.target.value)}
                className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
              />
            </label>
          </div>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Title</span>
            <input
              value={form.title}
              onChange={(event) => updateField('title', event.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Message</span>
            <textarea
              value={form.message}
              onChange={(event) => updateField('message', event.target.value)}
              rows={4}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Details, one per line</span>
            <textarea
              value={form.detailsText}
              onChange={(event) => updateField('detailsText', event.target.value)}
              rows={6}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">CTA URL</span>
            <input
              value={form.ctaUrl}
              onChange={(event) => updateField('ctaUrl', event.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Help page title</span>
            <input
              value={form.pageTitle}
              onChange={(event) => updateField('pageTitle', event.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Help page intro</span>
            <textarea
              value={form.intro}
              onChange={(event) => updateField('intro', event.target.value)}
              rows={3}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Help page sections JSON</span>
            <textarea
              value={form.sectionsJson}
              onChange={(event) => updateField('sectionsJson', event.target.value)}
              rows={12}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 font-mono text-xs text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Support title</span>
            <input
              value={form.supportTitle}
              onChange={(event) => updateField('supportTitle', event.target.value)}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Support body</span>
            <textarea
              value={form.supportBody}
              onChange={(event) => updateField('supportBody', event.target.value)}
              rows={3}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <label className="space-y-2 block">
            <span className="block text-sm font-medium text-gray-200">Support links JSON</span>
            <textarea
              value={form.supportLinksJson}
              onChange={(event) => updateField('supportLinksJson', event.target.value)}
              rows={6}
              className="w-full rounded border border-gray-700 bg-gray-950/60 px-3 py-2 font-mono text-xs text-gray-100 outline-none focus:border-blue-500"
            />
          </label>

          <div className="flex flex-wrap gap-3 pt-2">
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center rounded bg-blue-600 px-4 py-2 font-semibold text-white hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save banner'}
            </button>
            <button
              type="button"
              onClick={() => setForm(bannerToForm(emptyBanner))}
              className="inline-flex items-center rounded border border-gray-600 px-4 py-2 font-semibold text-gray-200 hover:border-gray-500 hover:text-white"
            >
              Reset defaults
            </button>
          </div>
        </form>

        <aside className="space-y-4">
          <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 p-5">
            <h2 className="text-xl font-semibold text-white mb-3">Preview</h2>
            {preview.banner.enabled ? (
              <div className="rounded-2xl border border-amber-500/25 bg-gradient-to-br from-amber-500/18 via-slate-900/95 to-slate-950 px-4 py-4 shadow-[0_18px_40px_rgba(0,0,0,0.28)]">
                <div className="mb-3 inline-flex items-center rounded-full border border-amber-400/30 bg-amber-400/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-200">
                  {preview.badge}
                </div>
                <h3 className="text-2xl font-bold text-white mb-2">{preview.banner.title}</h3>
                <p className="text-sm text-slate-300">{preview.banner.message}</p>
                {preview.banner.details.length > 0 && (
                  <ul className="mt-4 grid gap-2 text-sm text-slate-100">
                    {preview.banner.details.map((detail) => (
                      <li key={detail} className="rounded-xl border border-white/5 bg-white/5 px-3 py-2">{detail}</li>
                    ))}
                  </ul>
                )}
                <a
                  href={preview.banner.cta.url}
                  className="mt-4 inline-flex items-center rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950"
                >
                  {preview.banner.cta.label}
                </a>
                <div className="mt-4 text-xs text-slate-400">Sections: {Array.isArray(preview.sections) ? preview.sections.length : 0}</div>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-gray-700 px-4 py-8 text-center text-gray-400">
                Banner is disabled.
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-gray-700/60 bg-gray-900/40 p-5">
            <h2 className="text-xl font-semibold text-white mb-3">Saved JSON</h2>
            <pre className="overflow-auto rounded-xl bg-gray-950/80 p-4 text-xs text-gray-200">
              {JSON.stringify(preview, null, 2)}
            </pre>
          </div>
        </aside>
      </div>
    </div>
  );
}