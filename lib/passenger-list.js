/**
 * Parses a pasted passenger list into names and BI numbers.
 *
 * Agents are handed these lists over WhatsApp, already numbered and formatted
 * by whoever sent them, so the parser accepts the shapes that actually turn up
 * rather than demanding one:
 *
 *   1- Eduardo Nguenda Cussecala - BI: 006050336LA048
 *   2. Julio Tavares Domingos, 006340368LA049
 *   Maria Fineza Nenganga
 *
 * No imports on purpose: keeping this dependency-free is what lets it run in
 * the browser, on the server, and under `node --test` unchanged.
 */

/** Angolan BI: 9 digits, two letters, three digits — e.g. 006050336LA048. */
const BI_PATTERN = /\b(\d{9}[A-Z]{2}\d{3})\b/i;

/**
 * Leading list markers: "1- ", "2. ", "3) ", "- ", "• ". The trailing `|$`
 * matters: a line that is only a marker ("3-") must parse to nothing, not to
 * a passenger named "3".
 */
const LEADING_MARKER = /^\s*(?:[-•*]|\d{1,3}\s*[-.)\]]?)(?:\s+|$)/;

/** A trailing "BI:" / "B.I." label, with or without punctuation around it. */
const BI_LABEL = /[\s,;:–—-]*\bB\.?\s?I\.?\b\s*[:\-–—]?\s*/i;

function tidy(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

/**
 * Splits one line into `{ name, national_id }`.
 * Returns null for a line with nothing usable on it.
 */
export function parsePassengerLine(line) {
  let rest = String(line || '');
  if (!tidy(rest)) return null;

  rest = rest.replace(LEADING_MARKER, '');

  let nationalId = null;
  const found = rest.match(BI_PATTERN);
  if (found) {
    nationalId = found[1].toUpperCase();
    // Drop the number, then the "BI:" label that introduced it, then any
    // separator left dangling at the end ("Name -", "Name,").
    rest = rest.slice(0, found.index) + rest.slice(found.index + found[1].length);
    rest = rest.replace(BI_LABEL, ' ');
  }

  // A "B.I." label leaves its final dot behind (the regex cannot eat it without
  // swallowing the word boundary), so trailing punctuation is cleaned up here.
  const name = tidy(rest).replace(/[\s,;:.–—-]+$/, '').trim();
  if (!name) return null;
  return { name, national_id: nationalId };
}

/**
 * Parses a whole pasted block. Blank lines are skipped; a line that is only a
 * list marker or stray punctuation is dropped rather than becoming a passenger
 * with an empty name.
 */
export function parsePassengerList(text) {
  return String(text || '')
    .split(/\r?\n/)
    .map(parsePassengerLine)
    .filter(Boolean);
}
