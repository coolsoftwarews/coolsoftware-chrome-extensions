/**
 * The niche-scoring engine. Deliberately pure — no DOM, no chrome.* — so
 * scripts/selftest.mjs can check every calculation headlessly. This is the
 * one file where getting it wrong is worse than not shipping: PRD-20 §5 is
 * explicit that mixing sales and review counts, or letting ads inflate
 * concentration, "invalidates the median" and "makes every niche look more
 * contested than it is".
 */

import { Filters, Listing, NicheStats, ShopShare, SnapshotDelta, TagCount, TagTable } from './types';

/* ── Basic statistics ────────────────────────────────────────────────── */

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Linear-interpolation percentile (the usual "middle 50%" definition). */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  const frac = idx - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * frac;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = '';
  let bestCount = -1;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

/* ── Niche stats ─────────────────────────────────────────────────────── */

export function computeStats(listings: Listing[], query: string, queryKey: string, samplePages: number): NicheStats {
  const organic = listings.filter(l => !l.isAd);
  const ads = listings.filter(l => l.isAd);

  // Shop concentration: PRD-20 §5 — ads must not count, or "every niche looks
  // more contested than it is".
  const shopCounts = new Map<string, number>();
  for (const l of organic) {
    if (!l.shopName) continue;
    shopCounts.set(l.shopName, (shopCounts.get(l.shopName) ?? 0) + 1);
  }
  const topShops: ShopShare[] = [...shopCounts.entries()]
    .map(([shop, count]): ShopShare => ({ shop, count, pct: organic.length ? (count / organic.length) * 100 : 0 }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  const top3Pct = organic.length ? topShops.reduce((sum, s) => sum + s.count, 0) / organic.length * 100 : null;

  // Sales-vs-reviews: PRD-20 §5 — label which one is showing, never blend them.
  const salesListings = organic.filter(l => l.countKind === 'sales' && l.count !== null);
  const reviewListings = organic.filter(l => l.countKind === 'reviews' && l.count !== null);
  const mixedCountKinds = salesListings.length > 0 && reviewListings.length > 0;
  const predominant: 'sales' | 'reviews' | null =
    salesListings.length === 0 && reviewListings.length === 0
      ? null
      : salesListings.length >= reviewListings.length
        ? 'sales'
        : 'reviews';
  const countPool = predominant === 'sales' ? salesListings : predominant === 'reviews' ? reviewListings : [];
  const medianCount = median(countPool.map(l => l.count as number));
  const zeroCountListings = countPool.filter(l => l.count === 0).length;

  // Price band, currency: PRD-20 §7 — state the currency, note a range/variable price.
  const priced = organic.filter(l => l.price !== null);
  const prices = priced.map(l => l.price as number);
  const currencies = priced.map(l => l.currency).filter(Boolean);
  const currency = currencies.length ? mostCommon(currencies) : '';
  const currencyMixed = new Set(currencies).size > 1;
  const variablePriceListings = organic.filter(l => l.priceIsRange).length;

  const digitalListings = organic.filter(l => l.isDigital).length;
  const physicalListings = organic.length - digitalListings;

  return {
    query,
    queryKey,
    generatedAt: Date.now(),
    sampleListings: listings.length,
    organicListings: organic.length,
    adListings: ads.length,
    samplePages,
    distinctShops: shopCounts.size,
    topShops,
    top3Pct,
    medianCountKind: predominant,
    medianCount,
    mixedCountKinds,
    zeroCountListings,
    currency,
    currencyMixed,
    medianPrice: median(prices),
    priceBandLow: percentile(prices, 25),
    priceBandHigh: percentile(prices, 75),
    variablePriceListings,
    digitalListings,
    physicalListings,
  };
}

/* ── Tag table ───────────────────────────────────────────────────────── */

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'your', 'this', 'that', 'from', 'you', 'are',
  'our', 'all', 'can', 'has', 'have', 'not', 'but', 'was', 'set', 'new',
  'personalized', 'custom', 'gift', 'gifts', 'her', 'him', 'his', 'she', 'their',
  'one', 'two', 'more', 'best', 'perfect', 'unique', 'handmade', 'made',
  'free', 'shipping', 'size', 'small', 'large', 'inch', 'inches', 'cm', 'mm',
]);

