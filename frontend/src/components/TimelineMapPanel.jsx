/**
 * The timeline's map column: the mode control with its collapsible options, an
 * optional fight banner, the map itself, and the caption describing exactly what is
 * on it.
 *
 * The view state lives in the tab (so the feed and the lanes can share the same clock
 * and selection); this panel only renders it and reports changes back. Whether the
 * Options panel is open is purely presentational, so that one piece of state is local.
 */

import { useId, useState } from "react";
import SegmentedControl from "./SegmentedControl";
import TimelineMap from "./TimelineMap";
import Button from "./Button";
import { buildMapView, mapCaption, mapModeOptions, mapOptionsFor, trailCaption } from "../utils/matchTimelineMap";
import { clock } from "../utils/matchTimeline";

const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-secondary-light";

const HEAT_OPTIONS = [
  { value: "team", label: "By team" },
  { value: "single", label: "Single" },
];

const WINDOW_OPTIONS = [
  { value: "all", label: "Whole match" },
  { value: "recent", label: "Last 3 min" },
];

const LINE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "hover", label: "Hover" },
  { value: "all", label: "All" },
];

export default function TimelineMapPanel({
  kills = [],
  t = null,
  durationS = null,
  objectives = [],
  mode = "deaths",
  heatColor = "team",
  range = "all",
  lines = "hover",
  hoveredKillId = null,
  hoveredFight = null,
  selection = [],
  focusedFight = null,
  version = null,
  teamNames = [],
  selectionNames = [],
  playerMarkers = [],
  hasPositions = true,
  heroIcon = null,
  onChange = () => {},
  onHoverKill = null,
  onSeek = null,
  onExitFight = null,
  className = "",
}) {
  const [optionsOpen, setOptionsOpen] = useState(false);
  const optionsId = useId();
  const shownOptions = mapOptionsFor(mode);

  const view = buildMapView({
    kills, t, range, mode, heatColor, lines, hoveredKillId, hoveredFight, selection, focusedFight, durationS,
  });

  const caption = mapCaption({
    shown: view.deaths.length,
    selection,
    names: selectionNames,
    mode,
    heatColor,
    lines,
    focusedFight,
    teamNames,
  });
  // Trails mode shows positions, so a death count would be talking about a layer that
  // is not on the map.
  const shownCaption = mode === "realtime" ? trailCaption(playerMarkers.length) : caption;

  return (
    <div className={`flex flex-col gap-2.5 ${className}`}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <SegmentedControl
          label="Map"
          options={mapModeOptions({ hasPositions })}
          value={mode}
          onChange={(value) => onChange({ mode: value })}
        />
        <button
          type="button"
          aria-expanded={optionsOpen}
          aria-controls={optionsId}
          onClick={() => setOptionsOpen((open) => !open)}
          className={`ml-auto inline-flex h-7 items-center gap-1 rounded-full px-2.5 font-valve-oracle text-xs font-semibold transition-colors ${FOCUS_RING} ${
            optionsOpen ? "bg-hover text-primary" : "text-muted hover:text-primary"
          }`}
        >
          Options
          <span aria-hidden="true" className={`text-[10px] transition-transform ${optionsOpen ? "rotate-180" : ""}`}>
            ▾
          </span>
        </button>
      </div>

      {/* Closed by default: the mode is the decision most people make, the rest is
          fine-tuning. Only the options that do something in this mode are listed. */}
      {optionsOpen && (
        <div
          id={optionsId}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-table/60 px-3 py-2"
        >
          {shownOptions.includes("heat") && (
            <SegmentedControl
              label="Heat"
              options={HEAT_OPTIONS}
              value={heatColor}
              onChange={(value) => onChange({ heatColor: value })}
            />
          )}
          {shownOptions.includes("range") && (
            <SegmentedControl
              label="Range"
              options={WINDOW_OPTIONS}
              value={range}
              onChange={(value) => onChange({ range: value })}
            />
          )}
          {shownOptions.includes("lines") && (
            <SegmentedControl
              label="Kill lines"
              options={LINE_OPTIONS}
              value={lines}
              onChange={(value) => onChange({ lines: value })}
            />
          )}
        </div>
      )}

      {focusedFight && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-accent-border bg-accent-bg px-3 py-2">
          <span className="text-[13px] font-semibold text-primary">
            Fight {focusedFight.index + 1} · {focusedFight.score}
          </span>
          <span className="text-xs text-muted">
            {clock(focusedFight.startS)}–{clock(focusedFight.endS)}
            {focusedFight.winner == null
              ? " · even"
              : ` · ${teamNames[focusedFight.winner] || "winner"} won`}
            {focusedFight.objective ? ` → ${focusedFight.objective.label}` : ""}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            onClick={onExitFight}
            disabled={!onExitFight}
          >
            Exit fight
          </Button>
        </div>
      )}

      <TimelineMap
        view={view}
        version={version}
        t={t}
        objectives={objectives}
        teamNames={teamNames}
        onHoverKill={onHoverKill}
        onSelectKill={onSeek}
        playerMarkers={mode === "realtime" ? playerMarkers : []}
        heroIcon={heroIcon}
        caption={<p className="text-center text-xs text-muted">{shownCaption}</p>}
      />
    </div>
  );
}
