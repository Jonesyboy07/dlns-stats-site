import { describe, expect, it } from "vitest";
import { MAP_RADIUS } from "../utils/matchMap";
import { deathMarkers } from "./MatchMap";

describe("deathMarkers", () => {
  it("plots a death that carries a world position", () => {
    const markers = deathMarkers([
      { key: "death-0", type: "death", team: 0, position: { x: 0, y: 0 }, text: "Kaizen killed by Nemesis" },
    ]);

    expect(markers).toEqual([
      { key: "death-0", left: 50, top: 50, team: 0, text: "Kaizen killed by Nemesis" },
    ]);
  });

  it("drops rows that are not deaths or have no usable position", () => {
    expect(
      deathMarkers([
        { type: "objective", position: null },
        { type: "mid_boss" },
        { type: "death", position: null },
        { type: "death" },
        { type: "death", position: { x: null, y: 10 } },
      ]),
    ).toEqual([]);
    expect(deathMarkers()).toEqual([]);
  });

  it("puts a corner of the playfield at the corner of the image", () => {
    const [marker] = deathMarkers([
      { type: "death", position: { x: -MAP_RADIUS, y: MAP_RADIUS } },
    ]);
    expect(marker).toMatchObject({ left: 0, top: 0 });
  });

  it("keeps the sapphire side distinguishable from amber", () => {
    const markers = deathMarkers([
      { type: "death", team: 1, position: { x: 0, y: 0 } },
      { type: "death", team: 0, position: { x: 0, y: 0 } },
    ]);
    expect(markers.map((marker) => marker.team)).toEqual([1, 0]);
  });
});
