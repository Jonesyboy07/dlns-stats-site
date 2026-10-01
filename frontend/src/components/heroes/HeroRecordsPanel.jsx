import React from "react";
import { Link } from "react-router-dom";
import Panel from "../player/Panel";
import { clockDuration } from "../../utils/heroPages";
import { formatInteger as groupInteger } from "../../utils/format";

const ROWS = [
  ["highest_damage", "Highest damage", (value) => groupInteger(value)],
  ["most_kills", "Most kills", (value) => String(value)],
  ["most_healing", "Most healing", (value) => groupInteger(value)],
  ["fastest_win", "Fastest win", (value) => clockDuration(value)],
];

/** Records: the best single games on this hero, each linking to its match. */
function HeroRecordsPanel({ records }) {
  const present = ROWS.filter(([key]) => records?.[key]);

  return (
    <Panel title="Records" subtitle="Best single games on this hero">
      <div className="flex flex-col">
        {present.map(([key, label, format]) => {
          const record = records[key];
          return (
            <div
              key={key}
              className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border py-2.5"
            >
              <span className="text-[12px] uppercase tracking-[.05em] text-dim">{label}</span>
              <Link
                to={`/match/${record.match_id}`}
                className="row-span-2 self-center whitespace-nowrap text-[13px] no-underline"
              >
                #{record.match_id} →
              </Link>
              <span className="min-w-0 truncate text-[14px]">
                <span className="font-valve-oracle text-[18px] font-semibold text-primary">
                  {format(record.value)}
                </span>
                <span className="text-muted"> · {record.persona_name ?? "Unknown"}</span>
              </span>
            </div>
          );
        })}
        {present.length === 0 && <p className="text-[13px] text-dim">Adding Soon</p>}
      </div>
    </Panel>
  );
}

export default HeroRecordsPanel;
