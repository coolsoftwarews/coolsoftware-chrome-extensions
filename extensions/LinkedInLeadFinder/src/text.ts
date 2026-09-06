/**
 * Pure string/number parsing shared by the content script (raw DOM text) and
 * the formatters (CSV/Markdown). No DOM access here — everything is testable
 * with plain strings, which is why it is its own file (mirrors src/url.ts and
 * src/quote.ts in WebHighlighter).
 */

/** Collapses whitespace (including non-breaking spaces) and trims — LinkedIn's markup is full of both. */
export function cleanText(raw: string | null | undefined): string {
  return (raw ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * LinkedIn shows reaction/comment counts as "12", "1,234", "12K" or "3.4K".
 * Returns null rather than 0 when nothing usable was found — a count that
 * could not be read is not the same as a count of zero.
 */
export function parseCount(raw: string | null | undefined): number | null {
  const text = cleanText(raw);
  if (!text) return null;

  const match = /([\d,.]+)\s*([kKmM])?/.exec(text);
  if (!match) return null;

  const digits = match[1].replace(/,/g, '');
  const base = Number.parseFloat(digits);
  if (Number.isNaN(base)) return null;

  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : 1;
  return Math.round(base * multiplier);
}

/**
 * Normalizes a LinkedIn profile or company URL to a stable dedupe key.
 * `/in/johndoe/` and `https://www.linkedin.com/in/JohnDoe?trk=abc` collapse
 * to the same value. Returns null for anything that isn't a profile/company
 * path, so callers can tell "no usable link" from "not a profile at all".
 */
export function normalizeProfileUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw, 'https://www.linkedin.com');
  } catch {
    return null;
  }

  const path = url.pathname.replace(/\/+$/, '').toLowerCase();
  if (!/^\/(in|company)\/[^/]+/.test(path)) return null;

  const segments = path.split('/').filter(Boolean).slice(0, 2);
  return `https://www.linkedin.com/${segments.join('/')}`;
}

/** True when a normalized profile URL points at a company page rather than a person. */
export function isCompanyUrl(normalized: string | null): boolean {
  return normalized !== null && normalized.startsWith('https://www.linkedin.com/company/');
}

/** Truncates for display labels (post grouping, filenames) without cutting mid-word where avoidable. */
export function truncate(text: string, max: number): string {
  const clean = cleanText(text);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.3 ? cut.slice(0, lastSpace) : cut).trimEnd() + '…';
}

/** Best-effort digits pulled out of a label like "34 comments" or "Comments (34)". */
export function extractLeadingNumber(raw: string | null | undefined): number | null {
  const text = cleanText(raw);
  const match = /([\d,.]+)\s*[kKmM]?/.exec(text);
  return match ? parseCount(match[0]) : null;
}
