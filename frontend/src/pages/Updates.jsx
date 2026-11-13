import React, { useEffect, useMemo, useState } from "react";
import { parseUpdates } from "../utils/updates";

const SECTION_LABEL = "text-[11px] font-semibold uppercase tracking-[.12em] text-muted";

/* Server-rendered markdown from data/update.md; trusted site content. */
function Body({ html, className = "" }) {
  if (!html) return null;
  return <div className={`updates-body ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

function EntryCard({ entry }) {
  return (
    <article className="rounded-xl border border-border bg-card p-5">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {entry.date && (
          <span className="rounded-full border border-accent-border bg-accent-bg px-2.5 py-0.5 text-[12px] font-semibold text-accent-light">
            {entry.date}
          </span>
        )}
        <h3 className="text-[18px] font-semibold leading-snug text-primary">{entry.title}</h3>
      </header>
      <Body html={entry.html} className="mt-3" />
    </article>
  );
}

function SkeletonCards() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-5">
          <div className="h-5 w-48 animate-pulse rounded-full bg-hover" />
          <div className="mt-4 h-3 w-[80%] animate-pulse rounded bg-hover" />
          <div className="mt-2 h-3 w-[60%] animate-pulse rounded bg-hover" />
        </div>
      ))}
    </div>
  );
}

/**
 * Updates — the project changelog. Content is data/update.md, served as HTML
 * by /api/updates; each `### Date - Title` becomes a card under its `##`
 * section, and a section with no dated entries (Feedback) renders as a note.
 */
export default function Updates() {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/updates")
      .then((res) => {
        if (!res.ok) throw new Error("Failed to load updates");
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setHtml(String(data.content_html || ""));
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const { intro, sections } = useMemo(() => parseUpdates(html), [html]);
  const isEmpty = !intro && sections.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8">
      <header className="flex flex-col gap-1.5">
        <h1 className="m-0 font-valve-pulp text-[40px] leading-none text-primary">Updates</h1>
        <p className="m-0 text-[14px] text-muted">Latest project changes and announcements.</p>
      </header>

      {loading && <SkeletonCards />}

      {!loading && error && (
        <p className="rounded-xl border border-border bg-card p-5 text-[14px] text-muted">
          Updates aren't loading right now. Try again in a moment.
        </p>
      )}

      {!loading && !error && isEmpty && (
        <p className="rounded-xl border border-border bg-card p-5 text-[14px] text-muted">No updates yet.</p>
      )}

      {!loading && !error && !isEmpty && (
        <>
          <Body html={intro} className="text-[15px]" />

          {sections.map((section, index) =>
            section.entries.length > 0 ? (
              <section key={section.title || index} className="flex flex-col gap-3">
                {section.title && <h2 className={SECTION_LABEL}>{section.title}</h2>}
                <Body html={section.html} />
                {section.entries.map((entry, i) => (
                  <EntryCard key={`${entry.date}-${entry.title}-${i}`} entry={entry} />
                ))}
              </section>
            ) : (
              <section
                key={section.title || index}
                className="rounded-xl border border-accent-border bg-accent-bg p-5"
              >
                {section.title && (
                  <h2 className="text-[16px] font-semibold text-accent-light">{section.title}</h2>
                )}
                <Body html={section.html} className="mt-2" />
              </section>
            ),
          )}
        </>
      )}
    </div>
  );
}
