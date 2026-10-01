import React, { useState } from "react";
import { cdnImage, staticImagePathToCdn } from "../../utils/cdn";
import { heroArtUrl, heroInitials } from "../HeroCard";
import { AddingSoon } from "./PlaceholderPanel";

/** The 132px portrait: the card backer behind the vertical art, dashed fallback. */
function Portrait({ name }) {
  const [failed, setFailed] = useState(false);

  return (
    <div
      className="relative w-[132px] shrink-0 overflow-hidden rounded-lg border border-border bg-table"
      style={{ aspectRatio: "3 / 4" }}
    >
      <img
        src={cdnImage("vertical/card_backer_psd.png")}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full object-cover opacity-30"
      />
      {name && !failed && (
        <img
          src={heroArtUrl(name)}
          alt={name}
          onError={() => setFailed(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      {failed && (
        <span className="absolute inset-0 flex items-center justify-center font-valve-pulp text-[32px] text-dim">
          {heroInitials(name)}
        </span>
      )}
    </div>
  );
}

function AbilityIcon({ ability }) {
  const [failed, setFailed] = useState(false);
  const initials = (ability.name || "")
    .replace(/[^A-Za-z ]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const src = ability.image ? staticImagePathToCdn(ability.image.replace(/\\/g, "/")) : null;

  return (
    <div className="relative h-10 w-10 shrink-0">
      <img
        src={cdnImage("abilities/ability_frame_standard.svg")}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full opacity-60"
      />
      {src && !failed ? (
        <img
          src={src}
          alt=""
          onError={() => setFailed(true)}
          className={`absolute left-1/2 top-1/2 h-2/5 w-2/5 -translate-x-1/2 -translate-y-1/2 object-contain opacity-75 ${
            ability.invert ? "invert" : ""
          }`}
        />
      ) : (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-bold text-muted">
          {initials}
        </span>
      )}
    </div>
  );
}

/**
 * Hero identity: portrait, display-font name, role tags and the ability strip.
 * Ability names and icons come from the hero meta feed; the descriptions are not
 * in the data yet, so each one reads "Adding Soon".
 */
function HeroIdentityCard({ name, tagline = [], abilities = [] }) {
  return (
    <section className="flex flex-wrap gap-6 rounded-xl border border-border-light bg-card px-6 py-5 shadow">
      <Portrait name={name} />

      <div className="flex min-w-0 flex-1 basis-[420px] flex-col gap-3.5">
        <div className="flex flex-col gap-2.5">
          <h1 className="m-0 font-valve-pulp text-[56px] leading-[.95] text-primary">{name}</h1>
          {tagline.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tagline.slice(0, 3).map((tag, index) => (
                <span
                  key={`${tag}-${index}`}
                  className="rounded-full border border-badge-border bg-badge-bg px-2.5 py-1 text-[12px] font-semibold text-secondary"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        <div
          className="grid gap-2"
          style={{ gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
        >
          {abilities.map((ability, index) => (
            <div
              key={`${ability.name}-${index}`}
              className="flex min-w-0 items-start gap-2.5 rounded-lg border border-border bg-table p-2.5"
            >
              <AbilityIcon ability={ability} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="flex min-w-0 items-baseline gap-1.5">
                  <span className="text-[11px] font-bold text-dim">{index + 1}</span>
                  <span
                    title={ability.name}
                    className="truncate text-[14px] font-semibold text-primary"
                  >
                    {ability.name}
                  </span>
                </span>
                <AddingSoon />
              </div>
            </div>
          ))}
          {abilities.length === 0 && (
            <div className="rounded-lg border border-dashed border-border-lighter bg-table p-3">
              <AddingSoon />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default HeroIdentityCard;
