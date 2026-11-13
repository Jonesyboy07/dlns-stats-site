/**
 * Turns the Updates page HTML (rendered server-side from data/update.md) into
 * sections of dated entries:
 *
 *   # Title                -> dropped (the page has its own heading)
 *   intro paragraphs       -> `intro`
 *   ## Section             -> a section
 *   ### Date - Title       -> an entry in the current section
 *   anything else          -> body HTML of the current entry / section
 *
 * Plain string work, no DOM, so it runs in tests and on the server alike.
 */

const HEADING_RE = /<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi;

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'", apos: "'", nbsp: " " };

/** Heading inner HTML -> plain text. */
export function headingText(html) {
  return String(html || "")
    .replace(/<[^>]+>/g, "")
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (whole, name) => {
      const key = name.toLowerCase();
      if (ENTITIES[key] != null) return ENTITIES[key];
      if (key.startsWith("#x")) return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
      if (key.startsWith("#")) return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
      return whole;
    })
    .replace(/\s+/g, " ")
    .trim();
}

/** "October 6, 2025 - Discord Auth" -> { date, title }. No " - " -> no date. */
export function splitEntryHeading(text) {
  const match = /^(.+?)\s+[-–—]\s+(.+)$/.exec(text);
  if (match) return { date: match[1].trim(), title: match[2].trim() };
  return { date: "", title: text.replace(/:\s*$/, "").trim() };
}

/** Drops horizontal rules and blank runs between blocks. */
const tidy = (html) => html.replace(/<hr\s*\/?>/gi, "").trim();

export function parseUpdates(html) {
  const source = String(html || "");
  const result = { intro: "", sections: [] };

  let section = null;
  let entry = null;
  let cursor = 0;

  const appendBody = (chunk) => {
    const body = tidy(chunk);
    if (!body) return;
    if (entry) entry.html += body;
    else if (section) section.html += body;
    else result.intro += body;
  };

  for (const match of source.matchAll(HEADING_RE)) {
    appendBody(source.slice(cursor, match.index));
    cursor = match.index + match[0].length;

    const level = Number(match[1]);
    const text = headingText(match[2]);

    if (level === 1) continue;

    if (level === 2) {
      section = { title: text, html: "", entries: [] };
      entry = null;
      result.sections.push(section);
      continue;
    }

    if (!section) {
      section = { title: "", html: "", entries: [] };
      result.sections.push(section);
    }
    entry = { ...splitEntryHeading(text), html: "" };
    section.entries.push(entry);
  }
  appendBody(source.slice(cursor));

  return result;
}
