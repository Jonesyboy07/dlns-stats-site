import React from "react";
import Panel from "../player/Panel";

/**
 * Records: the best single games on this hero. The aggregates give the value;
 * the owning player and match are not in the API yet, so those read "Adding Soon".
 */
function HeroRecordsPanel({ records = [] }) {
  return (
    <Panel title="Records" subtitle="Best single games on this hero">
      <div className="flex flex-col">
        {records.map((record) => (
          <div
            key={record.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 border-t border-border py-2.5"
          >
            <span className="text-[12px] uppercase tracking-[.05em] text-dim">
              {record.label}
            </span>
            <span className="row-span-2 self-center whitespace-nowrap text-[13px] text-dim">
              Adding Soon
            </span>
            <span className="min-w-0 truncate text-[14px]">
              <span className="font-valve-oracle text-[18px] font-semibold text-primary">
                {record.value}
              </span>
            </span>
          </div>
        ))}
        {records.length === 0 && <p className="text-[13px] text-dim">Adding Soon</p>}
      </div>
    </Panel>
  );
}

export default HeroRecordsPanel;
