import React from "react";
import { useSpoilerState, setSpoilerFree } from "./spoilerStore";

/** Header switch for spoiler-free mode. */
export default function SpoilerToggle({ className = "" }) {
  const { enabled } = useSpoilerState();
  return (
    <button
      type="button"
      onClick={() => setSpoilerFree(!enabled)}
      aria-pressed={enabled}
      title={enabled ? "Spoiler-free mode is on" : "Hide winners, scores and team names"}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors ${
        enabled
          ? "border-accent-border bg-accent-bg-strong text-accent-light"
          : "border-border-light bg-white/5 text-secondary hover:bg-hover"
      } ${className}`}
    >
      <span aria-hidden="true">{enabled ? "🙈" : "👁"}</span>
      Spoiler-free
    </button>
  );
}
