/**
 * Parsers for the strings YouTube puts in the comment DOM. Every one returns
 * null rather than throwing or guessing — a null propagates into "field not
 * shown" for that one comment, never a broken comment or a broken panel
 * (PRD §5's degrade-field-by-field rule).
 */

const MULTIPLIERS: Record<string, number> = {
  k: 1e3,
  m: 1e6,
  b: 1e9,
};

/** "1.2K" → 1200, "1,234" → 1234, "" → null. Comments with 0 likes render no badge at all. */
export function parseCompactNumber(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/([\d.,]+)\s*([kmb])?/);
  if (!match) return null;

  const digits = match[1];
  const suffix = match[2];
  const numeric = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  return suffix ? Math.round(numeric * MULTIPLIERS[suffix]) : Math.round(numeric);
}

/** "12 replies" / "1 reply" / "View 3 replies" → 12 / 1 / 3. */
export function parseReplyCount(input: string | null | undefined): number | null {
  if (!input) return null;
  const match = input.trim().toLowerCase().match(/(\d[\d,]*)\s*repl(?:y|ies)/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

const UNIT_MS: Record<string, number> = {
  second: 1000,
  minute: 60 * 1000,
  hour: 60 * 60 * 1000,
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
  year: 365 * 24 * 60 * 60 * 1000,
};

/**
 * "3 days ago" / "3 days ago (edited)" / "Streamed 2 weeks ago" → epoch ms.
 * Deliberately coarse (months = 30 days, years = 365) — good enough to order
 * "newest first" without claiming an exact timestamp YouTube never exposes.
 */
export function parseRelativeDate(input: string | null | undefined, now = Date.now()): number | null {
  if (!input) return null;
  const match = input
    .trim()
    .toLowerCase()
    .match(/(\d+)\s+(second|minute|hour|day|week|month|year)s?\s+ago/);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2]];
  if (!Number.isFinite(amount) || !unit) return null;

  return now - amount * unit;
}

/** Collapses YouTube's own soft line breaks / repeated whitespace without eating intentional newlines. */
export function normalizeWhitespace(input: string): string {
  return input.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}

/** Pulls an 11-character video id out of any /watch or youtu.be style URL. */
export function parseVideoId(href: string | null | undefined): string | null {
  if (!href) return null;
  const watch = href.match(/[?&]v=([\w-]{11})/);
  if (watch) return watch[1];
  const short = href.match(/youtu\.be\/([\w-]{11})/);
  if (short) return short[1];
  const shorts = href.match(/\/shorts\/([\w-]{11})/);
  if (shorts) return shorts[1];
  return null;
}
