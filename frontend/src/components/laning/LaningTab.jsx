/**
 * The laning tab: the opening ten minutes as a playable map, a lane head-to-head and a
 * mirrored build table, all reading one clock and one lane filter.
 *
 * The derivation lives in `utils/laningTab`; this file owns the shared state and the
 * playback loop, and the panels below it only paint what they are handed. The clock is
 * the tab's own -- it runs ten game-seconds per real second and stops at the end of
 * laning, which is why it is not the timeline tab's clock.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import LaningMapCard from "./LaningMapCard";
import LaningPlaybackBar from "./LaningPlaybackBar";
import LaningBuildTable from "./LaningBuildTable";
import { LANING_END_S, soulsAt, statDelta } from "../../utils/laning";
import {
  buildTableRows,
  laneGuardians,
  laneHeadToHead,
  laneHeadToHeadAll,
  laningDeathTally,
  laningDots,
  laningEnded,
  laningFeed,
  laningKillList,
  laningStartTime,
  laningStep,
  laningTicks,
} from "../../utils/laningTab";
import { laneMeta } from "../../utils/lanes";

/** The snapshot-derived numbers the head-to-head and the build table both read. */
const ZERO_STATS = { souls5: null, souls10: null, heroDamage: null, kills: null, deaths: null, assists: null };

export default function LaningTab({
  players = [],
  laneRows = [],
  kills = [],
  objectives = [],
  timeline = null,
  builds = null,
  purchases = [],
  version = null,
  heroIcon = null,
  heroName = () => null,
  teamNames = [],
  unassigned = 0,
  className = "",
}) {
  const [lane, setLane] = useState(null);
  const [time, setTime] = useState(LANING_END_S);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [hoverKillId, setHoverKillId] = useState(null);
  // The loop needs the clock it is starting from; reading it from the render it was
  // created in would restart playback from a stale second.
  const timeRef = useRef(time);
  timeRef.current = time;

  // The clock is anchored to the wall clock rather than accumulated per frame: each
  // frame recomputes the position from the moment playback started, so a coalesced or
  // dropped update cannot make the replay drift behind, and nothing depends on how many
  // frames the browser actually delivers.
  useEffect(() => {
    if (!playing) return undefined;
    const anchor = { wall: performance.now(), game: timeRef.current };
    let frameId = 0;
    const step = (now) => {
      setTime(laningStep(anchor.game, (now - anchor.wall) / 1000, speed));
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frameId);
  }, [playing, speed]);

  // Stop at the end so the transport offers Play again rather than sitting on pause.
  useEffect(() => {
    if (playing && laningEnded(time)) setPlaying(false);
  }, [playing, time]);

  const statsOf = useMemo(() => {
    const cache = new Map();
    return (player) => {
      const accountId = player?.account_id;
      if (cache.has(accountId)) return cache.get(accountId);
      const snapshots = timeline?.players?.[String(accountId)]?.snapshots || [];
      const stats = snapshots.length
        ? {
            souls5: soulsAt(snapshots, 300),
            souls10: soulsAt(snapshots, LANING_END_S),
            heroDamage: statDelta(snapshots, LANING_END_S, "player_damage"),
            kills: statDelta(snapshots, LANING_END_S, "kills"),
            deaths: statDelta(snapshots, LANING_END_S, "deaths"),
            assists: statDelta(snapshots, LANING_END_S, "assists"),
          }
        : ZERO_STATS;
      cache.set(accountId, stats);
      return stats;
    };
  }, [timeline]);

  const buildsFor = useMemo(() => (player) => builds?.[String(player?.account_id)] ?? null, [builds]);

  // The window's kills, resolved to their killer, their victim and the victim's lane.
  const killList = useMemo(() => laningKillList(kills, players), [kills, players]);

  const selectedLane = lane === null ? null : laneRows.find((row) => row.lane === lane) ?? null;
  const laneName = laneMeta(lane)?.name ?? null;

  const headToHead = useMemo(() => {
    if (lane === null) {
      const all = laneHeadToHeadAll(laneRows, statsOf);
      return { title: "Souls @10:00 by lane", lead: all.lead, rows: all.rows, players: { left: [], right: [] } };
    }
    if (!selectedLane) {
      return { title: "—", lead: null, rows: [], players: { left: [], right: [] } };
    }
    const lanePlayers = [...selectedLane.left, ...selectedLane.right];
    const h2h = laneHeadToHead(lanePlayers, statsOf);
    const guardians = laneGuardians(objectives, lane);
    return {
      title: `${laneName} · 2v2`,
      lead: h2h.lead,
      players: h2h.players,
      // The guardian row has no bar: it is a moment, and it reads the same whatever the
      // clock says, so the reader can see how the lane was actually won.
      rows: [
        ...h2h.rows,
        { key: "guardians", label: "T1 guardian", kind: "guardian", left: guardians.amber, right: guardians.sapphire },
      ],
    };
  }, [lane, laneRows, laneName, objectives, selectedLane, statsOf]);

  const dots = useMemo(
    () => laningDots(killList, { lane, time, hoverKillId }),
    [killList, lane, time, hoverKillId],
  );
  const feed = useMemo(
    () => laningFeed(killList, { lane, time, hoverKillId }),
    [killList, lane, time, hoverKillId],
  );
  const tally = useMemo(() => laningDeathTally(killList, { lane, time }), [killList, lane, time]);
  const ticks = useMemo(() => laningTicks(killList, { lane }), [killList, lane]);
  const buildRows = useMemo(
    () => buildTableRows({ laneRows, lane, valuesOf: statsOf, buildsFor, purchases, time }),
    [laneRows, lane, statsOf, buildsFor, purchases, time],
  );

  const changeLane = (next) => {
    setLane(next);
    setHoverKillId(null);
  };

  const togglePlay = () => {
    if (playing) {
      setPlaying(false);
      return;
    }
    // Playing at the end of the window starts it over. Both setters are called from the
    // handler rather than from inside an updater: a state updater has to stay pure, and
    // React is free to run it more than once.
    setTime((at) => laningStartTime(at));
    setPlaying(true);
  };

  return (
    <div className={`mb-6 flex flex-col gap-3 ${className}`}>
      <LaningMapCard
        dots={dots}
        tally={tally}
        time={time}
        endS={LANING_END_S}
        lane={lane}
        laneName={laneName}
        onLaneChange={changeLane}
        headToHead={headToHead}
        feed={feed}
        hoverKillId={hoverKillId}
        onHoverKill={setHoverKillId}
        version={version}
        heroIcon={heroIcon}
        heroName={heroName}
        teamNames={teamNames}
      />
      <LaningPlaybackBar
        time={time}
        endS={LANING_END_S}
        playing={playing}
        speed={speed}
        ticks={ticks}
        onTogglePlay={togglePlay}
        onSeek={(next) => {
          setTime(next);
          setPlaying(false);
        }}
        onSpeed={setSpeed}
      />
      <LaningBuildTable
        rows={buildRows}
        time={time}
        teamNames={teamNames}
        heroIcon={heroIcon}
        heroName={heroName}
      />
      {unassigned > 0 && (
        <p className="text-[11px] text-dim">
          {unassigned} player{unassigned === 1 ? "" : "s"} had no recorded lane, so{" "}
          {unassigned === 1 ? "is" : "are"} not shown.
        </p>
      )}
    </div>
  );
}
