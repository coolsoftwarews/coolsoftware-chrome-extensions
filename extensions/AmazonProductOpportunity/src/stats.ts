/**
 * The "category read" (PRD §4): median review count, median rating, distinct
 * brands, and three labelled proxies built only from what the search page
 * already prints. No estimate, no model, no number Amazon didn't show —
 * these are bucket labels over real medians and real counts, which is the
 * line PRD §4's "explicitly out of scope" draws.
 *
 * Pure and DOM-free so scripts/selftest.mjs can assert on it directly.
 */

import { CategoryStats, ListingSnapshot } from './types';

const RATING_GAP_THRESHOLD = 4.3; // PRD §4's own worked example uses this cut.
const RATING_SAMPLE = 10; // "3 of 10 top results" — read the first page fold.

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Organic listings only, deduped by ASIN (PRD §7: variations counted once). */
export function organicListings(listings: ListingSnapshot[]): ListingSnapshot[] {
  const seen = new Set<string>();
  const out: ListingSnapshot[] = [];
  for (const listing of listings) {
    if (listing.sponsored) continue;
    if (seen.has(listing.asin)) continue;
    seen.add(listing.asin);
    out.push(listing);
  }
  return out;
}

function moatLabel(medianReviews: number | null): CategoryStats['moat'] {
  if (medianReviews === null) return 'unknown';
  if (medianReviews < 150) return 'light';
  if (medianReviews < 1500) return 'moderate';
  return 'strong';
}

function ceilingLabel(underThreshold: number, sample: number): CategoryStats['ratingCeiling']['label'] {
  if (sample === 0) return 'unknown';
  const ratio = underThreshold / sample;
  if (ratio === 0) return 'strong';
  if (ratio >= 0.3) return 'soft';
  return 'moderate';
}

function concentrationLabel(topShare: number | null): CategoryStats['concentration']['label'] {
  if (topShare === null) return 'unknown';
  if (topShare >= 0.4) return 'concentrated';
  if (topShare >= 0.2) return 'moderate';
  return 'fragmented';
}

export function computeCategoryStats(listings: ListingSnapshot[]): CategoryStats {
  const organic = organicListings(listings);
  const sponsoredExcluded = listings.filter(l => l.sponsored).length;

  const reviews = organic.map(l => l.reviewCount).filter((n): n is number => n !== null);
  const ratings = organic.map(l => l.rating).filter((n): n is number => n !== null);

  const brands = organic.map(l => l.brand).filter((b): b is string => Boolean(b && b.trim()));
  const brandUnknown = organic.length - brands.length;
  const distinctBrands = new Set(brands.map(b => b.trim().toLowerCase())).size;

  const topSample = organic.slice(0, RATING_SAMPLE).map(l => l.rating).filter((n): n is number => n !== null);
  const underThreshold = topSample.filter(r => r < RATING_GAP_THRESHOLD).length;

  let topBrand: string | null = null;
  let topBrandShare: number | null = null;
  if (brands.length) {
    const counts = new Map<string, { label: string; count: number }>();
    for (const brand of brands) {
      const key = brand.trim().toLowerCase();
      const entry = counts.get(key);
      if (entry) entry.count++;
      else counts.set(key, { label: brand.trim(), count: 1 });
    }
    let best: { label: string; count: number } | null = null;
    for (const entry of counts.values()) {
      if (!best || entry.count > best.count) best = entry;
    }
    if (best) {
      topBrand = best.label;
      topBrandShare = best.count / brands.length;
    }
  }

  const medianReviews = median(reviews);

  return {
    totalListings: organic.length,
    sponsoredExcluded,
    brandUnknown,
    medianReviews,
    medianRating: median(ratings),
    distinctBrands,
    moat: moatLabel(medianReviews),
    ratingCeiling: {
      label: ceilingLabel(underThreshold, topSample.length),
      underThreshold,
      sample: topSample.length,
      threshold: RATING_GAP_THRESHOLD,
    },
    concentration: {
      label: concentrationLabel(topBrandShare),
      topBrand,
      topBrandShare,
    },
  };
}
