/**
 * The map's fixed scenery, painted directly on the art: the three lane ziplines and
 * the objectives (guardians, walkers, Titan, Patron) as of the current clock.
 *
 * Every map sits above this layer -- heat, kill lines, death crosses and player
 * markers are all drawn later in the stack -- so scenery never competes with the
 * thing being replayed. Ziplines are quiet lane-coloured lines; an objective is its
 * icon in front of a team-coloured glow, dimmed and struck through once it has fallen.
 *
 * Objective art is optional: while `mapHud/objectives/<kind>.png` is missing from the
 * image CDN, the marker falls back to a filled team-coloured diamond, so the layer
 * works with or without the files (see `OBJECTIVE_ICONS` in `utils/mapAssets`).
 *
 * Renders nothing for a layout the vendored geometry does not describe (see
 * `mapFurniture` in `utils/mapAssets`).
 */

import { useState } from "react";
import { cdnImage } from "../utils/cdn";
import { clock } from "../utils/matchTimeline";
import { LANE_META } from "../utils/lanes";
import { TEAM_STROKE } from "../utils/matchTimelineMap";
import { OBJECTIVE_ICON_FILL, OBJECTIVE_MARKER_SIZE, objectiveIconPath, objectiveMarkers, ziplinesFor } from "../utils/mapAssets";

/** The tooltip: who owns it, what it is, where, and when it fell -- only once it has. */
function objectiveTitle(marker, teamName) {
  const laneName = marker.lane ? LANE_META[marker.lane]?.name : null;
  const what = [teamName(marker.team), marker.label, laneName ? `(${laneName} lane)` : null]
    .filter(Boolean)
    .join(" ");
  return marker.fallen ? `${what} — fell ${clock(marker.timeS)}` : `${what} — standing`;
}

/**
 * One objective: the tier's glyph in the owner's team colour, at the tier's size, or a
 * hollow team-coloured diamond while the art has not been published. Greyed out and
 * faded once it has fallen.
 *
 * The published art is white, so the PNG is used as a CSS mask and the colour comes
 * from `background-color` -- that is what makes a guardian amber for one side and
 * sapphire for the other. A dark halo keeps the glyph legible over the light map art.
 */
function ObjectiveMarker({ marker, title }) {
  const [artMissing, setArtMissing] = useState(false);
  const color = TEAM_STROKE[marker.team] ?? "#94a3b8";
  const size = OBJECTIVE_MARKER_SIZE[marker.tier] ?? OBJECTIVE_MARKER_SIZE.tier1;
  const fill = OBJECTIVE_ICON_FILL[marker.tier] ?? 1;
  const { fallen } = marker;
  const src = cdnImage(objectiveIconPath(marker.tier));
  // The files pad their glyphs differently; the box is wider so the glyph itself is `size`.
  const box = Math.round(size / fill);
  const halo = "drop-shadow(0 0 1px rgb(0 0 0 / 0.95)) drop-shadow(0 0 1.5px rgb(0 0 0 / 0.75))";

  return (
    <span
      aria-hidden="true"
      title={title}
      className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2"
      style={{
        left: `${marker.left}%`,
        top: `${marker.top}%`,
        width: size,
        height: size,
        zIndex: 1,
      }}
    >
      {/* A hidden probe: masks cannot report a load failure, so the <img> does. */}
      <img src={src} alt="" className="hidden" onError={() => setArtMissing(true)} />
      {artMissing ? (
        <svg
          viewBox="0 0 10 10"
          className="h-full w-full overflow-visible"
          style={{ filter: halo, opacity: fallen ? 0.5 : 1 }}
        >
          <polygon
            points="5,0.7 9.3,5 5,9.3 0.7,5"
            fill="none"
            stroke={fallen ? "var(--color-dim)" : color}
            strokeWidth="1.6"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <span
          style={{
            // Absolutely positioned so the parent's size cannot squeeze the box: as a
            // flex item the width was clamped to `size` and the glyph came out tiny.
            position: "absolute",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            width: box,
            height: box,
            backgroundColor: fallen ? "var(--color-dim)" : color,
            opacity: fallen ? 0.45 : 1,
            filter: halo,
            WebkitMaskImage: `url(${src})`,
            maskImage: `url(${src})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskPosition: "center",
            maskPosition: "center",
          }}
        />
      )}
    </span>
  );
}

export default function MapFurniture({
  version = null,
  objectives = [],
  t = null,
  teamNames = [],
  className = "",
}) {
  const ziplines = ziplinesFor(version);
  const markers = objectiveMarkers({ objectives, t, version });
  if (ziplines.length === 0 && markers.length === 0) return null;

  const teamName = (team) => teamNames[team] || (team === 0 ? "Amber" : "Sapphire");

  return (
    <div aria-hidden="true" className={`pointer-events-none absolute inset-0 ${className}`}>
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        {ziplines.map((zipline) => (
          <g key={zipline.lane}>
            {/* A dark under-stroke separates the line from the art it crosses. */}
            <path
              d={zipline.path}
              fill="none"
              stroke="#000"
              strokeOpacity="0.45"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
            <path
              d={zipline.path}
              fill="none"
              stroke={zipline.color}
              strokeOpacity="0.45"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
            />
          </g>
        ))}
      </svg>
      {markers.map((marker) => (
        <ObjectiveMarker key={marker.id} marker={marker} title={objectiveTitle(marker, teamName)} />
      ))}
    </div>
  );
}
