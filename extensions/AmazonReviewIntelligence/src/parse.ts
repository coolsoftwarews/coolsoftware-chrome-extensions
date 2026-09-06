/**
 * Pure text parsing for the bits of an Amazon review that read as plain
 * strings once content.ts has pulled them out of the DOM: star rating
 * text, helpful-vote counts, review dates, and the ASIN in a URL. Kept apart
 * from the DOM traversal itself so it can be unit tested headlessly — the DOM
 * half is covered by the manual checklist in README.md instead, same split as
 * WebHighlighter's quote.ts / anchor.ts.
 */

const MONTHS: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

/** "4.0 out of 5 stars" -> 4. Rounds to the nearest whole star and clamps 1-5. */
export function parseRatingText(text: string): number | null {
  const match = text.match(/([0-5](?:[.,]\d)?)\s*(?:out of|von|sur|su)\s*5/i);
  if (!match) return null;
  const value = parseFloat(match[1].replace(',', '.'));
  if (Number.isNaN(value)) return null;
  return Math.min(5, Math.max(1, Math.round(value)));
}

const WORD_NUMBERS: Record<string, number> = { one: 1, a: 1, an: 1 };

/** "12 people found this helpful" / "One person found this helpful" -> 12 / 1. */
export function parseHelpfulVotes(text: string): number {
  if (!text) return 0;
  const digit = text.match(/([\d,]+)\s*(?:people|person)/i);
  if (digit) return parseInt(digit[1].replace(/,/g, ''), 10) || 0;
  const word = text.trim().toLowerCase().match(/^(\w+)\s*(?:person)/);
  if (word && WORD_NUMBERS[word[1]] !== undefined) return WORD_NUMBERS[word[1]];
  return 0;
}

export interface ParsedDate {
  iso: string | null;
  country: string | null;
}

/**
 * "Reviewed in the United States on January 5, 2024" -> { iso: '2024-01-05',
 * country: 'the United States' }. Only understands English month names — a
 * non-English locale's date still displays fine in the evidence list, it just
 * won't sort or filter by date range (documented in README).
 */
export function parseReviewDate(raw: string): ParsedDate {
  if (!raw) return { iso: null, country: null };

  const countryMatch = raw.match(/Reviewed in ([^\n]+?) on /i);
  const country = countryMatch ? countryMatch[1].replace(/[\u{1F1E6}-\u{1F1FF}]/gu, '').trim() : null;

  const dateMatch = raw.match(/on\s+(.+)$/i);
  const dateText = (dateMatch ? dateMatch[1] : raw).trim();

  // "January 5, 2024"
  let m = dateText.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (m && MONTHS[m[1].toLowerCase()] !== undefined) {
    return { iso: toIso(+m[3], MONTHS[m[1].toLowerCase()], +m[2]), country };
  }
  // "5 January 2024"
  m = dateText.match(/^(\d{1,2})\s+([A-Za-z]+),?\s+(\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()] !== undefined) {
    return { iso: toIso(+m[3], MONTHS[m[2].toLowerCase()], +m[1]), country };
  }

  return { iso: null, country };
}

function toIso(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

/** dp/ASIN, gp/product/ASIN or product-reviews/ASIN, anywhere in a URL. */
export function parseAsin(url: string): string | null {
  const match = url.match(/\/(?:dp|gp\/product|product-reviews)\/([A-Z0-9]{10})(?:[/?]|$)/i);
  return match ? match[1].toUpperCase() : null;
}

/** Stable, non-cryptographic hash — only needs to be a stable dedup key. */
export function hashId(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const MAX_FILENAME_LENGTH = 120;

/** `{asin} - {product title}.{ext}`, sanitized and capped at 120 characters. */
export function buildFilename(productTitle: string, asin: string, ext: string): string {
  const clean = (value: string): string =>
    value
      .replace(/[\\/:*?"<>|]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const suffix = `.${ext}`;
  const stemParts = [clean(asin), clean(productTitle)].filter(Boolean);
  let stem = stemParts.join(' - ') || 'amazon-review-analysis';
  const budget = MAX_FILENAME_LENGTH - suffix.length;
  if (stem.length > budget) stem = stem.slice(0, budget).trimEnd();

  return stem + suffix;
}
