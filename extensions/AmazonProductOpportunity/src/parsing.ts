/**
 * Pure text parsing for what a listing card prints. No DOM here on purpose —
 * see scripts/selftest.mjs, which exercises every locale format headlessly.
 * src/extract.ts is the DOM half that hands these functions raw strings.
 */

const CURRENCY_SYMBOLS = ['$', '£', '€', '¥', '₹', '₩', 'R$', 'zł', 'kr'];

export interface ParsedPrice {
  value: number | null;
  currency: string | null;
}

/**
 * Handles both thousands-comma locales ("$1,234.56") and thousands-dot
 * locales ("1.234,56 €") by treating whichever separator is followed by
 * exactly 1–2 digits at the end of the string as the decimal point, and
 * stripping everything else as a thousands separator.
 */
export function parsePriceText(raw: string | null | undefined): ParsedPrice {
  if (!raw) return { value: null, currency: null };
  const currency = CURRENCY_SYMBOLS.find(symbol => raw.includes(symbol)) ?? null;

  // A price range ("$19.99 - $29.99") — read the low end, the honest floor.
  const firstSegment = raw.split(/[-–]/)[0];
  const numeric = firstSegment.replace(/[^0-9.,]/g, '');
  if (!numeric) return { value: null, currency };

  const lastDot = numeric.lastIndexOf('.');
  const lastComma = numeric.lastIndexOf(',');
  const decimalIndex = Math.max(lastDot, lastComma);

  if (decimalIndex === -1) {
    const value = Number(numeric);
    return { value: Number.isFinite(value) ? value : null, currency };
  }

  const fractionLen = numeric.length - decimalIndex - 1;
  const isDecimal = fractionLen === 1 || fractionLen === 2;

  let cleaned: string;
  if (isDecimal) {
    const intPart = numeric.slice(0, decimalIndex).replace(/[.,]/g, '');
    const fracPart = numeric.slice(decimalIndex + 1);
    cleaned = `${intPart || '0'}.${fracPart}`;
  } else {
    cleaned = numeric.replace(/[.,]/g, '');
  }

  const value = Number(cleaned);
  return { value: Number.isFinite(value) ? value : null, currency };
}

/**
 * "4.5 out of 5 stars", "4,5 von 5 Sternen", "4.5 sur 5 étoiles" → 4.5.
 * Falls back to a bare leading number, and rejects anything outside 0–5 so a
 * misread element (e.g. a price) can never masquerade as a rating.
 */
export function parseRatingText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const scoped = raw.match(/(\d+(?:[.,]\d+)?)\s*(?:out of|von|sur|de|su|van)\s*5/i);
  const source = scoped ? scoped[1] : raw.match(/^\s*(\d+(?:[.,]\d+)?)/)?.[1] ?? null;
  if (!source) return null;
  const value = Number(source.replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > 5) return null;
  return Math.round(value * 10) / 10;
}

/** Review/rating counts are always integers, so stripping non-digits is safe across locales. */
export function parseCountText(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const value = Number(digits);
  return Number.isFinite(value) ? value : null;
}

/** "by Acme" / "Marke: Acme" / "Visit the Acme Store" → "Acme". Null when unreadable. */
export function parseBrandText(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const patterns = [
    /^by\s+(.+)$/i,
    /^marke[:\s]+(.+)$/i,
    /^brand[:\s]+(.+)$/i,
    /^visit the\s+(.+?)\s+store$/i,
    /^besuchen sie den\s+(.+?)[- ]shop$/i,
  ];
  for (const pattern of patterns) {
    const match = trimmed.match(pattern);
    if (match?.[1]) return match[1].trim();
  }
  return null;
}

/** `example` → `Example`; used for the tiny "N unreadable" labels in the strip. */
export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}
