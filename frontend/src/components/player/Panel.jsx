import React from "react";

/**
 * The player pages' section frame: card surface, thin border and a Valve Oracle
 * title, matching the design handoff. Deliberately separate from the team pages'
 * `SectionCard` so this rebuild does not restyle pages that are already shipped.
 */
export default function Panel({ title, subtitle, action, className = "", children }) {
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <section
      className={`rounded-xl border border-border-light bg-card px-5 py-[18px] shadow ${className}`}
    >
      {hasHeader && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-valve-oracle text-[20px] leading-tight text-primary">{title}</h2>
            )}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0 pt-0.5">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}
