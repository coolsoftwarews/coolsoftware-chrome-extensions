/**
 * Filters and sort — the third of the PRD's three moves (§4): "let you filter
 * to 'still running after 60 days'." Pure so it can be tested without a page.
 */

import { ComputedAd, FilterState, SortKey } from './types';

export function applyFilters(ads: ComputedAd[], filters: FilterState): ComputedAd[] {
  return ads.filter(ad => {
    if (ad.daysRunning < filters.minDays) return false;
    if (filters.activeOnly && ad.status !== 'active') return false;
    if (ad.variantCount < filters.minVariants) return false;
    if (filters.format !== 'all' && ad.format !== filters.format) return false;
    return true;
  });
}

export function sortAds(ads: ComputedAd[], key: SortKey): ComputedAd[] {
  const sorted = [...ads];
  switch (key) {
    case 'days':
      // Longest-running first — "the feature people will describe to each other" (PRD §4).
      sorted.sort((a, b) => b.daysRunning - a.daysRunning);
      break;
    case 'variants':
      sorted.sort((a, b) => b.variantCount - a.variantCount || b.daysRunning - a.daysRunning);
      break;
    case 'start':
      // Oldest start date first; ads with no readable date sort last rather
      // than first, so a parse miss never masquerades as the oldest ad.
      sorted.sort((a, b) => {
        if (!a.startDate && !b.startDate) return 0;
        if (!a.startDate) return 1;
        if (!b.startDate) return -1;
        return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0;
      });
      break;
  }
  return sorted;
}
