import { useEffect, useRef, useState } from "react";

const RESET_MS = 4000;

export const resolveReplayOpenUrl = (replay) => replay?.download_url || replay?.share_url;
export const resolveReplayLookupState = (response, data, { opened = false } = {}) => {
  const replay = data?.replay;
  const openUrl = resolveReplayOpenUrl(replay);

  if (response.ok && data?.ok && openUrl) {
    return {
      status: opened ? "opened" : "available",
      message: opened
        ? replay?.name
          ? `Started download for ${replay.name}`
          : "Started replay download"
        : replay?.name
          ? `Replay ready: ${replay.name}`
          : "Replay ready to download",
      openUrl,
    };
  }

  if (response.status === 404 || data?.found === false) {
    return {
      status: "notfound",
      message: data?.message || "No replay found for this match.",
      openUrl: "",
    };
  }

  if (response.status === 503) {
    return {
      status: "error",
      message: "Replay storage is not configured.",
      openUrl: "",
    };
  }

  return {
    status: "error",
    message: data?.message || `Replay lookup failed (HTTP ${response.status}).`,
    openUrl: "",
  };
};

/**
 * Looks up the replay for a match via /db/matches/<id>/replay and opens the
 * filebrowser download URL in a new tab. Shows lightweight inline feedback
 * while loading, and if the file isn't found / service isn't configured.
 */
export default function ReplayButton({ matchId, compact = false }) {
  const [state, setState] = useState({ status: "idle", message: "", openUrl: "" });
  const timerRef = useRef(null);
  const requestIdRef = useRef(0);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const resetSoon = (nextState) => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setState(nextState), RESET_MS);
  };

  const lookupReplay = async ({ opened = false } = {}) => {
    try {
      const res = await fetch(`/db/matches/${matchId}/replay`);
      const data = await res.json().catch(() => null);
      const nextState = resolveReplayLookupState(res, data, { opened });

      if (opened && nextState.openUrl) {
        window.open(nextState.openUrl, "_blank", "noopener,noreferrer");
        const steadyState = { ...nextState, status: "available" };
        setState(nextState);
        resetSoon(steadyState);
      } else {
        setState(nextState);
      }
    } catch {
      setState({ status: "error", message: "Could not reach the replay service.", openUrl: "" });
    }
  };

  useEffect(() => {
    if (!matchId) {
      setState({ status: "idle", message: "", openUrl: "" });
      return undefined;
    }

    const requestId = ++requestIdRef.current;
    const controller = new AbortController();
    setState({ status: "loading", message: "", openUrl: "" });

    (async () => {
      try {
        const res = await fetch(`/db/matches/${matchId}/replay`, {
          signal: controller.signal,
        });
        const data = await res.json().catch(() => null);
        if (requestId === requestIdRef.current) {
          setState(resolveReplayLookupState(res, data));
        }
      } catch (error) {
        if (error?.name !== "AbortError" && requestId === requestIdRef.current) {
          setState({ status: "error", message: "Could not reach the replay service.", openUrl: "" });
        }
      }
    })();

    return () => {
      controller.abort();
    };
  }, [matchId]);

  const handleClick = async () => {
    if (!matchId || state.status === "loading") return;
    if (state.openUrl) {
      window.open(state.openUrl, "_blank", "noopener,noreferrer");
      const openedState = { ...state, status: "opened" };
      setState(openedState);
      resetSoon({ ...state, status: "available" });
      return;
    }

    setState({ status: "loading", message: "", openUrl: "" });
    await lookupReplay({ opened: true });
  };

  const label = {
    idle: "Replay",
    loading: "Looking up…",
    available: "Replay",
    opened: "Opened ✓",
    notfound: "No replay",
    error: "Replay error",
  }[state.status];

  const colorClass = {
    idle: "text-cyan-400/90 hover:text-accent",
    loading: "text-muted",
    available: "text-cyan-400/90 hover:text-accent",
    opened: "text-success",
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
      title={state.message || "Download this match's replay"}
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
