/**
 * Small pure text helpers shared by the DOM-bound layer (linkedin-dom.ts) and
 * the panel. Kept separate from linkedin-dom.ts so scripts/selftest.mjs can
 * exercise them with plain strings.
 */

/** Collapses runs of horizontal whitespace but preserves the line breaks the
 *  user actually typed — those matter for the truncation estimate. */
export function cleanComposerText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** For labels/snippets where line breaks don't matter — one flattened line. */
export function cleanText(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw.replace(/\s+/g, ' ').trim();
}

/** Best-effort short label for a saved item, used in the panel list. */
export function snippet(text: string, max = 90): string {
  const flat = cleanText(text);
  return flat.length > max ? `${flat.slice(0, max).trimEnd()}…` : flat;
}
