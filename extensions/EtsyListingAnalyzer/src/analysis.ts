/**
 * All the logic that does not need a live DOM: title structure, price
 * formatting, the text-pattern parsers used against scraped page text, tag
 * recurrence, and the compare-table diff. Kept pure and dependency-free so
 * scripts/selftest.mjs can exercise it headlessly — the DOM-bound half
 * (src/extract.ts) only gathers strings and elements and hands them here.
 */

import { PriceAnalysis, TAG_RECURRENCE_MIN_SAMPLE, Teardown, TitleAnalysis } from './types';

/* ── Title ───────────────────────────────────────────────────────────── */

/**
 * "Keyword front-loaded" (PRD §4 example row) means the seller's primary tag
 * shows up in the first ~40 characters of the title — the classic Etsy SEO
 * move. Without at least one tag there is nothing to check against, so the
 * result is `null` (unknown), never a false "no".
 */
export function analyzeTitle(title: string, primaryTag?: string | null): TitleAnalysis {
  const text = (title ?? '').trim();
  const words = text.length ? text.split(/\s+/).filter(Boolean) : [];

  let frontLoaded: boolean | null = null;
  const tag = (primaryTag ?? '').trim();
  if (tag) {
    const tagWords = tag.toLowerCase().split(/\s+/).filter(Boolean);
    const window = text.slice(0, 40).toLowerCase();
    frontLoaded = tagWords.length > 0 && tagWords.every(word => window.includes(word));
  }

  return { text, wordCount: words.length, charCount: text.length, frontLoaded };
}

/* ── Price ───────────────────────────────────────────────────────────── */

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  GBP: '£',
  EUR: '€',
  CAD: 'CA$',
  AUD: 'A$',
  NZD: 'NZ$',
  JPY: '¥',
  INR: '₹',
};

/** Never converts between currencies (PRD §7) — only labels what was printed. */
export function currencyLabel(code: string | null): string {
  if (!code) return '';
  const upper = code.toUpperCase();
  return CURRENCY_SYMBOLS[upper] ?? `${upper} `;
}

export function formatMoney(amount: number, currency: string | null): string {
  return `${currencyLabel(currency)}${amount.toFixed(2)}`;
}

export function formatPriceRange(price: PriceAnalysis): string {
  if (price.min === null || price.max === null) return '—';
  if (price.isRange) return `${formatMoney(price.min, price.currency)}–${formatMoney(price.max, price.currency)}`;
  return formatMoney(price.min, price.currency);
}

/* ── JSON-LD (schema.org Product) ───────────────────────────────────────
 * Etsy listing pages ship structured data for search engines. It is the most
 * layout-resistant source on the page — markup churns, schema.org fields
 * mostly don't — so it is the primary source and DOM scraping is the
 * fallback (PRD §7: Etsy layout changes). */

export interface ParsedProductLd {
  title: string | null;
  photoCount: number | null;
  currency: string | null;
  priceMin: number | null;
  priceMax: number | null;
  soldOut: boolean | null;
  rating: number | null;
  reviewCount: number | null;
  shopName: string | null;
}

const EMPTY_LD: ParsedProductLd = {
  title: null,
  photoCount: null,
  currency: null,
  priceMin: null,
  priceMax: null,
  soldOut: null,
  rating: null,
  reviewCount: null,
  shopName: null,
};

function numOrNull(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : typeof value === 'number' ? value : NaN;
  return Number.isFinite(n) ? n : null;
}

function findProductNode(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (obj['@type'] === 'Product') return obj;
  const graph = obj['@graph'];
  if (Array.isArray(graph)) {
    const hit = graph.find(node => node && typeof node === 'object' && (node as Record<string, unknown>)['@type'] === 'Product');
    if (hit) return hit as Record<string, unknown>;
  }
  return null;
}

