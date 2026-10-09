/**
 * The match map: the timeline's deaths drawn on the minimap for the layout the match
 * was played on. It takes the same rows the list below shows, so the two views can
 * never disagree.
 */

import { useState } from "react";
import { cdnImage } from "../utils/cdn";
import { mapVersionConfig, worldToPercent } from "../utils/matchMap";

// The backdrop plate is 1100 px wide for a 1024 px map, so it overhangs the map art
// evenly on every side. Expressed as a ratio so a replacement pair only needs this
// number checked.
const BACKDROP_RATIO = 1100 / 1024;

// The art is authored almost black (median luminance ~16/255) and sits on an equally
// dark plate, so as drawn the map barely separates from the plate behind it. Inverting
// lifts the drawn pixels to light grey while the plate stays dark; hue-rotate cancels
// the 180 degree hue flip invert() introduces, keeping the artist's tint.
const MAP_ART_FILTER = "invert(1) hue-rotate(180deg) contrast(1.05)";

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
        text: row.text,
      };
    })
    .filter(Boolean);
}

export default function MatchMap({ rows = [], version = null, className = "" }) {
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

  const overhang = (BACKDROP_RATIO - 1) * 50;
  const backdropSize = `${BACKDROP_RATIO * 100}%`;

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative aspect-square w-full max-w-[520px]">
        <img
          src={cdnImage(config.background)}
          alt=""
          aria-hidden="true"
          className="absolute rounded-full"
          style={{
            left: `-${overhang}%`,
            top: `-${overhang}%`,
            width: backdropSize,
            height: backdropSize,
          }}
          onError={() => setFailed(true)}
        />
        <img
          src={cdnImage(config.overlay)}
          alt={`${config.label} minimap`}
          className="absolute inset-0 h-full w-full"
          style={{ filter: MAP_ART_FILTER }}
          onError={() => setFailed(true)}
        />
        {markers.map((marker) => (
          <span
            key={marker.key}
            title={marker.text}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-1 ring-black/70"
            style={{
              left: `${marker.left}%`,
              top: `${marker.top}%`,
              backgroundColor:
                marker.team === 1 ? "var(--color-team-sapphire)" : "var(--color-team-amber)",
            }}
          />
        ))}
      </div>
      <p className="text-xs text-dim">
        {config.label} · {markers.length} death{markers.length === 1 ? "" : "s"} plotted
      </p>
    </div>
  );
}
