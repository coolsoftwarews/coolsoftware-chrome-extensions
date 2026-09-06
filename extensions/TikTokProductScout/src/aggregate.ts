/**
 * Turns raw Product records plus the panel's current filters into what the
 * board actually displays. Pure and DOM-free so the arithmetic — the part
 * most likely to be quoted back at us if it's wrong — is checked headlessly.
 *
 * PRD §4: "The 'distinct creators' count is the number that matters and
 * should be the biggest thing on the card." That number, and the median
 * ratio beside it, are computed here from whichever videos survive the
 * current filters — not from the product's full (unfiltered) history.
 */

import { computeOutlier, medianRatioOf } from './outlier';
import { hasCommercialMarker } from './markers';
import { BoardFilters, CreatorBaseline, Product, ProductStats, TrackedVideo } from './types';

export function matchesFilters(video: TrackedVideo, filters: BoardFilters, now: number = Date.now()): boolean {
  if (filters.onlyCommercial && !hasCommercialMarker(video.markers)) return false;
  if (filters.minViews !== null && (video.views ?? 0) < filters.minViews) return false;
  if (filters.withinDays !== null) {
    const cutoff = now - filters.withinDays * 24 * 60 * 60 * 1000;
    if (video.addedAt < cutoff) return false;
  }
  return true;
}

/**
 * The min-ratio filter needs a baseline lookup per video, so it is applied
 * separately from matchesFilters (which only needs the video itself). Videos
 * with no baseline yet are kept when no ratio filter is set, and dropped once
 * one is — a pending ratio can never satisfy "at least N×".
 */
export function filterVideos(
  videos: TrackedVideo[],
  filters: BoardFilters,
  baselines: Map<string, CreatorBaseline>,
  now: number = Date.now()
): TrackedVideo[] {
  return videos.filter(video => {
    if (!matchesFilters(video, filters, now)) return false;
    if (filters.minRatio !== null) {
      const outlier = computeOutlier(video.views, baselines.get(video.creatorHandle) ?? null);
      if (outlier.ratio === null || outlier.ratio < filters.minRatio) return false;
    }
    return true;
  });
}

export function computeProductStats(
  product: Product,
  filters: BoardFilters,
  baselines: Map<string, CreatorBaseline>,
  now: number = Date.now()
): ProductStats {
  const visibleVideos = filterVideos(product.videos, filters, baselines, now);
  const outliers = visibleVideos.map(v => computeOutlier(v.views, baselines.get(v.creatorHandle) ?? null));

  const distinctCreators = new Set(visibleVideos.map(v => v.creatorHandle)).size;
  const addedAtValues = visibleVideos.map(v => v.addedAt);

  return {
    product,
    visibleVideos,
    distinctCreators,
    medianRatio: medianRatioOf(outliers),
    firstSeen: addedAtValues.length ? Math.min(...addedAtValues) : null,
    lastSeen: addedAtValues.length ? Math.max(...addedAtValues) : null,
    pendingBaselines: outliers.filter(o => o.ratio === null).length,
  };
}

/** All products with their computed stats, sorted by distinct-creator count — the metric the PRD calls "the number that matters". */
export function rankProducts(
  products: Product[],
  filters: BoardFilters,
  baselines: Map<string, CreatorBaseline>,
  now: number = Date.now()
): ProductStats[] {
  return products
    .map(product => computeProductStats(product, filters, baselines, now))
    .filter(stats => stats.visibleVideos.length > 0)
    .sort((a, b) => b.distinctCreators - a.distinctCreators || (b.lastSeen ?? 0) - (a.lastSeen ?? 0));
}

/** How many of the (unfiltered) products have reached the PRD §8 "≥ 3 distinct creators" milestone. */
export function countBoardsAtThreeCreators(products: Product[]): number {
  return products.filter(product => new Set(product.videos.map(v => v.creatorHandle)).size >= 3).length;
}
