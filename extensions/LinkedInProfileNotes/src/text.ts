/**
 * Pure string parsing for whatever LinkedIn happens to render, and for
 * formatting a note's age back to the user. Nothing here touches the DOM, so
 * it is unit tested directly (scripts/selftest.mjs). The DOM-bound half —
 * finding *which* elements hold a profile's name and headline — lives in
 * src/content.ts.
 */

/** Collapses whitespace and caps length without cutting mid-character. */
export function truncateText(raw: string, max = 300): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  return Array.from(collapsed).slice(0, max).join('').trimEnd() + '…';
}

/** Normalizes a LinkedIn profile URL to a stable note id (PRD §4). */
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

/**
 * A loose key for the "does this look like someone already noted under a
 * different URL" fallback match (PRD §7: vanity URL changing over time).
 * Lowercases, strips punctuation and collapses whitespace so small
 * formatting differences ("Jane Doe" vs "Jane  Doe.") still match.
 */
/** U+0300–U+036F, the combining diacritical marks NFKD normalization splits accents into. */
const COMBINING_MARKS = /[̀-ͯ]/g;

export function fuzzyKey(name: string, headline: string): string {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(COMBINING_MARKS, '')
      .replace(/[^\p{L}\p{N}]+/gu, ' ')
      .trim();
  return `${clean(name)}|${clean(headline)}`;
}

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
const MINUTE_MS = 60_000;

/** "3 days ago" / "2 hours ago" / "just now" style relative label for `lastNotedAt` (PRD §4). */
export function formatRelativeTime(at: number, now: number = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) {
    const minutes = Math.round(diff / MINUTE_MS);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  if (diff < DAY_MS) {
    const hours = Math.round(diff / HOUR_MS);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  const days = Math.round(diff / DAY_MS);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}
