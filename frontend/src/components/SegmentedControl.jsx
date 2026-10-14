/**
 * A labelled row of mutually exclusive options, styled as a pill track.
 *
 * The timeline's map toolbar is four of these side by side; the group label sits
 * outside the track so the options stay aligned when a label is long.
 */
export default function SegmentedControl({ label, options = [], value, onChange, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="font-valve-oracle text-[11px] font-semibold uppercase tracking-[0.06em] text-dim">
        {label}
      </span>
      <div className="flex items-center gap-0.5 rounded-full border border-border-light bg-table p-0.5">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                active
                  ? "bg-accent-bg-strong text-accent-light"
                  : "text-muted hover:text-secondary"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
