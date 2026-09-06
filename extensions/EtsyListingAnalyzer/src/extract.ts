/**
 * The DOM-bound half: gathers text and elements from the live listing page
 * and hands them to the pure parsers in src/analysis.ts. This file needs a
 * real browser and is not unit tested directly (same split as WebHighlighter's
 * src/anchor.ts vs src/quote.ts) — verify it against real listings per PRD §5's
 * half-day spike before shipping, and again whenever Etsy visibly redesigns.
 *
 * schema.org JSON-LD is the primary source because it is far less likely to
 * break on a redesign than any hand-picked CSS selector. DOM text scanning
 * fills in what JSON-LD doesn't carry (tags, shop stats, personalization,
 * shipping/digital status). Every field degrades to null/"—" rather than
 * throwing, and misses are recorded in `unavailable` (PRD §7: layout changes).
 */

import {
  analyzeTitle,
  detectDeactivated,
  detectDigital,
  detectFreeShipping,
  detectPersonalization,
  detectSoldOut,
  findEstablishedYear,
  findListingPurchases,
  findShopLocation,
  findShopTotalSales,
  parseKeywordsMeta,
  parseProductLd,
} from './analysis';
import { Teardown } from './types';
import { listingIdFromUrl } from './url';

function readJsonLdProduct(): ReturnType<typeof parseProductLd> {
  const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
  for (const script of scripts) {
    try {
      const parsed = JSON.parse(script.textContent ?? '');
      const product = parseProductLd(parsed);
      if (product.title) return product;
    } catch {
      /* not JSON, or not the Product node — try the next script tag */
    }
  }
  return parseProductLd(null);
}

function textOf(el: Element | null): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Tags are the single load-bearing assumption of the whole product (PRD §5).
 *  Tries a labelled "Tags" section first, then a keywords meta tag, then
 *  gives up cleanly — a listing can legitimately have none shown (PRD §7). */
function extractTags(): string[] {
  const heading = Array.from(document.querySelectorAll('h2, h3, div, span')).find(el =>
    /^tags$/i.test(textOf(el))
  );
  if (heading) {
    const container = heading.closest('div')?.parentElement ?? heading.parentElement;
    const links = Array.from(container?.querySelectorAll('a[href*="search"], a[href*="/c/"], a[href*="/market/"]') ?? []);
    const tags = links.map(a => textOf(a)).filter(Boolean);
    if (tags.length) return dedupe(tags);
  }

  const keywords = document.querySelector('meta[name="keywords"]')?.getAttribute('content');
  if (keywords) return dedupe(parseKeywordsMeta(keywords));

  return [];
}

function dedupe(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(v => {
    const key = v.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function extractPhotoCount(ldCount: number | null): number | null {
  if (ldCount !== null) return ldCount;
  const thumbs = document.querySelectorAll(
    '[data-carousel-pagination-item] img, ul[data-carousel-pagination] img, [data-listing-image] img'
  );
  if (!thumbs.length) return null;
  const srcs = new Set(Array.from(thumbs).map(img => (img as HTMLImageElement).src));
  return srcs.size || null;
}

function extractHasVideo(): boolean {
  if (document.querySelector('video')) return true;
  return Boolean(document.querySelector('[aria-label*="video" i], [data-video-thumbnail], button[aria-label*="play video" i]'));
}

function shippingRegionText(): string {
  const el =
    document.querySelector('[data-shipping-region], [data-buy-box-region] [class*="shipping"], [id*="shipping"]') ??
    document.querySelector('[data-buy-box-region]');
  return textOf(el) || document.body.innerText.slice(0, 20000);
}

function shopPanelText(): string {
  const el = document.querySelector('[data-shop-info], [data-region="shop-info"], a[href*="/shop/"]')?.closest('div') ?? null;
  return textOf(el) || document.body.innerText.slice(0, 20000);
}

function extractVariationCount(): number {
  const selects = document.querySelectorAll('[data-buy-box-variations] select, select[id^="variation-selector"], [data-selector="variations"] select');
  if (selects.length) return selects.length;
  // Fallback: some listings render variations as radio/swatch groups instead of <select>.
  return document.querySelectorAll('[data-buy-box-variations] fieldset, [data-selector="variations"] fieldset').length;
}

function pageText(): string {
  return document.body?.innerText ?? '';
}

export function extractTeardown(): Teardown | null {
  const listingId = listingIdFromUrl(location.href);
  if (!listingId) return null;

  const unavailable: string[] = [];
  const ld = readJsonLdProduct();
  const body = pageText();

  const titleText = ld.title || textOf(document.querySelector('h1')) || document.title.replace(/\s*[-|]\s*Etsy.*$/i, '');
  if (!titleText) unavailable.push('title');

  const tags = extractTags();
  const title = analyzeTitle(titleText, tags[0] ?? null);

  const photoCount = extractPhotoCount(ld.photoCount);
  if (photoCount === null) unavailable.push('photos');

  const shipText = shippingRegionText();
  const isDigital = detectDigital(body) || detectDigital(shipText);
  const freeShipping = !isDigital && detectFreeShipping(shipText);

  const priceMin = ld.priceMin;
  const priceMax = ld.priceMax;
  if (priceMin === null) unavailable.push('price');

  const shopText = shopPanelText();
  const shopName = ld.shopName || textOf(document.querySelector('a[href*="/shop/"]')) || null;
  if (!shopName) unavailable.push('shop name');

  return {
    listingId,
    url: location.href,
    capturedAt: Date.now(),
    title,
    tags: { count: tags.length, max: 13, tags },
    photos: { count: photoCount, hasVideo: extractHasVideo() },
    price: {
      currency: ld.currency,
      min: priceMin,
      max: priceMax,
      isRange: priceMin !== null && priceMax !== null && priceMax > priceMin,
      freeShipping,
      isDigital,
    },
    options: {
      variationCount: extractVariationCount(),
      hasPersonalization: detectPersonalization(body),
    },
    sales: {
      purchases: findListingPurchases(body),
      rating: ld.rating,
      reviewCount: ld.reviewCount,
    },
    shop: {
      name: shopName,
      establishedYear: findEstablishedYear(shopText),
      totalSales: findShopTotalSales(shopText),
      location: findShopLocation(shopText),
    },
    status: {
      soldOut: detectSoldOut(body, ld.soldOut),
      deactivated: detectDeactivated(body),
    },
    unavailable,
  };
}
