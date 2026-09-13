import React from "react";

/**
 * HomeHero — page title block at the top of the home page.
 *
 * The faint background illustration behind it is the global backdrop rendered
 * in App.jsx, so nothing extra is needed here.
 */
export default function HomeHero() {
  return (
    <header className="mb-8">
      <h1 className="font-valve-pulp text-2xl sm:text-3xl lg:text-4xl font-bold uppercase tracking-[.04em] text-primary">
        Deadlock Night Shift Statistics
      </h1>
      <p className="mt-3 max-w-3xl text-sm sm:text-base text-muted leading-relaxed">
        Match data, player performance and series results from the DLNS
        community tournaments.
      </p>
    </header>
  );
}
