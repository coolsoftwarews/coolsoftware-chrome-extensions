/**
 * Filters: min outlier ratio, domain, has-text-overlay, last N results
 * (PRD §4). Pure — takes the badges the outlier engine already computed
 * rather than recomputing anything.
 */

import { Filters, PinBadge, PinCard } from './types';

export function applyFilters(pins: PinCard[], badges: Record<string, PinBadge>, filters: Filters): PinCard[] {
  let result = [...pins].sort((a, b) => a.rank - b.rank);

  if (filters.lastN != null) result = result.slice(0, filters.lastN);

  if (filters.minRatio != null) {
    const min = filters.minRatio;
    result = result.filter(p => {
      const badge = badges[p.id];
      return badge?.kind === 'ratio' && (badge.ratio ?? 0) >= min;
    });
  }

  if (filters.domain) {
    const domain = filters.domain.toLowerCase();
    result = result.filter(p => (p.domain ?? '').toLowerCase().includes(domain));
  }

  if (filters.hasTextOverlay != null) {
    result = result.filter(p => p.hasTextOverlay === filters.hasTextOverlay);
  }

  return result;
}
