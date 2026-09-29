import React from "react";

/**
 * The pill toggle the Player × Hero page uses three times (trend metric, lane vs
 * matchups, ability build). Active state is the accent pair, inactive is muted —
 * same grammar as the match table's filters.
 */
export default function SegmentedControl({
  options,
  value,
  onChange,
  label,
  className = "",
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center gap-0.5 rounded-full border border-border bg-table p-0.5 ${className}`}
    >
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={value === option.id}
          onClick={() => onChange(option.id)}
          title={option.title}
          className={`flex items-baseline gap-1.5 whitespace-nowrap rounded-full px-3 py-1 text-[12px] font-semibold transition-colors ${
            value === option.id
              ? "bg-accent-secondary-bg-strong text-accent-secondary-light"
              : "text-muted hover:text-secondary"
          }`}
        >
          {option.label}
          {option.note && (
            <span
              className={`text-[11px] font-medium ${
                value === option.id ? "text-secondary" : "text-dim"
              }`}
            >
              {option.note}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
