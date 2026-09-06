/**
 * Filters and sort — PRD §4: ">2× / >5× · last 30/90 days · length band · sort
 * by ratio, views or date." Pure, DOM-free.
 */

import { FilterState, LengthBand, OutlierVideo, SortKey } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

export function lengthBandOf(durationSeconds: number | null): LengthBand {
  if (durationSeconds === null) return 'all';
  if (durationSeconds < 15) return 'under15';
  if (durationSeconds < 30) return '15to30';
  if (durationSeconds < 60) return '30to60';
  return 'over60';
}

export const LENGTH_BAND_LABELS: Record<Exclude<LengthBand, 'all'>, string> = {
  under15: 'Under 15s',
  '15to30': '15–30s',
  '30to60': '30–60s',
  over60: '60s+',
};

export function matchesFilters(video: OutlierVideo, filters: FilterState, now = Date.now()): boolean {
  if (filters.ratio === '2x' && !(video.ratio !== null && video.ratio >= 2)) return false;
  if (filters.ratio === '5x' && !(video.ratio !== null && video.ratio >= 5)) return false;

  if (filters.date !== 'all') {
    // A video with no readable date cannot be excluded by a date filter it
    // has no evidence against — hiding it would be a false negative, not a
    // safe default (§5/§7: dates are frequently unreadable from the grid).
    if (video.postedAt !== null) {
      const windowMs = (filters.date === '30d' ? 30 : 90) * DAY_MS;
      if (now - video.postedAt > windowMs) return false;
    }
  }

  // Unlike the date filter, a length band is a specific claim about the
  // video ("15–30s") that "duration unknown" cannot honestly satisfy, so a
  // video with no readable duration drops out once a length filter is active
  // rather than being kept by default.
  if (filters.length !== 'all' && lengthBandOf(video.durationSeconds) !== filters.length) return false;

  return true;
}

export function sortVideos(videos: OutlierVideo[], sort: SortKey): OutlierVideo[] {
  const withIndex = videos.map((video, index) => ({ video, index }));
  withIndex.sort((a, b) => {
    const diff = compareBySort(a.video, b.video, sort);
    return diff !== 0 ? diff : a.index - b.index;
  });
  return withIndex.map(entry => entry.video);
}

function compareBySort(a: OutlierVideo, b: OutlierVideo, sort: SortKey): number {
  switch (sort) {
    case 'ratio':
      return (b.ratio ?? -Infinity) - (a.ratio ?? -Infinity);
    case 'views':
      return (b.views ?? -Infinity) - (a.views ?? -Infinity);
    case 'date':
      return (b.postedAt ?? -Infinity) - (a.postedAt ?? -Infinity);
  }
}