export function parseProductLd(raw: unknown): ParsedProductLd {
  const node = findProductNode(raw);
  if (!node) return { ...EMPTY_LD };

  const title = typeof node.name === 'string' ? node.name : null;

  const imageField = node.image;
  const images = Array.isArray(imageField) ? imageField : imageField ? [imageField] : [];
  const photoCount = images.length || null;

  let currency: string | null = null;
  let priceMin: number | null = null;
  let priceMax: number | null = null;
  let soldOut: boolean | null = null;

  const offersField = node.offers;
  const offer = Array.isArray(offersField) ? offersField[0] : offersField;
  if (offer && typeof offer === 'object') {
    const o = offer as Record<string, unknown>;
    currency = typeof o.priceCurrency === 'string' ? o.priceCurrency : null;
    if (o.lowPrice !== undefined || o['@type'] === 'AggregateOffer') {
      priceMin = numOrNull(o.lowPrice);
      priceMax = numOrNull(o.highPrice ?? o.lowPrice);
    } else {
      const single = numOrNull(o.price);
      priceMin = single;
      priceMax = single;
    }
    if (typeof o.availability === 'string') {
      soldOut = /outofstock/i.test(o.availability);
    }
  }

  let rating: number | null = null;
  let reviewCount: number | null = null;
  const aggField = node.aggregateRating;
  if (aggField && typeof aggField === 'object') {
    const agg = aggField as Record<string, unknown>;
    rating = numOrNull(agg.ratingValue);
    reviewCount = numOrNull(agg.reviewCount ?? agg.ratingCount);
  }

  let shopName: string | null = null;
  const brand = node.brand;
  if (brand && typeof brand === 'object') shopName = typeof (brand as any).name === 'string' ? (brand as any).name : null;
  else if (typeof brand === 'string') shopName = brand;
  else if (node.seller && typeof node.seller === 'object') {
    const seller = node.seller as Record<string, unknown>;
    shopName = typeof seller.name === 'string' ? seller.name : null;
  }

  return { title, photoCount, currency, priceMin, priceMax, soldOut, rating, reviewCount, shopName };
}

/* ── Text-pattern parsers ────────────────────────────────────────────────
 * Fallbacks for fields schema.org doesn't carry: shop stats, personalization,
 * free shipping, digital-download status. Each takes plain text scraped from
 * a relevant DOM region (src/extract.ts decides which) and returns null
 * rather than a wrong guess when the pattern isn't found. */

export function findEstablishedYear(text: string): number | null {
  const match = /est(?:ablished)?\.?\s*(?:in\s*)?(\d{4})/i.exec(text ?? '');
  if (!match) return null;
  const year = Number(match[1]);
  return year >= 1990 && year <= new Date().getFullYear() ? year : null;
}

export function findShopTotalSales(text: string): number | null {
  const match = /([\d,]+)\+?\s*sales?\b/i.exec(text ?? '');
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function findListingPurchases(text: string): number | null {
  const match = /([\d,]+)\+?\s*(?:people\s+)?(?:bought this|purchased this|sold)\b/i.exec(text ?? '');
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ''));
  return Number.isFinite(value) ? value : null;
}

