/**
 * A small status pill. The tones match the design system's variants, so a kill's
 * "First Blood" and a warning elsewhere on the site read the same.
 */

const TONES = {
  warning: "border-warning-border bg-warning-bg text-warning",
  accent: "border-accent-border bg-accent-bg-strong text-accent-light",
  danger: "border-danger-border bg-danger-bg text-danger-text",
  neutral: "border-border-light bg-badge-bg text-muted",
};

export default function Badge({ tone = "accent", children, className = "" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded border px-1.5 py-px font-valve-oracle text-[10px] font-bold uppercase tracking-[0.04em] ${
        TONES[tone] ?? TONES.accent
      } ${className}`}
    >
      {children}
    </span>
  );
}
