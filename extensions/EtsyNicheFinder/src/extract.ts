/**
 * Reads listing cards out of the DOM Etsy already rendered. No API, no
 * fetch — this is the entire "where the data comes from" answer in PRD-20 §5.
 *
 * Etsy doesn't publish a stable markup contract, and class names get
 * re-hashed periodically, so every selector here is a best-effort heuristic
 * with a fallback, not a guarantee. When nothing matches, extractListings()
 * returns an empty array and content.ts hides the strip rather than showing
 * wrong numbers (PRD-20 §6: "Failure: strip hides itself; Etsy's page still
 * works"). See README.md's manual QA checklist — this file needs eyes on a
 * live page periodically, the same discipline WebHighlighter's anchor.ts
 * documents for its own DOM-bound half.
 */

import { CountKind, Listing } from './types';

/** Candidate containers for one listing card, most → least specific. */
const CARD_SELECTORS = [
  '[data-listing-id]',
  'li.wt-list-unstyled a[href*="/listing/"]',
  '.v2-listing-card',
];

const AD_TEXT = /\b(ad|ads|advertisement)\s+(by|from)\s+etsy seller\b/i;
const AD_SHORT_TEXT = /^(ad|sponsored)$/i;
const SALES_TEXT = /([\d][\d,.]*)\+?\s*sales\b/i;
const REVIEWS_PAREN = /\(([\d][\d,.]*)\)/;
const STAR_RATING_LABEL = /out of 5/i;
const DIGITAL_TEXT = /\bdigital\s*download\b/i;
const RANGE_TEXT = /(from\s+)?[\d,.]+\s*[–—-]\s*[\d,.]+|^\s*from\s/i;

/** Currency symbol/prefix immediately before a number, or a trailing ISO code. */
const PRICE_PATTERN = /(US\$|CA\$|AU\$|NZ\$|[$£€¥₹])\s?([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)|([\d]{1,3}(?:[.,]\d{3})*(?:[.,]\d{2})?)\s?(USD|EUR|GBP|CAD|AUD)/;

function parsePriceNumber(raw: string): number | null {
  // Normalize "1.234,56" (EU) and "1,234.56" (US) to a plain float.
  const cleaned = raw.replace(/\s/g, '');
  const lastComma = cleaned.lastIndexOf(',');
  const lastDot = cleaned.lastIndexOf('.');
  let normalized = cleaned;
  if (lastComma > lastDot) {
    normalized = cleaned.replace(/\./g, '').replace(',', '.');
  } else {
    normalized = cleaned.replace(/,/g, '');
  }
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : null;
}

function parsePrice(text: string): { price: number | null; currency: string; isRange: boolean } {
  const match = text.match(PRICE_PATTERN);
  if (!match) return { price: null, currency: '', isRange: false };
  const currency = match[1] ?? match[4] ?? '';
  const numberText = match[2] ?? match[3] ?? '';
  return { price: parsePriceNumber(numberText), currency, isRange: RANGE_TEXT.test(text) };
}

function parseCount(text: string): { kind: CountKind; count: number | null } {
  const salesMatch = text.match(SALES_TEXT);
  if (salesMatch) {
    const n = parseInt(salesMatch[1].replace(/[.,]/g, ''), 10);
    return { kind: 'sales', count: Number.isFinite(n) ? n : null };
  }
  if (STAR_RATING_LABEL.test(text)) {
    const parenMatch = text.match(REVIEWS_PAREN);
    if (parenMatch) {
      const n = parseInt(parenMatch[1].replace(/[.,]/g, ''), 10);
      return { kind: 'reviews', count: Number.isFinite(n) ? n : null };
    }
  }
  return { kind: null, count: null };
}

function isAdCard(card: Element): boolean {
  // Etsy marks promoted cards for screen readers with text like
  // "Ad from Etsy seller" / "Ad by Etsy seller" — check short text nodes only
  // so a title that happens to contain the word "ad" is never a false match.
  const shortTextEls = card.querySelectorAll<HTMLElement>('span, p, div');
  for (const el of shortTextEls) {
    const text = (el.textContent ?? '').trim();
    if (text.length > 40) continue;
    if (AD_TEXT.test(text) || AD_SHORT_TEXT.test(text)) return true;
  }
  const href = card.querySelector('a[href*="/listing/"]')?.getAttribute('href') ?? '';
  return /(^|[?&])(is_ad|is_advertised)=1\b/.test(href);
}

function isDigitalCard(card: Element): boolean {
  return DIGITAL_TEXT.test(card.textContent ?? '');
}

function findTitle(card: Element, link: HTMLAnchorElement | null): string {
  const fromAria = link?.getAttribute('aria-label')?.trim();
  if (fromAria) return fromAria;
  const heading = card.querySelector('h3, h2');
  if (heading?.textContent?.trim()) return heading.textContent.trim();
  const fromTitleAttr = link?.getAttribute('title')?.trim();
  if (fromTitleAttr) return fromTitleAttr;
  return '';
}

function findShopName(card: Element, title: string): string {
  const shopLink = card.querySelector<HTMLAnchorElement>('a[href*="/shop/"]');
  if (shopLink?.textContent?.trim()) return shopLink.textContent.trim();

  // Fallback: the shortest short text line on the card that isn't the title,
  // a price, a count, or a rating — usually the shop name line Etsy renders
  // in a caption-styled element under the title.
  const candidates = Array.from(card.querySelectorAll<HTMLElement>('p, span'))
    .map(el => (el.textContent ?? '').trim())
    .filter(text => text && text !== title && text.length <= 40)
    .filter(text => !PRICE_PATTERN.test(text) && !SALES_TEXT.test(text) && !STAR_RATING_LABEL.test(text));
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0] ?? '';
}

