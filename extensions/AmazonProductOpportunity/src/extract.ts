/**
 * The DOM half. Reads only what is already rendered in the tab — no fetch,
 * no opening other pages, no crawling (PRD §5's gate). Every read is wrapped
 * so one unexpected card (Amazon's frequent A/B tests, PRD §7) can't take the
 * rest of the page down with it; a card that can't be parsed is skipped, not
 * thrown.
 */

import { parseBrandText, parseCountText, parsePriceText, parseRatingText } from './parsing';
import { normalizeHost } from './marketplace';
import { ListingSnapshot, SearchSnapshot } from './types';

const CARD_SELECTOR = 'div[data-component-type="s-search-result"][data-asin]';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function attr(el: Element | null | undefined, name: string): string {
  return (el?.getAttribute(name) ?? '').trim();
}

export function hasSearchResults(root: ParentNode = document): boolean {
  return root.querySelectorAll(CARD_SELECTOR).length > 0;
}

function readSponsored(card: HTMLElement): boolean {
  if (card.closest('[data-component-type="sp-sponsored-result"]')) return true;
  const labelled = card.querySelector('.puis-sponsored-label-text, .s-sponsored-label-text');
  if (labelled) return true;
  const ariaLabelled = Array.from(card.querySelectorAll<HTMLElement>('[aria-label]')).find(el =>
    /sponsored/i.test(attr(el, 'aria-label'))
  );
  return Boolean(ariaLabelled);
}

function readTitle(card: HTMLElement): string {
  const heading = card.querySelector('h2 span, h2 a span, h2');
  if (heading && text(heading)) return text(heading);
  const img = card.querySelector<HTMLImageElement>('img.s-image');
  return img?.alt?.trim() ?? '';
}

function readUrl(card: HTMLElement): string | null {
  const link = card.querySelector<HTMLAnchorElement>('h2 a[href], a.a-link-normal[href*="/dp/"]');
  if (!link) return null;
  try {
    return new URL(link.getAttribute('href') ?? '', location.href).toString();
  } catch {
    return null;
  }
}

function readPrice(card: HTMLElement): { value: number | null; raw: string | null; currency: string | null } {
  const el =
    card.querySelector('.a-price:not(.a-text-price) .a-offscreen') ??
    card.querySelector('.a-price .a-offscreen') ??
    card.querySelector('.a-color-price');
  const raw = text(el) || null;
  const { value, currency } = parsePriceText(raw);
  return { value, raw, currency };
}

function readRating(card: HTMLElement): number | null {
  const el = card.querySelector('[aria-label*="out of 5" i], [aria-label*="von 5" i], .a-icon-alt');
  const source = attr(el, 'aria-label') || text(el);
  return parseRatingText(source);
}

function readReviewCount(card: HTMLElement): number | null {
  const candidates = Array.from(card.querySelectorAll<HTMLElement>('[aria-label]'));
  const match = candidates.find(el => /^[\d.,]+\s*(ratings?|reviews?|bewertung)/i.test(attr(el, 'aria-label')));
  if (match) return parseCountText(attr(match, 'aria-label'));

  const underline = card.querySelector('.s-underline-text, a[href*="#customerReviews"] span');
  if (underline) return parseCountText(text(underline));

  return null;
}

function readPrime(card: HTMLElement): boolean {
  return Boolean(card.querySelector('[aria-label="Amazon Prime" i], i.a-icon-prime, .prime-brand-color'));
}

function readBrand(card: HTMLElement): string | null {
  const candidates = card.querySelectorAll('.a-row.a-size-base.a-color-secondary, .a-size-base-plus.a-color-base');
  for (const el of Array.from(candidates)) {
    const brand = parseBrandText(text(el));
    if (brand) return brand;
  }
  return null;
}

export function extractListings(root: ParentNode = document): ListingSnapshot[] {
  const cards = Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR));
  const seenPositions = new Set<string>();
  const listings: ListingSnapshot[] = [];

  cards.forEach((card, index) => {
    try {
      const asin = attr(card, 'data-asin');
      if (!asin || seenPositions.has(asin)) return; // PRD §7: variations counted once
      seenPositions.add(asin);

      const price = readPrice(card);
      listings.push({
        asin,
        position: index,
        title: readTitle(card),
        brand: readBrand(card),
        price: price.value,
        priceRaw: price.raw,
        currency: price.currency,
        rating: readRating(card),
        reviewCount: readReviewCount(card),
        prime: readPrime(card) ? true : null,
        sponsored: readSponsored(card),
        url: readUrl(card),
      });
    } catch {
      // One bad card must not break the read of the rest of the page.
    }
  });

  return listings;
}

export function readQuery(): string {
  try {
    const fromParam = new URL(location.href).searchParams.get('k');
    if (fromParam?.trim()) return fromParam.trim();
  } catch {
    /* ignore */
  }
  const heading = document.querySelector('.a-section h1, span[data-component-type="s-breadcrumb"]');
  return text(heading) || document.title.trim();
}

export function readPage(): number {
  try {
    const raw = new URL(location.href).searchParams.get('page');
    const value = raw ? Number(raw) : 1;
    return Number.isFinite(value) && value > 0 ? value : 1;
  } catch {
    return 1;
  }
}

export function buildSnapshot(): SearchSnapshot {
  const marketplace = normalizeHost(location.hostname);
  const query = readQuery();
  return {
    marketplace,
    query,
    canonicalKey: `${marketplace}::${query.toLowerCase()}`,
    capturedAt: new Date().toISOString(),
    page: readPage(),
    url: location.href,
    listings: extractListings(document),
  };
}

/** Where to mount the summary strip — right above the results grid. */
export function findResultsAnchor(): Element | null {
  const slot = document.querySelector('.s-main-slot, [data-component-type="s-search-results"]');
  if (slot) return slot;
  const firstCard = document.querySelector(CARD_SELECTOR);
  return firstCard?.parentElement ?? null;
}

export function findCard(asin: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`${CARD_SELECTOR}[data-asin="${CSS.escape(asin)}"]`);
}
