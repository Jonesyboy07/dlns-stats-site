import React, { useEffect, useMemo, useState } from 'react';

const STORAGE_KEY = 'dlns.help-config.draft.v2';

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

const sectionTemplates = {
  bullets: {
    title: 'New Contribution Area',
    icon: '✦',
    accent: '#6366f1',
    body: 'Describe the kind of help you want here.',
    items: ['First thing people can do', 'Second thing people can do'],
    cta: {
      label: 'Open Link',
      url: '',
    },
    subsections: [],
  },
  steps: {
    title: 'Getting Started',
    icon: '🛠',
    accent: '#10b981',
    body: 'List a simple step-by-step path for contributors.',
    items: [
      'Fork the repository on GitHub',
      'Clone your fork locally',
      'Install dependencies',
      'Make your changes',
      'Test and submit a pull request',
    ],
    cta: {
      label: 'View Repository',
      url: 'https://github.com/Jonesyboy07/dlns-stats-site',
    },
    subsections: [
      {
        title: 'Tech Stack',
        bullets: [
          'Backend: Python Flask',
          'Templates: Jinja templating engine',
          'Database: SQLite',
          'Styling: PicoCSS, CSS (inline & file-based)',
          'JavaScript: File-based JavaScript',
          'Caching: Flask-Caching',
        ],
      },
    ],
  },
};

const tabs = [
  { id: 'banner', label: 'Banner', hint: 'Top hero / callout' },
  { id: 'content', label: 'Help Page', hint: 'Main help sections' },
  { id: 'support', label: 'Support', hint: 'Footer help links' },
  { id: 'advanced', label: 'Advanced', hint: 'JSON + utilities' },
];

