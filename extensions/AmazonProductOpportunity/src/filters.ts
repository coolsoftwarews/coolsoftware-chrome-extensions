/**
 * Filters narrow which per-result badges are highlighted; they never change
 * the category read (that stays a read of the whole page — PRD §4). Pure so
 * scripts/selftest.mjs can assert on it directly.
 */

import { FilteredListing, FilterState, ListingSnapshot } from './types';

export function isEmptyFilter(filters: FilterState): boolean {
  return (
    filters.maxReviews === null &&
    filters.minRatingGap === null &&
    filters.priceMin === null &&
    filters.priceMax === null &&
    (!filters.brand || !filters.brand.trim())
  );
}

function matchesFilter(listing: ListingSnapshot, filters: FilterState): boolean {
  if (filters.maxReviews !== null) {
    if (listing.reviewCount === null || listing.reviewCount > filters.maxReviews) return false;
  }
  if (filters.minRatingGap !== null) {
    if (listing.rating === null || listing.rating >= filters.minRatingGap) return false;
  }
  if (filters.priceMin !== null) {
    if (listing.price === null || listing.price < filters.priceMin) return false;
  }
  if (filters.priceMax !== null) {
    if (listing.price === null || listing.price > filters.priceMax) return false;
  }
  if (filters.brand && filters.brand.trim()) {
    const needle = filters.brand.trim().toLowerCase();
    if (!listing.brand || !listing.brand.toLowerCase().includes(needle)) return false;
  }
  return true;
}

/**
 * A listing is an "opportunity" candidate when it clears both a review-count
 * ceiling and a rating floor the user set — the two proxies PRD §4 names as
 * the readable signal, applied together rather than shown separately.
 */
function isOpportunity(listing: ListingSnapshot, filters: FilterState): boolean {
  if (filters.maxReviews === null || filters.minRatingGap === null) return false;
  if (listing.reviewCount === null || listing.reviewCount > filters.maxReviews) return false;
  if (listing.rating === null || listing.rating >= filters.minRatingGap) return false;
  return true;
}

export function applyFilters(listings: ListingSnapshot[], filters: FilterState): FilteredListing[] {
  return listings.map(listing => ({
    listing,
    matches: isEmptyFilter(filters) ? true : matchesFilter(listing, filters),
    opportunity: isOpportunity(listing, filters),
  }));
}