/** Aggregates the words appearing in the titles of the top organic listings (PRD-20 §4). */
export function aggregateTags(listings: Listing[], sampleCap = 60): TagTable {
  const organic = listings.filter(l => !l.isAd && l.title);
  const sample = organic.slice(0, sampleCap);

  const counts = new Map<string, number>();
  for (const listing of sample) {
    const words = listing.title
      .toLowerCase()
      .split(/[^a-z0-9']+/)
      .map(w => w.replace(/^'+|'+$/g, ''))
      .filter(w => w.length >= 3 && !STOPWORDS.has(w) && !/^\d+$/.test(w));
    // Count each word once per title — a repeated word in one title shouldn't
    // outweigh the same word appearing across many titles.
    for (const word of new Set(words)) {
      counts.set(word, (counts.get(word) ?? 0) + 1);
    }
  }

  const tags: TagCount[] = [...counts.entries()]
    .map(([tag, count]): TagCount => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, 30);

  return { tags, sampleSize: sample.length };
}

/* ── Filters ─────────────────────────────────────────────────────────── */

export function applyFilters(listings: Listing[], filters: Filters): Listing[] {
  return listings.filter(listing => {
    if (filters.organicOnly && listing.isAd) return false;
    if (filters.maxSales !== null) {
      // Only comparable when the card is actually showing a sales count — a
      // review-count card silently passes rather than being wrongly excluded.
      if (listing.countKind === 'sales' && listing.count !== null && listing.count > filters.maxSales) return false;
    }
    if (filters.minPrice !== null && (listing.price === null || listing.price < filters.minPrice)) return false;
    if (filters.maxPrice !== null && (listing.price === null || listing.price > filters.maxPrice)) return false;
    if (filters.shop && listing.shopName !== filters.shop) return false;
    return true;
  });
}

/* ── Snapshot delta ──────────────────────────────────────────────────── */

const DAY_MS = 24 * 60 * 60 * 1000;

export function computeDelta(previous: NicheStats, current: NicheStats): SnapshotDelta {
  const countKindChanged =
    previous.medianCountKind !== null &&
    current.medianCountKind !== null &&
    previous.medianCountKind !== current.medianCountKind;

  return {
    daysSince: Math.max(0, Math.round((current.generatedAt - previous.generatedAt) / DAY_MS)),
    medianCountDelta:
      !countKindChanged && previous.medianCount !== null && current.medianCount !== null
        ? current.medianCount - previous.medianCount
        : null,
    medianPriceDelta:
      previous.medianPrice !== null && current.medianPrice !== null
        ? Math.round((current.medianPrice - previous.medianPrice) * 100) / 100
        : null,
    top3PctDelta:
      previous.top3Pct !== null && current.top3Pct !== null
        ? Math.round((current.top3Pct - previous.top3Pct) * 10) / 10
        : null,
    countKindChanged,
  };
}

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** "median sales +40 since 12 Aug" — the one-line delta PRD-20 §4 asks for. */
export function describeDelta(delta: SnapshotDelta, previousSavedAt: number, countKind: NicheStats['medianCountKind']): string {
  const since = `since ${formatDate(previousSavedAt)}`;
  if (delta.countKindChanged) return `Etsy switched between sales and reviews on this page — delta not comparable ${since}.`;
  const parts: string[] = [];
  if (delta.medianCountDelta !== null && countKind) parts.push(`median ${countKind} ${signed(delta.medianCountDelta)}`);
  if (delta.medianPriceDelta !== null) parts.push(`median price ${signed(delta.medianPriceDelta)}`);
  if (delta.top3PctDelta !== null) parts.push(`top-3 share ${signed(delta.top3PctDelta)}pp`);
  if (!parts.length) return `No comparable change ${since}.`;
  return `${parts.join(' · ')} ${since}`;
}
