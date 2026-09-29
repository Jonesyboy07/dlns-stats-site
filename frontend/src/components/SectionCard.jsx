import React from "react";

/**
 * The team page's card surface, matching the design system's Card: the same recipe
 * the player pages' `Panel` uses (card surface, thin border, Valve Oracle title) so
 * both halves of the site read as one product.
 *
 * `action` is the right-aligned slot, used for column labels such as
 * "signature heroes".
 */
function SectionCard({ title, subtitle, action, className = "", children }) {
  const hasHeader = Boolean(title || subtitle || action);

  return (
    <section
      className={`rounded-xl border border-border-light bg-card px-5 py-[18px] shadow ${className}`}
    >
      {hasHeader && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && (
              <h2 className="font-valve-oracle text-[20px] leading-tight text-primary">
                {title}
              </h2>
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

export default SectionCard;
