import React from "react";

/**
 * Widget — shared shell for the home page rail items.
 *
 * The rail itself is the only panel; each item is a plain section separated by a
 * divider, so widgets carry no card chrome of their own. The last item in the
 * rail (Contribute) is the exception and styles itself.
 *
 * Props:
 *   title     – small uppercase heading (optional)
 *   action    – node rendered on the right of the heading row (optional)
 *   children  – widget body
 *   className – extra classes for the outer section
 */
export default function Widget({ title, action, children, className = "" }) {
  return (
    <section className={`border-b border-border px-1 pt-1 pb-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && (
            <h2 className="font-valve-oracle text-[12px] font-semibold uppercase tracking-[.16em] text-dim">
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