const createId = (prefix) =>
  `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const toLines = (items) => (Array.isArray(items) ? items.join('\n') : '');

const fromLines = (value) =>
  String(value || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

const textOrEmpty = (value, fallback = '') => String(value ?? fallback);

const normalizeLink = (link = {}) => ({
  label: textOrEmpty(link.label || link.name || '', ''),
  url: textOrEmpty(link.url || '', ''),
});

const normalizeSubsection = (subsection = {}) => ({
  title: textOrEmpty(subsection.title || '', 'Tech Stack'),
  bulletsText: toLines(subsection.bullets || []),
});

const normalizeSection = (section = {}) => {
  const hasSteps = Array.isArray(section.steps) && section.steps.length > 0;
  const hasBullets = Array.isArray(section.bullets) && section.bullets.length > 0;
  const mode = hasSteps && !hasBullets ? 'steps' : 'bullets';

  return {
    id: textOrEmpty(section.id || createId('section'), createId('section')),
    title: textOrEmpty(section.title || 'Untitled Section', 'Untitled Section'),
    icon: textOrEmpty(section.icon || '✦', '✦'),
    accent: textOrEmpty(section.accent || '#6366f1', '#6366f1'),
    body: textOrEmpty(section.body || '', ''),
    mode,
    itemsText: toLines(mode === 'steps' ? section.steps : section.bullets),
    ctaLabel: textOrEmpty(section.cta?.label || '', ''),
    ctaUrl: textOrEmpty(section.cta?.url || '', ''),
    subsections: Array.isArray(section.subsections)
      ? section.subsections.map(normalizeSubsection)
      : [],
  };
};

const normalizeConfig = (config = emptyConfig) => ({
  title: textOrEmpty(config.title || emptyConfig.title, emptyConfig.title),
  intro: textOrEmpty(config.intro || emptyConfig.intro, emptyConfig.intro),
  banner: {
    enabled: Boolean(config.banner?.enabled),
    badge: textOrEmpty(config.banner?.badge || emptyConfig.banner.badge, emptyConfig.banner.badge),
    title: textOrEmpty(config.banner?.title || emptyConfig.banner.title, emptyConfig.banner.title),
    message: textOrEmpty(config.banner?.message || emptyConfig.banner.message, emptyConfig.banner.message),
    detailsText: toLines(config.banner?.details || emptyConfig.banner.details),
    ctaLabel: textOrEmpty(config.banner?.cta?.label || emptyConfig.banner.cta.label, emptyConfig.banner.cta.label),
    ctaUrl: textOrEmpty(config.banner?.cta?.url || emptyConfig.banner.cta.url, emptyConfig.banner.cta.url),
  },
  sections: Array.isArray(config.sections)
    ? config.sections.map(normalizeSection)
    : [],
  support: {
    title: textOrEmpty(config.support?.title || emptyConfig.support.title, emptyConfig.support.title),
    body: textOrEmpty(config.support?.body || emptyConfig.support.body, emptyConfig.support.body),
    links: Array.isArray(config.support?.links)
      ? config.support.links.map(normalizeLink)
      : [],
  },
});

const editorToConfig = (editor = emptyConfig) => ({
  title: textOrEmpty(editor.title || emptyConfig.title, emptyConfig.title),
  intro: textOrEmpty(editor.intro || emptyConfig.intro, emptyConfig.intro),
  banner: {
    enabled: Boolean(editor.banner?.enabled),
    badge: textOrEmpty(editor.banner?.badge || emptyConfig.banner.badge, emptyConfig.banner.badge),
    title: textOrEmpty(editor.banner?.title || emptyConfig.banner.title, emptyConfig.banner.title),
    message: textOrEmpty(editor.banner?.message || emptyConfig.banner.message, emptyConfig.banner.message),
    details: fromLines(editor.banner?.detailsText || ''),
    cta: {
      label: textOrEmpty(editor.banner?.ctaLabel || emptyConfig.banner.cta.label, emptyConfig.banner.cta.label),
      url: textOrEmpty(editor.banner?.ctaUrl || emptyConfig.banner.cta.url, emptyConfig.banner.cta.url).trim() || '/help',
    },
  },
  sections: Array.isArray(editor.sections)
    ? editor.sections.map((section) => {
        const contentLines = fromLines(section.itemsText);
        const payload = {
          id: textOrEmpty(section.id || createId('section'), createId('section')),
          title: textOrEmpty(section.title || 'Untitled Section', 'Untitled Section'),
          icon: textOrEmpty(section.icon || '✦', '✦'),
          accent: textOrEmpty(section.accent || '#6366f1', '#6366f1'),
          body: textOrEmpty(section.body || '', ''),
          cta: {
            label: textOrEmpty(section.ctaLabel || '', ''),
            url: textOrEmpty(section.ctaUrl || '', '').trim(),
          },
        };

        if (section.mode === 'steps') {
          payload.steps = contentLines;
        } else if (contentLines.length > 0) {
          payload.bullets = contentLines;
        }

        const subsections = Array.isArray(section.subsections)
          ? section.subsections
              .map((subsection) => ({
                title: textOrEmpty(subsection.title || 'Tech Stack', 'Tech Stack'),
                bullets: fromLines(subsection.bulletsText || ''),
              }))
              .filter((subsection) => subsection.title || subsection.bullets.length > 0)
          : [];

        if (subsections.length > 0) {
          payload.subsections = subsections;
        }

        return payload;
      })
    : [],
  support: {
    title: textOrEmpty(editor.support?.title || emptyConfig.support.title, emptyConfig.support.title),
    body: textOrEmpty(editor.support?.body || emptyConfig.support.body, emptyConfig.support.body),
    links: Array.isArray(editor.support?.links)
      ? editor.support.links
          .map((link) => ({
            label: textOrEmpty(link.label || '', ''),
            url: textOrEmpty(link.url || '', '').trim(),
          }))
          .filter((link) => link.label || link.url)
      : [],
  },
});

const deepClone = (value) => JSON.parse(JSON.stringify(value));

const createSection = (mode = 'bullets') => ({
  id: createId('section'),
  title: sectionTemplates[mode]?.title || 'New Section',
  icon: sectionTemplates[mode]?.icon || '✦',
  accent: sectionTemplates[mode]?.accent || '#6366f1',
  body: sectionTemplates[mode]?.body || '',
  mode,
  itemsText: toLines(sectionTemplates[mode]?.items || []),
  ctaLabel: sectionTemplates[mode]?.cta?.label || '',
  ctaUrl: sectionTemplates[mode]?.cta?.url || '',
  subsections: (sectionTemplates[mode]?.subsections || []).map(normalizeSubsection),
});

const createLink = () => ({ label: '', url: '' });

const createSupportLink = (label, url) => ({ label, url });

const makeSummary = (config) => {
  const banner = config.banner || {};
  return {
    title: config.title || '',
    intro: config.intro || '',
    bannerEnabled: Boolean(banner.enabled),
    sectionCount: Array.isArray(config.sections) ? config.sections.length : 0,
    supportCount: Array.isArray(config.support?.links) ? config.support.links.length : 0,
  };
};

function TextField({ label, value, onChange, placeholder = '', hint = '', type = 'text' }) {
  return (
    <label className="space-y-2 block">
      <div className="flex items-end justify-between gap-3">
        <span className="block text-sm font-semibold text-gray-100">{label}</span>
        {hint ? <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{hint}</span> : null}
      </div>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="w-full rounded-xl border border-white/10 bg-slate-950/70 px-4 py-3 text-gray-100 shadow-inner outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20"
      />
    </label>
  );
}

function TextAreaField({ label, value, onChange, placeholder = '', hint = '', rows = 4, mono = false }) {
  return (
    <label className="space-y-2 block">
      <div className="flex items-end justify-between gap-3">
        <span className="block text-sm font-semibold text-gray-100">{label}</span>
        {hint ? <span className="text-[11px] uppercase tracking-[0.18em] text-gray-500">{hint}</span> : null}
      </div>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        className={`w-full rounded-2xl border border-white/10 bg-slate-950/70 px-4 py-3 text-gray-100 shadow-inner outline-none transition focus:border-cyan-400 focus:ring-2 focus:ring-cyan-400/20 ${mono ? 'font-mono text-xs leading-6' : 'leading-6'}`}
      />
    </label>
  );
}

function PillButton({ active = false, children, onClick, tone = 'neutral', type = 'button' }) {
  const styles = {
    neutral: active
      ? 'border-cyan-400/40 bg-cyan-400/15 text-white'
      : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/20 hover:bg-white/10',
    dark: active
      ? 'border-emerald-400/40 bg-emerald-400/15 text-white'
      : 'border-white/10 bg-white/5 text-gray-300 hover:border-white/20 hover:bg-white/10',
  };
  return (
    <button
      type={type}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold transition ${styles[tone]}`}
    >
      {children}
    </button>
  );
}