function hashString(input: string): string {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 31 + input.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

function listingIdFrom(card: Element, link: HTMLAnchorElement | null, title: string, shop: string): string {
  const attr = card.getAttribute('data-listing-id') || link?.closest('[data-listing-id]')?.getAttribute('data-listing-id');
  if (attr) return attr;
  const href = link?.getAttribute('href') ?? '';
  const fromUrl = href.match(/\/listing\/(\d+)/);
  if (fromUrl) return fromUrl[1];
  return hashString(`${title}|${shop}|${href}`);
}

function dedupeCards(cards: Element[]): Element[] {
  const seen = new Set<Element>();
  const out: Element[] = [];
  for (const card of cards) {
    // A card found via a nested selector (e.g. the anchor itself) should
    // resolve to its closest stable container so we don't double-count.
    const container = card.closest('[data-listing-id]') ?? card.closest('li') ?? card;
    if (seen.has(container)) continue;
    seen.add(container);
    out.push(container);
  }
  return out;
}

export function findListingCards(): Element[] {
  for (const selector of CARD_SELECTORS) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length >= 4) return dedupeCards(found);
  }
  return [];
}

export interface ExtractedCard {
  card: Element;
  listing: Listing;
}

/** One pass over the DOM, pairing each listing with the card it came from so
 * content.ts can paint a badge onto that exact element. */
export function extractListingsWithCards(page: number): ExtractedCard[] {
  const cards = findListingCards();
  const out: ExtractedCard[] = [];

  for (const card of cards) {
    const link = card.matches('a[href*="/listing/"]')
      ? (card as HTMLAnchorElement)
      : card.querySelector<HTMLAnchorElement>('a[href*="/listing/"]');
    if (!link) continue;

    const text = card.textContent ?? '';
    const title = findTitle(card, link);
    if (!title) continue;

    const shopName = findShopName(card, title);
    const { price, currency, isRange } = parsePrice(text);
    const { kind, count } = parseCount(text);

    out.push({
      card,
      listing: {
        id: listingIdFrom(card, link, title, shopName),
        title,
        url: link.href,
        price,
        currency,
        priceIsRange: isRange,
        shopName,
        isAd: isAdCard(card),
        countKind: kind,
        count,
        isDigital: isDigitalCard(card),
        page,
      },
    });
  }

  return out;
}

export function extractListings(page: number): Listing[] {
  return extractListingsWithCards(page).map(x => x.listing);
}
