import React from "react";

/**
 * HomeHero — page title block at the top of the home page.
 *
 * The faint background illustration behind it is the global backdrop rendered
 * in App.jsx (the grayscale gothic image plus the violet glow), so nothing extra
 * is needed here. "Statistics" carries the accent; it is a solid colour, never a
 * gradient.
 */
export default function HomeHero() {
  return (
    <header className="mb-11 flex flex-col gap-3.5">
      <h1 className="max-w-[880px] font-valve-pulp text-[32px] font-bold uppercase leading-[0.95] tracking-[.03em] text-primary sm:text-[40px] lg:text-[48px]">
        Deadlock Night Shift <span className="text-accent-light">Statistics</span>
      </h1>
      <p className="max-w-[640px] text-sm leading-relaxed text-secondary">
        Match data, player performance and series results from the DLNS community
        tournaments.
      </p>
    </header>
  );
}