function SectionPreview({ section }) {
  const hasBullets = Array.isArray(section.bullets) && section.bullets.length > 0;
  const hasSteps = Array.isArray(section.steps) && section.steps.length > 0;

  return (
    <article className="rounded-3xl border border-white/8 bg-white/4 p-5 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="mb-2 inline-flex items-center rounded-full border border-white/10 bg-black/20 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-white/80">
            <span className="mr-2" aria-hidden="true">{section.icon || '✦'}</span>
            {section.title}
          </div>
          {section.body ? <p className="text-sm leading-6 text-slate-300">{section.body}</p> : null}
        </div>
        {section.cta?.url ? (
          <a
            href={section.cta.url}
            className="inline-flex shrink-0 items-center rounded-full border border-amber-400/30 bg-amber-400/15 px-3 py-1.5 text-xs font-semibold text-amber-100"
          >
            {section.cta.label || 'Open'}
          </a>
        ) : null}
      </div>

      {hasBullets ? (
        <ul className="mt-4 grid gap-2 text-sm text-slate-100">
          {section.bullets.map((item) => (
            <li key={item} className="flex gap-2 rounded-2xl border border-white/6 bg-white/5 px-3 py-2">
              <span className="mt-1 h-2 w-2 rounded-full bg-cyan-300" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {hasSteps ? (
        <ol className="mt-4 grid gap-2 text-sm text-slate-100">
          {section.steps.map((item, index) => (
            <li key={`${item}-${index}`} className="flex gap-3 rounded-2xl border border-white/6 bg-white/5 px-3 py-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-400/15 text-xs font-bold text-emerald-200">
                {index + 1}
              </span>
              <span>{item}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {Array.isArray(section.subsections) && section.subsections.length > 0 ? (
        <div className="mt-4 grid gap-3 border-t border-white/8 pt-4">
          {section.subsections.map((subsection) => (
            <div key={subsection.title} className="rounded-2xl border border-white/8 bg-slate-950/50 p-3">
              <div className="text-sm font-semibold text-white">{subsection.title}</div>
              <ul className="mt-2 grid gap-1 text-sm text-slate-300">
                {subsection.bullets.map((item) => (
                  <li key={item} className="flex gap-2">
                    <span className="text-cyan-300">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function EditorSectionCard({ section, index, total, onChange, onMove, onDuplicate, onRemove }) {
  const canMoveUp = index > 0;
  const canMoveDown = index < total - 1;

  const setField = (key, value) => onChange({ ...section, [key]: value });

  const updateSubsection = (subIndex, key, value) => {
    const subsections = section.subsections.map((subsection, currentIndex) =>
      currentIndex === subIndex ? { ...subsection, [key]: value } : subsection,
    );
    onChange({ ...section, subsections });
  };

  const addSubsection = () => {
    onChange({
      ...section,
      subsections: [...section.subsections, { title: 'New Subsection', bulletsText: '' }],
    });
  };

  const removeSubsection = (subIndex) => {
    onChange({
      ...section,
      subsections: section.subsections.filter((_, currentIndex) => currentIndex !== subIndex),
    });
  };

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-5 shadow-[0_14px_30px_rgba(0,0,0,0.22)]">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="flex items-start gap-4">
          <div
            className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-white/10 text-2xl shadow-inner"
            style={{ background: `linear-gradient(135deg, ${section.accent || '#6366f1'}33, rgba(0,0,0,0.25))` }}
          >
            {section.icon || '✦'}
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold text-white">{section.title || 'Untitled section'}</h3>
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                {section.mode}
              </span>
            </div>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-400">
              Edit this card as a self-contained contribution area. Each section can be a list, a step flow, or a mixed support block.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 xl:justify-end">
          <PillButton onClick={() => onMove(-1)} active={false} tone="neutral" type="button">
            ↑ Move
          </PillButton>
          <PillButton onClick={() => onMove(1)} active={false} tone="neutral" type="button">
            ↓ Move
          </PillButton>
          <PillButton onClick={onDuplicate} active={false} tone="neutral" type="button">
            Duplicate
          </PillButton>
          <PillButton onClick={onRemove} active={false} tone="neutral" type="button">
            Remove
          </PillButton>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        <TextField label="Section title" value={section.title} onChange={(value) => setField('title', value)} placeholder="Section title" />
        <TextField label="Icon" value={section.icon} onChange={(value) => setField('icon', value)} placeholder="⚡" hint="emoji or text" />
        <TextField label="Accent color" value={section.accent} onChange={(value) => setField('accent', value)} placeholder="#6366f1" hint="hex color" />
        <TextField label="Primary CTA label" value={section.ctaLabel} onChange={(value) => setField('ctaLabel', value)} placeholder="View Repository" />
      </div>

      <div className="mt-4 grid gap-4">
        <TextAreaField label="Section body" value={section.body} onChange={(value) => setField('body', value)} rows={3} />
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[180px_1fr]">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">Content mode</div>
          <div className="mt-3 grid gap-2">
            <PillButton active={section.mode === 'bullets'} onClick={() => setField('mode', 'bullets')} tone="dark">Bullets</PillButton>
            <PillButton active={section.mode === 'steps'} onClick={() => setField('mode', 'steps')} tone="dark">Steps</PillButton>
          </div>
          <p className="mt-3 text-xs leading-5 text-slate-400">
            Choose the presentation style for the main list inside this card.
          </p>
        </div>

        <TextAreaField
          label={section.mode === 'steps' ? 'Step lines' : 'Bullet lines'}
          value={section.itemsText}
          onChange={(value) => setField('itemsText', value)}
          rows={6}
          placeholder={section.mode === 'steps' ? 'One step per line' : 'One bullet per line'}
          hint="one per line"
        />
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-white/5 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Nested subsections</div>
            <p className="text-xs text-slate-400">Useful for stack details, links, or secondary bullet groups.</p>
          </div>
          <button
            type="button"
            onClick={addSubsection}
            className="inline-flex items-center rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
          >
            Add subsection
          </button>
        </div>

        <div className="mt-4 grid gap-3">
          {section.subsections.map((subsection, subIndex) => (
            <div key={`${section.id}-sub-${subIndex}`} className="rounded-2xl border border-white/8 bg-slate-950/60 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-semibold text-white">Subsection {subIndex + 1}</div>
                <button
                  type="button"
                  onClick={() => removeSubsection(subIndex)}
                  className="text-xs font-semibold text-rose-200 hover:text-rose-100"
                >
                  Remove
                </button>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-2">
                <TextField
                  label="Subsection title"
                  value={subsection.title}
                  onChange={(value) => updateSubsection(subIndex, 'title', value)}
                  placeholder="Tech Stack"
                />
                <TextAreaField
                  label="Subsection bullets"
                  value={subsection.bulletsText}
                  onChange={(value) => updateSubsection(subIndex, 'bulletsText', value)}
                  rows={4}
                  placeholder="One line per bullet"
                />
              </div>
            </div>
          ))}
          {section.subsections.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
              No subsections yet. Add one for grouped details like tech stack or contact links.
            </div>
          ) : null}
        </div>
      </div>
    </article>
  );
}

function LinkRow({ link, index, onChange, onRemove }) {
  return (
    <div className="grid gap-3 rounded-2xl border border-white/10 bg-slate-950/60 p-4 lg:grid-cols-[1fr_1.3fr_auto] lg:items-end">
      <TextField label={`Link ${index + 1} label`} value={link.label} onChange={(value) => onChange({ ...link, label: value })} placeholder="Ko-fi" />
      <TextField label="URL" value={link.url} onChange={(value) => onChange({ ...link, url: value })} placeholder="https://..." />
      <button
        type="button"
        onClick={onRemove}
        className="rounded-full border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-300 hover:border-rose-400/40 hover:text-rose-100"
      >
        Remove
      </button>
    </div>
  );
}

function HelpBannerPreview({ config }) {
  const banner = config.banner || {};
  const sections = Array.isArray(config.sections) ? config.sections : [];
  const support = config.support || {};

  return (
    <div className="sticky top-6 rounded-[2rem] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_28%),linear-gradient(180deg,rgba(7,9,15,0.96),rgba(4,6,12,0.98))] p-4 shadow-[0_24px_60px_rgba(0,0,0,0.35)]">
      <div className="rounded-[1.5rem] border border-white/8 bg-slate-950/75 p-5">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/90">Live Preview</div>
            <h2 className="mt-2 text-2xl font-black tracking-tight text-white">{config.title}</h2>
          </div>
          <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold text-gray-300">
            {sections.length} sections
          </div>
        </div>

        <p className="mt-3 text-sm leading-6 text-slate-300">{config.intro}</p>

        {banner.enabled ? (
          <div className="mt-5 rounded-[1.5rem] border border-amber-400/20 bg-gradient-to-br from-amber-400/12 via-slate-950 to-slate-900 p-4">
            <div className="inline-flex items-center rounded-full border border-amber-300/20 bg-amber-300/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-amber-100">
              {banner.badge}
            </div>
            <h3 className="mt-3 text-xl font-bold text-white">{banner.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{banner.message}</p>
            {Array.isArray(banner.details) && banner.details.length > 0 ? (
              <ul className="mt-4 grid gap-2">
                {banner.details.map((item) => (
                  <li key={item} className="flex gap-2 rounded-2xl border border-white/6 bg-white/5 px-3 py-2 text-sm text-slate-100">
                    <span className="mt-1 h-2 w-2 rounded-full bg-emerald-300" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            ) : null}
            {banner.cta?.url ? (
              <a
                href={banner.cta.url}
                className="mt-4 inline-flex items-center rounded-full bg-amber-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-amber-300"
              >
                {banner.cta.label || 'Open'}
              </a>
            ) : null}
          </div>
        ) : (
          <div className="mt-5 rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 px-4 py-8 text-center text-sm text-slate-400">
            Banner is disabled.
          </div>
        )}

        <div className="mt-5 grid gap-3">
          {sections.map((section) => (
            <SectionPreview key={section.id} section={{ ...section, bullets: section.mode === 'bullets' ? fromLines(section.itemsText) : [], steps: section.mode === 'steps' ? fromLines(section.itemsText) : [] }} />
          ))}
        </div>

        {support.title || support.body || (Array.isArray(support.links) && support.links.length > 0) ? (
          <div className="mt-5 rounded-[1.5rem] border border-cyan-400/15 bg-cyan-400/5 p-4">
            <h3 className="text-lg font-bold text-white">{support.title}</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">{support.body}</p>
            {Array.isArray(support.links) && support.links.length > 0 ? (
              <div className="mt-4 flex flex-wrap gap-2">
                {support.links.map((link) =>
                  link.url ? (
                    <a
                      key={`${link.label}-${link.url}`}
                      href={link.url}
                      className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-2 text-sm font-semibold text-gray-200"
                    >
                      {link.label || 'Link'}
                    </a>
                  ) : null,
                )}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function SiteBannerAdmin() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [access, setAccess] = useState({ logged_in: false, is_admin: false, user: null });
  const [serverConfig, setServerConfig] = useState(normalizeConfig(emptyConfig));
  const [form, setForm] = useState(normalizeConfig(emptyConfig));
  const [activeTab, setActiveTab] = useState('banner');
  const [hasLoaded, setHasLoaded] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        setLoading(true);
        setError('');

        const [accessResponse, configResponse] = await Promise.all([
          fetch('/admin/api/access', { credentials: 'include' }),
          fetch('/db/help-config', { headers: { Accept: 'application/json' }, credentials: 'include' }),
        ]);

        const accessData = await accessResponse.json();
        if (!accessResponse.ok || !accessData?.ok) {
          throw new Error(accessData?.error || 'Failed to load access info');
        }

        const configData = await configResponse.json();
        if (!configResponse.ok) {
          throw new Error(configData?.error || 'Failed to load help config');
        }

        if (!cancelled) {
          const normalized = normalizeConfig(configData);
          setAccess({
            logged_in: Boolean(accessData.logged_in),
            is_admin: Boolean(accessData.is_admin),
            user: accessData.user || null,
          });
          setServerConfig(normalized);
          setForm(normalized);
          setHasLoaded(true);
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

  useEffect(() => {
    if (!hasLoaded) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(editorToConfig(form)));
    } catch {
      // Ignore local draft storage failures.
    }
  }, [form, hasLoaded]);

  useEffect(() => {
    if (!hasLoaded || draftLoaded) return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const restored = normalizeConfig(parsed);
        setForm(restored);
        setDraftLoaded(true);
        setStatus('Recovered local draft.');
      }
    } catch {
      // Ignore bad draft data.
    }
  }, [hasLoaded, draftLoaded]);

  const payload = useMemo(() => editorToConfig(form), [form]);
  const summary = useMemo(() => makeSummary(payload), [payload]);

  const updateBanner = (key, value) => {
    setForm((current) => ({
      ...current,
      banner: {
        ...current.banner,
        [key]: value,
      },
    }));
  };

  const updateSection = (sectionIndex, updater) => {
    setForm((current) => ({
      ...current,
      sections: current.sections.map((section, index) => (index === sectionIndex ? updater(section) : section)),
    }));
  };

  const updateSupport = (key, value) => {
    setForm((current) => ({
      ...current,
      support: {
        ...current.support,
        [key]: value,
      },
    }));
  };

  const addSection = (mode = 'bullets') => {
    setForm((current) => ({
      ...current,
      sections: [...current.sections, createSection(mode)],
    }));
    setActiveTab('content');
  };

  const duplicateSection = (sectionIndex) => {
    setForm((current) => {
      const target = current.sections[sectionIndex];
      const copy = normalizeSection(payload.sections[sectionIndex] || target);
      copy.id = createId('section');
      copy.title = `${copy.title} Copy`;
      return {
        ...current,
        sections: [...current.sections.slice(0, sectionIndex + 1), copy, ...current.sections.slice(sectionIndex + 1)],
      };
    });
  };

  const moveSection = (sectionIndex, delta) => {
    setForm((current) => {
      const nextIndex = sectionIndex + delta;
      if (nextIndex < 0 || nextIndex >= current.sections.length) return current;
      const next = [...current.sections];
      const [item] = next.splice(sectionIndex, 1);
      next.splice(nextIndex, 0, item);
      return { ...current, sections: next };
    });
  };

  const removeSection = (sectionIndex) => {
    setForm((current) => ({
      ...current,
      sections: current.sections.filter((_, index) => index !== sectionIndex),
    }));
  };

  const addSupportLink = () => {
    setForm((current) => ({
      ...current,
      support: {
        ...current.support,
        links: [...current.support.links, createLink()],
      },
    }));
  };

  const updateSupportLink = (linkIndex, nextLink) => {
    setForm((current) => ({
      ...current,
      support: {
        ...current.support,
        links: current.support.links.map((link, index) => (index === linkIndex ? nextLink : link)),
      },
    }));
  };

  const removeSupportLink = (linkIndex) => {
    setForm((current) => ({
      ...current,
      support: {
        ...current.support,
        links: current.support.links.filter((_, index) => index !== linkIndex),
      },
    }));
  };

  const addDefaultSection = (mode) => addSection(mode);

  const saveConfig = async (event) => {
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
        body: JSON.stringify(payload),
      });

      const data = await response.json();
      if (!response.ok || !data?.ok) {
        throw new Error(data?.error || 'Failed to save help config');
      }

      const normalized = normalizeConfig(data.help_config);
      setServerConfig(normalized);
      setForm(normalized);
      setStatus('Help config saved.');
    } catch (err) {
      setError(err?.message || 'Failed to save help config');
    } finally {
      setSaving(false);
    }
  };

  const restoreServerCopy = () => {
    setForm(serverConfig);
    setStatus('Restored the last saved server copy.');
  };

  const clearDraft = () => {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }
    setDraftLoaded(false);
    setForm(serverConfig);
    setStatus('Local draft cleared.');
  };

  if (loading) {
    return (
      <div className="w-full p-8 text-gray-300">
        Loading help config editor...
      </div>
    );
  }

  if (error && !access.logged_in) {
    return (
      <div className="w-full p-8">
        <div className="rounded border border-red-500/40 bg-red-900/20 px-4 py-3 text-red-200">
          {error}
        </div>
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

  return (
    <div className="min-h-screen w-full bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.05),transparent_28%),linear-gradient(180deg,#090b11_0%,#05070d_100%)] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <section className="rounded-[2rem] border border-white/10 bg-slate-950/80 p-6 shadow-[0_24px_70px_rgba(0,0,0,0.35)]">
          <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
            <div className="max-w-4xl">
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-cyan-200/90">
                <span className="rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1">Help Config Editor</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Auto-saved locally</span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1">Admin locked</span>
              </div>
              <h1 className="mt-4 text-4xl font-black tracking-tight text-white sm:text-5xl">
                Build the help page like a product, not a blob of text.
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">
                Edit the shared help config with a proper section builder, live preview, and local draft recovery.
                The banner, page copy, section cards, and support links all live in one modular payload.
              </p>
            </div>

            <div className="flex flex-wrap gap-3 xl:justify-end">
              <button
                type="button"
                onClick={restoreServerCopy}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-cyan-400/40 hover:bg-cyan-400/10"
              >
                Restore server copy
              </button>
              <button
                type="button"
                onClick={clearDraft}
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-rose-400/40 hover:bg-rose-400/10"
              >
                Clear local draft
              </button>
              <a
                href="/react-admin"
                className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm font-semibold text-gray-100 transition hover:border-white/25 hover:bg-white/10"
              >
                Back to admin hub
              </a>
            </div>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Banner</div>
              <div className="mt-2 text-2xl font-black text-white">{summary.bannerEnabled ? 'On' : 'Off'}</div>
              <div className="mt-1 text-sm text-slate-400">Toggle the help wanted banner independently.</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Sections</div>
              <div className="mt-2 text-2xl font-black text-white">{summary.sectionCount}</div>
              <div className="mt-1 text-sm text-slate-400">Reusable cards for contributors to choose from.</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Support links</div>
              <div className="mt-2 text-2xl font-black text-white">{summary.supportCount}</div>
              <div className="mt-1 text-sm text-slate-400">Quick links to Ko-fi, Patreon, or anything else.</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Draft</div>
              <div className="mt-2 text-2xl font-black text-white">Saved</div>
              <div className="mt-1 text-sm text-slate-400">Your changes stay in browser storage while you work.</div>
            </div>
          </div>
        </section>

        {error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-950/40 px-4 py-3 text-red-100">{error}</div>
        ) : null}
        {status ? (
          <div className="rounded-2xl border border-emerald-500/40 bg-emerald-950/40 px-4 py-3 text-emerald-100">{status}</div>
        ) : null}

        <form onSubmit={saveConfig} className="grid gap-6 xl:grid-cols-[280px_minmax(0,1fr)_420px]">
          <aside className="rounded-[1.8rem] border border-white/10 bg-slate-950/80 p-4 shadow-[0_18px_45px_rgba(0,0,0,0.28)] xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)] xl:overflow-auto">
            <div className="rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Jump to</div>
              <div className="mt-3 grid gap-2">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-2xl border px-4 py-3 text-left transition ${activeTab === tab.id ? 'border-cyan-400/40 bg-cyan-400/10' : 'border-white/10 bg-white/5 hover:border-white/20 hover:bg-white/10'}`}
                  >
                    <div className="text-sm font-semibold text-white">{tab.label}</div>
                    <div className="mt-1 text-xs text-slate-400">{tab.hint}</div>
                  </button>
                ))}
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Quick actions</div>
              <div className="mt-3 grid gap-2">
                <button
                  type="button"
                  onClick={() => addDefaultSection('bullets')}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-gray-100 hover:border-cyan-400/40 hover:bg-cyan-400/10"
                >
                  Add bullet section
                </button>
                <button
                  type="button"
                  onClick={() => addDefaultSection('steps')}
                  className="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-left text-sm font-semibold text-gray-100 hover:border-emerald-400/40 hover:bg-emerald-400/10"
                >
                  Add step section
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="rounded-2xl bg-amber-400 px-4 py-3 text-left text-sm font-black text-slate-950 transition hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {saving ? 'Saving...' : 'Save help config'}
                </button>
              </div>
            </div>

            <div className="mt-4 rounded-2xl border border-white/8 bg-white/5 p-4 text-sm leading-6 text-slate-300">
              Every change is mirrored into local draft storage so you can close the tab, come back, and keep working.
            </div>
          </aside>

          <main className="rounded-[1.8rem] border border-white/10 bg-slate-950/80 p-5 shadow-[0_18px_45px_rgba(0,0,0,0.28)]">
            {activeTab === 'banner' ? (
              <section className="space-y-5">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Banner editor</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                      Shape the first thing contributors see. Keep it short, specific, and action-oriented.
                    </p>
                  </div>
                  <label className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm font-semibold text-gray-100">
                    <input
                      type="checkbox"
                      checked={form.banner.enabled}
                      onChange={(event) => updateBanner('enabled', event.target.checked)}
                      className="h-4 w-4 rounded border-white/20 bg-slate-950 text-cyan-400 focus:ring-cyan-400"
                    />
                    Banner enabled
                  </label>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <TextField label="Badge" value={form.banner.badge} onChange={(value) => updateBanner('badge', value)} placeholder="Help wanted" />
                  <TextField label="CTA label" value={form.banner.ctaLabel} onChange={(value) => updateBanner('ctaLabel', value)} placeholder="Read the help page" />
                </div>

                <TextField label="Title" value={form.banner.title} onChange={(value) => updateBanner('title', value)} placeholder="Want to help the project?" />
                <TextAreaField label="Message" value={form.banner.message} onChange={(value) => updateBanner('message', value)} rows={4} placeholder="Tell people what help you need." />
                <TextAreaField label="Details, one per line" value={form.banner.detailsText} onChange={(value) => updateBanner('detailsText', value)} rows={5} placeholder="One idea per line" />
                <TextField label="CTA URL" value={form.banner.ctaUrl} onChange={(value) => updateBanner('ctaUrl', value)} placeholder="/help" />
              </section>
            ) : null}

            {activeTab === 'content' ? (
              <section className="space-y-5">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div>
                    <h2 className="text-2xl font-bold text-white">Help page content</h2>
                    <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                      These cards drive the modular help page. Each section can be a bullet list, a step flow, or a mixed subsection block.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => addDefaultSection('bullets')}
                    className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-4 py-2 text-sm font-semibold text-cyan-100"
                  >
                    Add section
                  </button>
                </div>

                <div className="grid gap-4">
                  <TextField label="Help page title" value={form.title} onChange={(value) => setForm((current) => ({ ...current, title: value }))} placeholder="Help & Contribute" />
                  <TextAreaField label="Help page intro" value={form.intro} onChange={(value) => setForm((current) => ({ ...current, intro: value }))} rows={3} placeholder="Intro paragraph for the help page." />
                </div>

                <div className="grid gap-5">
                  {form.sections.map((section, index) => (
                    <EditorSectionCard
                      key={section.id}
                      section={section}
                      index={index}
                      total={form.sections.length}
                      onChange={(nextSection) => updateSection(index, () => nextSection)}
                      onMove={(delta) => moveSection(index, delta)}
                      onDuplicate={() => duplicateSection(index)}
                      onRemove={() => removeSection(index)}
                    />
                  ))}

                  {form.sections.length === 0 ? (
                    <div className="rounded-[1.5rem] border border-dashed border-white/10 bg-white/5 px-5 py-10 text-center text-sm text-slate-400">
                      No help sections yet. Add one to start building the page.
                    </div>
                  ) : null}
                </div>
              </section>
            ) : null}

            {activeTab === 'support' ? (
              <section className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-white">Support strip</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    This is the footer-ish block that gives people alternate ways to help or support the project.
                  </p>
                </div>

                <TextField label="Support title" value={form.support.title} onChange={(value) => updateSupport('title', value)} placeholder="Other Ways to Help" />
                <TextAreaField label="Support body" value={form.support.body} onChange={(value) => updateSupport('body', value)} rows={3} placeholder="Describe non-dev ways to help." />

                <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold text-white">Support links</div>
                      <p className="text-xs text-slate-400">These appear as buttons on the help page.</p>
                    </div>
                    <button
                      type="button"
                      onClick={addSupportLink}
                      className="rounded-full border border-cyan-400/30 bg-cyan-400/10 px-3 py-1.5 text-xs font-semibold text-cyan-100"
                    >
                      Add link
                    </button>
                  </div>

                  <div className="mt-4 grid gap-3">
                    {form.support.links.map((link, index) => (
                      <LinkRow
                        key={`${index}-${link.label}-${link.url}`}
                        link={link}
                        index={index}
                        onChange={(nextLink) => updateSupportLink(index, nextLink)}
                        onRemove={() => removeSupportLink(index)}
                      />
                    ))}
                    {form.support.links.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-slate-400">
                        No support links yet. Add Ko-fi, Patreon, or any other destination you want to show.
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>
            ) : null}

            {activeTab === 'advanced' ? (
              <section className="space-y-5">
                <div>
                  <h2 className="text-2xl font-bold text-white">Advanced tools</h2>
                  <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-400">
                    Useful if you want to copy the whole payload, inspect what will be saved, or do a quick reset.
                  </p>
                </div>

                <div className="grid gap-4 lg:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Preview state</div>
                    <div className="mt-2 text-sm text-slate-300">This is the exact structure that will be sent to the server.</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Local draft</div>
                    <div className="mt-2 text-sm text-slate-300">Your current work is saved in browser storage as you type.</div>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-white/5 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-gray-500">Server copy</div>
                    <div className="mt-2 text-sm text-slate-300">Use restore if you want to roll back to the last saved version.</div>
                  </div>
                </div>

                <div className="grid gap-4 lg:grid-cols-2">
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-4">
                    <div className="text-sm font-semibold text-white">Saved JSON</div>
                    <pre className="mt-3 max-h-[420px] overflow-auto rounded-2xl bg-black/40 p-4 text-xs leading-6 text-slate-200">
                      {JSON.stringify(payload, null, 2)}
                    </pre>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/10 bg-slate-950/70 p-4">
                    <div className="text-sm font-semibold text-white">Quick notes</div>
                    <ul className="mt-3 grid gap-2 text-sm leading-6 text-slate-300">
                      <li>• Keep the banner short and action-oriented.</li>
                      <li>• Use one line per bullet or step for the easiest editing flow.</li>
                      <li>• The preview updates live while you work.</li>
                      <li>• Saving is admin-locked on the backend.</li>
                    </ul>
                  </div>
                </div>
              </section>
            ) : null}
          </main>

          <aside className="xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)] xl:overflow-auto">
            <HelpBannerPreview config={payload} />
          </aside>
        </form>
      </div>
    </div>
  );
}
