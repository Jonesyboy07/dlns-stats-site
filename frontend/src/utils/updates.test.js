import { describe, expect, it } from "vitest";
import { headingText, parseUpdates, splitEntryHeading } from "./updates";

const SAMPLE = `<h1 id="t">DLNS Stats Updates</h1>
<p>Welcome to the updates page!</p>
<h2 id="r">Recent Updates</h2>
<h3 id="a">October 6, 2025 - Discord Auth</h3>
<p>Added in discord auth!</p>
<h2 id="o">Old Updates</h2>
<h3 id="b">October 3, 2025 - HTML &amp; CSS Changes</h3>
<p>User <code>jevd322</code> changed things.</p>
<ul><li>One</li></ul>
<h3 id="p">Plans:</h3>
<ul><li>Items</li></ul>
<h2 id="f">Feedback &amp; Suggestions</h2>
<p>Reach out on <strong>Discord</strong>.</p>
<hr />
<p><em>More soon.</em></p>`;

describe("parseUpdates", () => {
  const parsed = parseUpdates(SAMPLE);

  it("drops the h1 and keeps the intro", () => {
    expect(parsed.intro).toBe("<p>Welcome to the updates page!</p>");
  });

  it("groups h3 entries under their h2 section", () => {
    expect(parsed.sections.map((s) => s.title)).toEqual([
      "Recent Updates",
      "Old Updates",
      "Feedback & Suggestions",
    ]);
    expect(parsed.sections[0].entries).toEqual([
      { date: "October 6, 2025", title: "Discord Auth", html: "<p>Added in discord auth!</p>" },
    ]);
  });

  it("keeps entry bodies, including lists and code", () => {
    const [changes, plans] = parsed.sections[1].entries;
    expect(changes.title).toBe("HTML & CSS Changes");
    expect(changes.html).toContain("<code>jevd322</code>");
    expect(changes.html).toContain("<ul><li>One</li></ul>");
    expect(plans).toMatchObject({ date: "", title: "Plans" });
  });

  it("gives a section without entries its own body, minus rules", () => {
    const feedback = parsed.sections[2];
    expect(feedback.entries).toEqual([]);
    expect(feedback.html).toContain("<strong>Discord</strong>");
    expect(feedback.html).not.toContain("<hr");
  });

  it("handles empty input", () => {
    expect(parseUpdates("")).toEqual({ intro: "", sections: [] });
  });
});

describe("splitEntryHeading", () => {
  it("splits on the first spaced dash", () => {
    expect(splitEntryHeading("September 30, 2025 - Small UI - Changes")).toEqual({
      date: "September 30, 2025",
      title: "Small UI - Changes",
    });
  });
});

describe("headingText", () => {
  it("strips tags and decodes entities", () => {
    expect(headingText("A <em>b</em> &amp; &#39;c&#39;")).toBe("A b & 'c'");
  });
});
