/**
 * Pure text helpers: script detection (for RTL direction and CJK no-space
 * wrapping, PRD S7) and count formatting. No DOM, fully covered by
 * scripts/selftest.mjs.
 *
 * Unicode ranges are written as \u escapes (never literal characters) so
 * this file has no bidi/combining-mark surprises in any editor, terminal or
 * diff tool.
 */

/** Cheap Unicode-range script detection - not a language library, just
 *  enough to answer "should this card read right-to-left" and "does this
 *  text contain runs with no spaces between words by convention" (PRD S7).
 *  Hebrew (U+0591-U+05F4), Arabic + Arabic Supplement (U+0600-U+06FF,
 *  U+0750-U+077F), Arabic Presentation Forms A/B (U+FB50-U+FDFF,
 *  U+FE70-U+FEFF). */
const RTL_RANGE = /[\u0591-\u05F4\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;

/** Hiragana/Katakana (U+3040-U+30FF), CJK Unified Ideographs
 *  (U+4E00-U+9FFF), CJK Compatibility Ideographs (U+F900-U+FAFF),
 *  Hangul Syllables (U+AC00-U+D7A3) - scripts conventionally wrapped at
 *  any character boundary rather than only at whitespace. */
const NO_SPACE_SCRIPT_RANGE = /[\u3040-\u30FF\u4E00-\u9FFF\uF900-\uFAFF\uAC00-\uD7A3]/;

export function detectDirection(text: string): 'ltr' | 'rtl' {
  return RTL_RANGE.test(text) ? 'rtl' : 'ltr';
}

export function hasNoSpaceScript(text: string): boolean {
  return NO_SPACE_SCRIPT_RANGE.test(text);
}

/** Collapses whitespace runs the way a rendered post already has them
 *  (mirrors WebHighlighter/XConversationSaver's cleanText convention). */
export function cleanText(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

/**
 * Formats a raw count the way social products do: 1234 -> "1.2K",
 * 4_500_000 -> "4.5M". Never rounds to a value that reads as more digits
 * than the input actually had (999 stays "999", not "1.0K").
 */
export function formatCount(value: number | null): string {
  if (value === null || !Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 1_000_000) return trimZero(value / 1000) + 'K';
  return trimZero(value / 1_000_000) + 'M';
}

function trimZero(n: number): string {
  const rounded = Math.round(n * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Best-effort short date label from an ISO datetime string, e.g.
 *  "Jan 4, 2026". Falls back to '' rather than throwing on bad input
 *  (PRD S5 - a field the DOM didn't render degrades, it never breaks the
 *  export). Locale is pinned explicitly (see portfolio memory note on
 *  toLocaleString() being unsafe without one). */
export function formatDateLabel(iso: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
