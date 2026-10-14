/**
 * The timeline's map: the minimap with the match's deaths on it.
 *
 * Four layers, painted in order: the map art, a heat canvas blended over it, the
 * killer-to-victim lines, and a cross per death. Everything about *what* to draw comes
 * from `buildMapView` in `utils/matchTimelineMap`, so this file is only the painting --
 * the same separation `MatchMap` uses, and what keeps the rules testable.
 *
 * Positions are world units, converted by the shared `worldToPixels` transform, so
 * this map and `MatchMap` can never place the same death differently.
 */

import { useEffect, useRef, useState } from "react";
import { cdnImage } from "../utils/cdn";
import {
  BACKDROP_RATIO,
  MAP_ART_FILTER,
  mapVersionConfig,
} from "../utils/matchMap";
import {
  HEAT_RADIUS,
  KILLER_RING_SIZE,
  KILL_LINE_WIDTH,
  MAP_SIZE,
  TEAM_STROKE,
  mapPoint,
} from "../utils/matchTimelineMap";

const pct = (pixels) => `${(pixels / MAP_SIZE) * 100}%`;

/** The background the crosses sit on, reused so a hollow cross leaves a hollow middle. */
const MAP_INK = "#0b0b12";
/** The cross's own coordinate space; the marker's box scales it. */
const CROSS_UNITS = 10;
const CROSS_STROKE = 2;
/** A hollow cross: the team colour stroked wide, the background stroked narrow over it. */
const CROSS_HOLLOW_STROKE = 3.8;
const CROSS_HOLLOW_INNER = 1.5;

/**
 * One death, drawn as a cross. A circle read as "a spot on the map"; an X reads as
 * "someone died here", and it stays legible over the heat layer at the same size.
 *
 * A highlighted player's own death is hollow, so their deaths and the kills they made
 * read differently at a glance. The old dot emptied its middle; a cross cannot, so the
 * outline is built by stroking the team colour wide and the background narrow on top.
 */
