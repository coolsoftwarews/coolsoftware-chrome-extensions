/**
 * The filter row and sort (PRD §4): a single row, no settings page. Pure so
 * scripts/selftest.mjs can check every combination headlessly.
 */

import { FilterState, ScoredPost } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * A post with an unknown value for the thing being filtered is always kept —
 * hiding a post because a count failed to parse would make the page look
 * broken rather than merely incomplete (mirrors the "unknown never excludes"
 * rule the outlier engine's other users follow).
 */
export function matchesFilter(post: ScoredPost, filter: FilterState, now = Date.now()): boolean {
  if (filter.ratio !== 'all') {
    const threshold = filter.ratio === '5x' ? 5 : 2;
    if (post.ratio !== null && post.ratio < threshold) return false;
  }

  if (filter.days !== null && post.postedAt !== null) {
    if (post.postedAt < now - filter.days * DAY_MS) return false;
  }

  return true;
}

/** Missing values always sink to the bottom rather than being scattered in by a null-as-zero comparison. */
export function compareBySort(a: ScoredPost, b: ScoredPost, sort: FilterState['sort']): number {
  const value = (post: ScoredPost): number | null => {
    switch (sort) {
      case 'ratio':
        return post.ratio;
      case 'date':
        return post.postedAt;
      case 'engagement':
        return post.engagement;
    }
  };

  const av = value(a);
  const bv = value(b);
  if (av === null && bv === null) return 0;
  if (av === null) return 1;
  if (bv === null) return -1;
  return bv - av;
}

/** The filtered, sorted set the header count, dimming and export all read from. */
export function visibleSet(posts: ScoredPost[], filter: FilterState, now = Date.now()): ScoredPost[] {
  return posts
    .filter(post => matchesFilter(post, filter, now))
    .sort((a, b) => compareBySort(a, b, filter.sort));
}
