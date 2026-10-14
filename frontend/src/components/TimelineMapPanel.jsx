/**
 * The timeline's map column: the display controls, an optional fight banner, the map
 * itself, and the caption describing exactly what is on it.
 *
 * The view state lives in the tab (so the feed and the lanes can share the same clock
 * and selection); this panel only renders it and reports changes back.
 */

import SegmentedControl from "./SegmentedControl";
import TimelineMap from "./TimelineMap";
import Button from "./Button";
import { buildMapView, mapCaption, trailCaption, MAP_MODE_LABELS, MAP_MODES } from "../utils/matchTimelineMap";
import { clock } from "../utils/matchTimeline";

const MAP_OPTIONS = MAP_MODES.map((value) => ({ value, label: MAP_MODE_LABELS[value] }));

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
  mode = "deaths",
  heatColor = "team",
  range = "all",
  lines = "hover",
  hoveredKillId = null,
  selection = [],
  focusedFight = null,
  version = null,
  teamNames = [],
  selectionNames = [],
  playerMarkers = [],
  heroIcon = null,
  onChange = () => {},
  onHoverKill = null,
  onExitFight = null,
  className = "",
}) {
  const view = buildMapView({
    kills, t, range, mode, heatColor, lines, hoveredKillId, selection, focusedFight, durationS,
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
          options={MAP_OPTIONS}
          value={mode}
          onChange={(value) => onChange({ mode: value })}
        />
        {/* Heat options only mean something while heat is on the map. */}
        {(mode === "heat" || mode === "both") && (
          <SegmentedControl
            label="Heat"
            options={HEAT_OPTIONS}
            value={heatColor}
            onChange={(value) => onChange({ heatColor: value })}
          />
        )}
        <SegmentedControl
          label="Window"
          options={WINDOW_OPTIONS}
          value={range}
          onChange={(value) => onChange({ range: value })}
        />
        <SegmentedControl
          label="Kill lines"
          options={LINE_OPTIONS}
          value={lines}
          onChange={(value) => onChange({ lines: value })}
        />
      </div>

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
        onHoverKill={onHoverKill}
        playerMarkers={mode === "realtime" ? playerMarkers : []}
        heroIcon={heroIcon}
        caption={<p className="text-center text-xs text-dim">{shownCaption}</p>}
      />
    </div>
  );
}
