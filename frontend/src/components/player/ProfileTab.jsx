import React from "react";
import DamageProfile from "./DamageProfile";
import DeathProfile from "./DeathProfile";
import ItemsBuild from "./ItemsBuild";
import PersonalBests from "./PersonalBests";
import SoulsProfile from "./SoulsProfile";

/**
 * Profile tab (layout 1a): an auto-fit grid of independent profile panels.
 * Personal Bests spans the full width, everything else fills a 300px-minimum
 * column. The panels that fetch (souls, damage, deaths, items) each own their
 * request, so one dead endpoint leaves the rest of the tab intact; Personal Bests
 * derives from the matches the page already loaded.
 */
export default function ProfileTab({ accountId, matches = [] }) {
  return (
    <div
      className="grid items-start gap-4"
      style={{ gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}
    >
      <div className="col-span-full">
        <PersonalBests matches={matches} />
      </div>

      <SoulsProfile accountId={accountId} />

      <DamageProfile accountId={accountId} />
      <DeathProfile accountId={accountId} />
      <ItemsBuild accountId={accountId} />
    </div>
  );
}
