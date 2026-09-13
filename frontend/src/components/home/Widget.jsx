import React from "react";

/**
 * Widget — shared shell for the home page sidebar panels so every card keeps
 * the same border, padding and heading treatment.
 *
 * Props:
 *   title     – small uppercase heading (optional)
 *   action    – node rendered on the right of the heading row (optional)
 *   children  – widget body
 *   className – extra classes for the outer panel
 */
export default function Widget({ title, action, children, className = "" }) {
  return (
    <section
      className={`bg-panel border border-border rounded-lg p-4 shadow-panel ${className}`}
    >
      {(title || action) && (
        <div className="flex items-center justify-between gap-2 mb-3">
          {title && (
            <h2 className="text-[11px] font-semibold text-dim uppercase tracking-[.12em]">
              {title}
            </h2>
          )}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
