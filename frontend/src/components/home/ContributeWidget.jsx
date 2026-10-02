import React from "react";
import { Link } from "react-router-dom";

/**
 * ContributeWidget — sidebar call-to-action pointing at the help/contribute
 * page. This is the home page descendant of the old "recruiting" strip.
 */
export default function ContributeWidget() {
  return (
    <section className="rounded-xl border border-accent-border bg-accent-bg-strong p-4">
      <h2 className="text-[15px] font-bold text-primary">
        Contribute to DLNS Stats
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-secondary">
        Devs, designers and data nerds welcome.
      </p>
      <Link
        to="/help"
        className="mt-3 inline-block shrink-0 rounded-full bg-accent px-3.5 py-[5px] text-[12px] font-bold text-[#170a26] transition-opacity hover:opacity-90"
      >
        Learn more →
      </Link>
    </section>
  );
}
