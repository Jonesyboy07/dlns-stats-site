import { useEffect, useRef, useState } from "react";

const RESET_MS = 4000;

/**
 * Looks up the replay for a match via /db/matches/<id>/replay and opens the
 * filebrowser download URL in a new tab. Shows lightweight inline feedback
 * while loading, and if the file isn't found / service isn't configured.
 */
export default function ReplayButton({ matchId, compact = false }) {
  const [state, setState] = useState({ status: "idle", message: "" });
  const timerRef = useRef(null);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const resetSoon = () => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(
      () => setState({ status: "idle", message: "" }),
      RESET_MS
    );
  };

  const handleClick = async () => {
    if (!matchId || state.status === "loading") return;
    setState({ status: "loading", message: "" });
    try {
      const res = await fetch(`/db/matches/${matchId}/replay`);
      const data = await res.json().catch(() => null);
      const replay = data?.replay;
      // Open the Filebrowser UI so the file isn't downloaded right away. Older
      // cached responses only have download_url, so fall back to that.
      const openUrl = replay?.share_url || replay?.download_url;
      if (res.ok && data?.ok && openUrl) {
        window.open(openUrl, "_blank", "noopener,noreferrer");
        setState({
          status: "ready",
          message: replay?.name ? `Opened ${replay.name} in Filebrowser` : "Opened in Filebrowser",
        });
      } else if (res.status === 404 || data?.found === false) {
        setState({
          status: "notfound",
          message: data?.message || "No replay found for this match.",
        });
      } else if (res.status === 503) {
        setState({
          status: "error",
          message: "Replay storage is not configured.",
        });
      } else {
        setState({
          status: "error",
          message: data?.message || `Replay lookup failed (HTTP ${res.status}).`,
        });
      }
    } catch {
      setState({ status: "error", message: "Could not reach the replay service." });
    }
    resetSoon();
  };

  const label = {
    idle: "Replay",
    loading: "Looking up…",
    ready: "Opened ✓",
    notfound: "No replay",
    error: "Replay error",
  }[state.status];

  const colorClass = {
    idle: "text-cyan-400/90 hover:text-accent",
    loading: "text-muted",
    ready: "text-success",
    notfound: "text-amber-400/90",
    error: "text-red-400/90",
  }[state.status];

  const iconSize = compact ? 10 : 11;
  const textSize = compact ? "text-[12px]" : "text-[13px]";

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={state.status === "loading"}
      title={state.message || "Open this match's replay in Filebrowser"}
      className={`${textSize} font-heading font-semibold tracking-[.02em] flex items-center gap-1.5 transition-colors ${colorClass} disabled:cursor-wait`}
    >
      <svg
        width={iconSize}
        height={iconSize}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      {label}
    </button>
  );
}
