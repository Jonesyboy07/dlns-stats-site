/**
 * A labelled row of mutually exclusive options on a recessed track.
 *
 * Used across the Timeline tab (map mode, map options, playback speed). The group
 * label sits outside the track so the options stay aligned when a label is long.
 *
 * Styling follows the Timeline v3 handoff: a `--color-table` track, 24px segments,
 * and the selected one lifted onto `--color-hover` with a light border and the panel
 * shadow. An option can be `disabled` (struck through, with its `title` explaining
 * why) so a control keeps the same shape on matches that lack the data for it.
 */

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary-light";

export const CONTROL_LABEL =
  "font-valve-oracle text-[11px] font-semibold uppercase tracking-[0.12em] text-muted";

export default function SegmentedControl({ label, options = [], value, onChange, className = "" }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      {label ? <span className={CONTROL_LABEL}>{label}</span> : null}
      <div
        role="group"
        aria-label={label || undefined}
        className="flex items-center gap-0.5 rounded-md bg-table p-0.5"
      >
        {options.map((option) => {
          const active = option.value === value;
          const disabled = Boolean(option.disabled);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={active}
              disabled={disabled}
              title={option.title}
              onClick={() => onChange(option.value)}
              className={`h-6 rounded-[4px] border px-2.5 font-valve-oracle text-xs font-semibold transition-colors ${FOCUS_RING} ${
                active
                  ? "border-border-light bg-hover text-primary shadow-panel"
                  : "border-transparent text-muted hover:text-secondary"
              } ${disabled ? "cursor-not-allowed line-through opacity-60 hover:text-muted" : ""}`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