export function findShopLocation(text: string): string | null {
  const match = /(?:from|located in|ships from)\s+([A-Za-z][A-Za-z .,'-]{1,40})/i.exec(text ?? '');
  if (!match) return null;
  return match[1].trim().replace(/[.,]+$/, '') || null;
}

export function detectFreeShipping(text: string): boolean {
  return /free\s+(?:standard\s+)?shipping/i.test(text ?? '');
}

export function detectDigital(text: string): boolean {
  return /(digital\s+download|instant\s+download|digital\s+file)/i.test(text ?? '');
}

export function detectPersonalization(text: string): boolean {
  return /personali[sz]e|personali[sz]ation/i.test(text ?? '');
}

export function detectSoldOut(text: string, ldAvailabilitySoldOut: boolean | null): boolean {
  if (ldAvailabilitySoldOut) return true;
  return /sold\s*out|this item is unavailable/i.test(text ?? '');
}

export function detectDeactivated(text: string): boolean {
  return /(this listing has been removed|this shop is on vacation|listing is no longer available)/i.test(text ?? '');
}

export function parseKeywordsMeta(content: string): string[] {
  return (content ?? '')
    .split(',')
    .map(tag => tag.trim())
    .filter(Boolean);
}

/* ── Tag recurrence (PRD §4, floor enforced per PRD §10) ─────────────── */

export interface TagRecurrenceRow {
  tag: string;
  count: number;
  total: number;
  listingIds: string[];
}

/**
 * "5 of 6 competitors use X" is only a finding with enough listings compared.
 * Below the floor this returns null so the UI can say why nothing shows,
 * rather than a misleading 1-of-1 or 2-of-3.
 */
export function tagRecurrence(entries: Array<{ listingId: string; tags: string[] }>): TagRecurrenceRow[] | null {
  if (entries.length < TAG_RECURRENCE_MIN_SAMPLE) return null;

  const byTag = new Map<string, Set<string>>();
  for (const entry of entries) {
    const seen = new Set<string>();
    for (const raw of entry.tags) {
      const tag = raw.trim().toLowerCase();
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      if (!byTag.has(tag)) byTag.set(tag, new Set());
      byTag.get(tag)!.add(entry.listingId);
    }
  }

  return [...byTag.entries()]
    .map(([tag, listingIds]) => ({ tag, count: listingIds.size, total: entries.length, listingIds: [...listingIds] }))
    .filter(row => row.count > 1)
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/* ── Compare table ────────────────────────────────────────────────────
 * One row per field, one value per listing, `differs` flags rows the compare
 * tray should visually highlight (PRD §4: "differences highlighted"). Shared
 * by the panel table, the CSV export and the Markdown audit's comparison
 * section, so all three agree with each other. */

export interface CompareRow {
  key: string;
  label: string;
  values: string[];
  differs: boolean;
}

function displayOrDash(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  return String(value);
}

function boolMark(value: boolean | null): string {
  if (value === null) return '—';
  return value ? '✓' : '✗';
}

export function buildCompareRows(entries: Teardown[]): CompareRow[] {
  const fields: Array<[string, string, (t: Teardown) => string]> = [
    ['title', 'Title', t => t.title.text],
    ['titleWords', 'Title words', t => displayOrDash(t.title.wordCount)],
    ['titleChars', 'Title chars', t => displayOrDash(t.title.charCount)],
    ['titleFrontLoaded', 'Front-loaded', t => boolMark(t.title.frontLoaded)],
    ['tagsUsed', 'Tags used', t => `${t.tags.count} of ${t.tags.max}`],
    ['photos', 'Photos', t => displayOrDash(t.photos.count)],
    ['video', 'Video', t => boolMark(t.photos.hasVideo)],
    ['price', 'Price', t => formatPriceRange(t.price)],
    ['freeShipping', 'Free shipping', t => (t.price.isDigital ? 'n/a (digital)' : boolMark(t.price.freeShipping))],
    ['variations', 'Variations', t => displayOrDash(t.options.variationCount)],
    ['personalization', 'Personalization', t => boolMark(t.options.hasPersonalization)],
    ['purchases', 'Purchases', t => displayOrDash(t.sales.purchases)],
    ['rating', 'Rating', t => (t.sales.rating === null ? '—' : `★${t.sales.rating.toFixed(1)}`)],
    ['reviews', 'Reviews', t => displayOrDash(t.sales.reviewCount)],
    ['shopName', 'Shop', t => displayOrDash(t.shop.name)],
    ['shopEstablished', 'Shop established', t => displayOrDash(t.shop.establishedYear)],
    ['shopSales', 'Shop sales', t => displayOrDash(t.shop.totalSales)],
    ['shopLocation', 'Shop location', t => displayOrDash(t.shop.location)],
  ];

  return fields.map(([key, label, get]) => {
    const values = entries.map(get);
    const differs = new Set(values).size > 1;
    return { key, label, values, differs };
  });
}
