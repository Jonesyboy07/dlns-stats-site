import React from "react";

/**
 * Panel with a small uppercase title, an optional subtitle and an optional
 * right-aligned slot (used for column labels such as "signature heroes").
 */
function SectionCard({ title, subtitle, action, className = "", children }) {
  const hasHeader = title || subtitle || action;

  return (
    <section
      className={`rounded-xl border border-gray-700/60 bg-gray-800/40 p-4 ${className}`}
    >
      {hasHeader && (
        <header className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                {title}
              </h2>
            )}
            {subtitle && (
              <p className="mt-0.5 text-[11px] text-gray-500">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0 pt-0.5">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export default SectionCard;
