import React from "react";
import { Link } from "react-router-dom";

/**
 * ContributeWidget — sidebar call-to-action pointing at the help/contribute
 * page. This is the home page descendant of the old "recruiting" strip.
 */
export default function ContributeWidget() {
  return (
    <section className="rounded-lg border border-amber-500/20 bg-panel p-4 shadow-panel">
      <h2 className="text-sm font-semibold text-primary">
        Contribute to DLNS Stats
      </h2>
      <p className="mt-1 text-xs text-muted leading-relaxed">
        Devs, designers and data nerds welcome.
      </p>
      <Link
        to="/help"
        className="mt-3 inline-block shrink-0 rounded-full border border-amber-400/20 px-3 py-1 text-xs font-semibold text-amber-300 hover:bg-amber-400/10 hover:text-amber-200 transition-colors"
      >
        Learn more →
      </Link>
    </section>
  );
}
