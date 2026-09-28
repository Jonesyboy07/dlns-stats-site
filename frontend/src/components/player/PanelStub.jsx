import React from "react";

/**
 * Marks a panel that is designed but not built yet, so a half-finished tab is
 * never mistaken for a finished one. Shared by PlayerDetail and ProfileTab.
 */
export default function PanelStub({ title, note }) {
  return (
    <section className="rounded-xl border border-dashed border-border-lighter px-5 py-8 text-center">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-muted">{title}</h2>
      <p className="mt-1 text-xs text-dim">{note}</p>
    </section>
  );
}