function DeathCross({ dot, onHover }) {
  const color = TEAM_STROKE[dot.team] ?? "#94a3b8";
  const cross = (width, strokeColor) => (
    <g stroke={strokeColor} strokeWidth={width} strokeLinecap="round" fill="none">
      <line x1="1" y1="1" x2="9" y2="9" />
      <line x1="9" y1="1" x2="1" y2="9" />
    </g>
  );
  return (
    <span
      aria-hidden="true"
      onMouseEnter={onHover ? () => onHover(dot.killId) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      className="absolute -translate-x-1/2 -translate-y-1/2 rounded-full transition-[width,height,opacity] duration-200 motion-reduce:transition-none"
      style={{
        left: pct(dot.x),
        top: pct(dot.y),
        width: dot.size,
        height: dot.size,
        opacity: dot.opacity,
        boxShadow: dot.fresh ? "0 0 0 4px oklch(68.88% 0.187 300 / 0.35)" : "none",
      }}
    >
      <svg viewBox={`0 0 ${CROSS_UNITS} ${CROSS_UNITS}`} className="h-full w-full">
        {dot.hollow ? (
          <>
            {cross(CROSS_HOLLOW_STROKE, color)}
            {cross(CROSS_HOLLOW_INNER, MAP_INK)}
          </>
        ) : (
          cross(CROSS_STROKE, color)
        )}
      </svg>
    </span>
  );
}

export default function TimelineMap({
  view,
  version = null,
  onHoverKill = null,
  playerMarkers = [],
  heroIcon = null,
  caption = null,
  className = "",
}) {
  const [failed, setFailed] = useState(false);
  const heatRef = useRef(null);
  const config = mapVersionConfig(version);
  const heat = view?.heat ?? [];

  // Redrawn whenever the groups change: one offscreen pass per colour, flattened into
  // that colour with `source-in`, so overlapping deaths blend into a single stroke
  // rather than stacking into a darker blob.
  useEffect(() => {
    const canvas = heatRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, MAP_SIZE, MAP_SIZE);

    for (const group of heat) {
      const layer = document.createElement("canvas");
      layer.width = MAP_SIZE;
      layer.height = MAP_SIZE;
      const layerCtx = layer.getContext("2d");

      for (const kill of group.deaths) {
        const point = mapPoint(kill.position);
        if (!point) continue;
        const gradient = layerCtx.createRadialGradient(
          point.x, point.y, 0, point.x, point.y, HEAT_RADIUS,
        );
        gradient.addColorStop(0, "rgba(0,0,0,0.42)");
        gradient.addColorStop(1, "rgba(0,0,0,0)");
        layerCtx.fillStyle = gradient;
        layerCtx.beginPath();
        layerCtx.arc(point.x, point.y, HEAT_RADIUS, 0, Math.PI * 2);
        layerCtx.fill();
      }

      layerCtx.globalCompositeOperation = "source-in";
      layerCtx.fillStyle = group.color;
      layerCtx.fillRect(0, 0, MAP_SIZE, MAP_SIZE);

      ctx.globalAlpha = 0.95;
      ctx.drawImage(layer, 0, 0);
    }
    ctx.globalAlpha = 1;
  }, [heat]);

  if (failed) {
    return (
      <p className={`text-sm text-dim ${className}`}>
        The {config.label} map image could not be loaded.
      </p>
    );
  }

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div className="relative aspect-square w-full max-w-[520px] overflow-hidden rounded-full bg-black">
        <img
          src={cdnImage(config.background)}
          alt=""
          aria-hidden="true"
          className="absolute inset-0 h-full w-full max-w-none"
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

        <canvas
          ref={heatRef}
          width={MAP_SIZE}
          height={MAP_SIZE}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full mix-blend-screen"
        />

        <svg
          viewBox={`0 0 ${MAP_SIZE} ${MAP_SIZE}`}
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          {(view?.lines ?? []).map((line) => (
            <g key={line.killId} opacity={line.opacity}>
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={line.color}
                strokeWidth={KILL_LINE_WIDTH}
                strokeLinecap="round"
              />
              {/* The killer's end: a ring, since the dot marks the death. */}
              <circle
                cx={line.x1}
                cy={line.y1}
                r={KILLER_RING_SIZE / 2}
                fill="none"
                stroke={line.color}
                strokeWidth={KILL_LINE_WIDTH}
              />
            </g>
          ))}
        </svg>

        {(view?.dots ?? []).map((entry) => (
          <DeathCross key={entry.kill.id} dot={entry.dot} onHover={onHoverKill} />
        ))}

        {/* Realtime mode: where each player actually is, rather than where they died. */}
        {playerMarkers.map((marker) => {
          const color = TEAM_STROKE[marker.team] ?? "#94a3b8";
          return (
            <span
              key={marker.key}
              title={
                marker.dead ? `${marker.name} (respawns in ~${marker.respawnIn}s)` : marker.name
              }
              className="absolute -translate-x-1/2 -translate-y-1/2 transition-[left,top] duration-200 motion-reduce:transition-none"
              style={{ left: `${marker.left}%`, top: `${marker.top}%`, zIndex: marker.dead ? 2 : 3 }}
            >
              <span
                className="relative block h-[26px] w-[26px] overflow-hidden rounded-full"
                style={{
                  boxShadow: `0 0 0 2.5px ${
                    marker.dead ? "rgb(255 255 255 / 0.35)" : color
                  }, 0 0 0 4px rgb(0 0 0 / 0.75)${marker.dead ? "" : `, 0 0 10px ${color}`}`,
                  backgroundColor: color,
                  opacity: marker.dead ? 0.7 : 1,
                }}
              >
                {heroIcon && marker.heroId ? (
                  <img
                    src={heroIcon(marker.heroId)}
                    alt=""
                    draggable={false}
                    className="h-full w-full max-w-none object-cover"
                    style={marker.dead ? { filter: "grayscale(1) brightness(0.6)" } : undefined}
                  />
                ) : null}
                {marker.dead && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/40 text-[10px] font-bold tabular-nums text-white">
                    {marker.respawnIn}
                  </span>
                )}
              </span>
            </span>
          );
        })}
      </div>

      {caption !== null ? (
        caption
      ) : (
        <p className="text-xs text-dim">
          {config.label} · {view?.deaths?.length ?? 0} death
          {(view?.deaths?.length ?? 0) === 1 ? "" : "s"} shown
        </p>
      )}
    </div>
  );
}
