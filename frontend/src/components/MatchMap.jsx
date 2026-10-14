/**
 * The match map: the timeline's deaths drawn on the minimap for the layout the match
 * was played on. It takes the same rows the list below shows, so the two views can
 * never disagree. `children` render inside the frame on top of the markers, which is
 * how the replay layer puts players on the same map; `caption` replaces the default
 * caption (pass null for none).
 */

import { useState } from "react";
import { cdnImage } from "../utils/cdn";
import {
  BACKDROP_RATIO,
  MAP_ART_FILTER,
  mapVersionConfig,
  worldToPercent,
} from "../utils/matchMap";

/**
 * Timeline rows that carry a position, as map markers. Pure, so it can be tested
 * without a DOM. Rows without a usable position (every non-death row today) drop out.
 */
export function deathMarkers(rows = []) {
  return rows
    .map((row, index) => {
      if (row?.type !== "death") return null;
      const point = worldToPercent(row.position?.x, row.position?.y);
      if (!point) return null;
      return {
        key: `death-${index}`,
        left: point.left,
        top: point.top,
        team: row.team ?? null,
        timeS: row.time_s ?? null,
        text: row.text,
      };
    })
    .filter(Boolean);
}

const TEAM_COLOR = (team) =>
  team === 1 ? "var(--color-team-sapphire)" : "var(--color-team-amber)";

/** How a past death is drawn: bright and pulsing when fresh, fading to a faint mark. */
function deathMarkStyle(timeS, now) {
  if (now == null || timeS == null) return { opacity: 0.85, fresh: false };
  const age = Math.max(0, now - timeS);
  if (age < 8) return { opacity: 1, fresh: true };
  return { opacity: Math.max(0.3, 0.85 - (age - 8) / 240), fresh: false };
}

export default function MatchMap({ rows = [], version = null, className = "", caption, now = null, children = null }) {
  const [failed, setFailed] = useState(false);
  const config = mapVersionConfig(version);
  const markers = deathMarkers(rows);

  if (failed) {
    return (
      <p className={`text-sm text-dim ${className}`}>
        The {config.label} map image could not be loaded.
      </p>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative aspect-square w-full max-w-[520px]">
        <img
          src={cdnImage(config.background)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full max-w-none rounded-full"
          style={{ transform: `scale(${BACKDROP_RATIO})` }}
          onError={() => setFailed(true)}
        />
        <img
          src={cdnImage(config.overlay)}
          alt={`${config.label} minimap`}
          className="absolute inset-0 h-full w-full"
          style={{ filter: MAP_ART_FILTER }}
          onError={() => setFailed(true)}
        />
        {markers.map((marker) => {
          const { opacity, fresh } = deathMarkStyle(marker.timeS, now);
          return (
            <span
              key={marker.key}
              title={marker.text}
              className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 ${
                fresh ? "animate-pulse" : ""
              }`}
              style={{ left: `${marker.left}%`, top: `${marker.top}%`, opacity, zIndex: 1 }}
            >
              <svg width="11" height="11" viewBox="0 0 11 11" aria-hidden="true">
                <path
                  d="M2 2 L9 9 M9 2 L2 9"
                  stroke="black"
                  strokeOpacity="0.8"
                  strokeWidth="4"
                  strokeLinecap="round"
                />
                <path
                  d="M2 2 L9 9 M9 2 L2 9"
                  stroke={TEAM_COLOR(marker.team)}
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
              </svg>
            </span>
          );
        })}
        {children}
      </div>
      {caption === undefined ? (
        <p className="text-xs text-dim">
          {config.label} · {markers.length} death{markers.length === 1 ? "" : "s"} plotted
        </p>
      ) : (
        caption
      )}
    </div>
  );
}
