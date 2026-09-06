/**
 * Pure string parsing for whatever LinkedIn happens to render.
 *
 * Nothing here touches the DOM, so it is unit tested directly (scripts/selftest.mjs).
 * The DOM-bound half — finding *which* elements hold this text — lives in
 * src/content.ts and is covered by the manual checklist in README.md, because
 * LinkedIn's markup changes far more often than the way it formats a number.
 */

/**
 * "1,234" → 1234, "1.2K" → 1200, "3.4M" → 3400000, "12" → 12.
 * Returns 0 for anything unparseable rather than throwing — a missing count
 * should never stop a post from being captured (PRD §7).
 */
export function parseCount(raw: string | null | undefined): number {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/,/g, '');
  const match = cleaned.match(/^(\d+(?:\.\d+)?)\s*([KkMm])?$/);
  if (!match) {
    // Last resort: pull the first run of digits out of a noisier string
    // ("1,234 reactions" once commas are stripped it's "1234 reactions").
    const digits = cleaned.match(/\d+(?:\.\d+)?/);
    return digits ? Math.round(parseFloat(digits[0])) : 0;
  }
  const value = parseFloat(match[1]);
  const unit = match[2]?.toLowerCase();
  if (unit === 'k') return Math.round(value * 1_000);
  if (unit === 'm') return Math.round(value * 1_000_000);
  return Math.round(value);
}

/**
 * Scans a block of visible text for engagement counts. LinkedIn's markup for
 * the social-counts bar changes often, but the visible phrasing is stable
 * enough to regex for — "123 reactions", "1.2K comments", "45 reposts" — so
 * this survives more DOM rewrites than a selector chain would (PRD §7).
 */
export function extractCounts(blockText: string): { reactions: number; comments: number; reposts: number } {
  const find = (words: RegExp): number => {
    const match = blockText.match(words);
    return match ? parseCount(match[1]) : 0;
  };
  return {
    reactions: find(/(\d[\d,.]*[KkMm]?)\s*(?:reactions?|likes?)\b/i),
    comments: find(/(\d[\d,.]*[KkMm]?)\s*comments?\b/i),
    reposts: find(/(\d[\d,.]*[KkMm]?)\s*(?:reposts?|shares?)\b/i),
  };
}

const RELATIVE_UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
  w: 7 * 86_400_000,
  mo: 30 * 86_400_000,
  yr: 365 * 86_400_000,
};

/**
 * "2d", "1w •", "Edited • 3mo", "5h" → a timestamp near enough for sorting
 * and for the "gone quiet" check (PRD §7). Returns null for "Just now"-style
 * labels with no parseable unit rather than guessing.
 */
export function parseRelativeTime(raw: string | null | undefined, now: number = Date.now()): number | null {
  if (!raw) return null;
  const match = raw.match(/(\d+)\s*(s|m|h|d|w|mo|yr)\b/i);
  if (!match) return null;
  const amount = parseInt(match[1], 10);
  const unit = match[2].toLowerCase();
  const ms = RELATIVE_UNITS[unit];
  if (!ms || Number.isNaN(amount)) return null;
  return now - amount * ms;
}

/** Collapses whitespace and caps length without cutting mid-character (PRD §7: non-English posts). */
export function truncateText(raw: string, max = 400): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return Array.from(collapsed).slice(0, max).join('').trimEnd() + '…';
}

const FALLBACK_LABELS: Record<Exclude<import('./types').PostType, 'text'>, string> = {
  image: '[Image post — no text]',
  document: '[Document / carousel post — no text]',
  video: '[Video post — no text]',
  poll: '[Poll — no text]',
  article: '[Article post — no text]',
  other: '[Post with no readable text]',
};

/** What to show when a post has no caption at all (PRD §7: docs/carousels/video). */
export function previewFor(text: string, postType: import('./types').PostType): string {
  const trimmed = text.trim();
  if (trimmed) return trimmed;
  if (postType === 'text') return '';
  return FALLBACK_LABELS[postType];
}

/** Normalizes a LinkedIn profile URL to a stable watchlist id. */
export function normalizeProfileUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://www.linkedin.com');
    const match = url.pathname.match(/\/in\/([^/]+)\/?/);
    if (!match) return url.origin + url.pathname.replace(/\/+$/, '');
    return `https://www.linkedin.com/in/${decodeURIComponent(match[1])}`;
  } catch {
    return raw.trim().replace(/\/+$/, '');
  }
}

/** Normalizes a post permalink so the same post is never stored under two URLs. */
export function normalizePostUrl(raw: string): string {
  try {
    const url = new URL(raw, 'https://www.linkedin.com');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.trim();
  }
}
