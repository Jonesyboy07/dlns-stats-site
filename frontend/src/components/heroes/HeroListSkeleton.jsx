import React from "react";

/**
 * Heroes list loading state: twelve cards shaped like the real ones (a 3:4
 * portrait block over two text bars), pulsing so the grid does not jump when the
 * data lands.
 */
function HeroListSkeleton({ count = 12 }) {
  return (
    <div
      className="grid gap-3.5"
      style={{ gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))" }}
      aria-hidden="true"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="overflow-hidden rounded-xl border border-border-light bg-card"
        >
          <div className="aspect-[3/4] animate-pulse bg-hover" />
          <div className="flex flex-col gap-2 p-3">
            <div className="h-3 w-[70%] animate-pulse rounded bg-hover" />
            <div className="h-2.5 w-[45%] animate-pulse rounded bg-hover" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default HeroListSkeleton;
