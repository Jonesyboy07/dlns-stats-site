import React from "react";

/**
 * A panel whose data does not exist yet. The hero-page rebuild ships the full
 * layout now; the analysis panels whose data the API cannot supply yet render
 * this dashed card instead of an empty chart. The placeholder copy is the single
 * string "Adding Soon", used for every not-yet-wired element on the page.
 */
export function PlaceholderPanel({ title, subtitle, note = "Adding Soon", className = "" }) {
  return (
    <section
      className={`flex flex-col gap-1.5 rounded-xl border border-dashed border-border-lighter bg-card px-5 py-[18px] ${className}`}
    >
      {title && (
        <h2 className="font-valve-oracle text-[20px] leading-tight text-primary">{title}</h2>
      )}
      {subtitle && <p className="text-[13px] text-muted">{subtitle}</p>}
      <p className="text-[13px] font-semibold text-dim">{note}</p>
    </section>
  );
}

/** The inline "Adding Soon" text used where a value or an asset is missing. */
export function AddingSoon({ className = "" }) {
  return (
    <span className={`text-[12px] font-semibold text-dim ${className}`}>Adding Soon</span>
  );
}

export default PlaceholderPanel;
