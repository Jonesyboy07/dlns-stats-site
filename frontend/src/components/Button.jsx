/**
 * The design system's button. Three variants cover everything the timeline uses:
 * `primary` for the transport, `ghost` for the secondary actions beside it, and
 * `accent` for the one action that is the point of a panel.
 */

const VARIANTS = {
  primary:
    "border-border-light bg-card text-primary hover:border-accent-border",
  ghost:
    "border-transparent bg-transparent text-muted hover:text-primary",
  accent:
    "border-accent-border bg-accent-bg-strong text-accent-light hover:border-accent-border-strong",
};

const SIZES = {
  sm: "px-3 py-1.5 text-sm",
  xs: "px-2.5 py-1 text-[11px]",
};

export default function Button({
  variant = "primary",
  size = "sm",
  type = "button",
  className = "",
  children,
  ...rest
}) {
  return (
    <button
      type={type}
      className={`shrink-0 rounded-full border font-valve-oracle font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        VARIANTS[variant] ?? VARIANTS.primary
      } ${SIZES[size] ?? SIZES.sm} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
