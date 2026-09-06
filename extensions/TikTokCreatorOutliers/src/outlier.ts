/**
 * The outlier engine: median baseline, ratio badges, sample-size honesty.
 * Pure and DOM-free so scripts/selftest.mjs can check it headlessly.
 *
 * Same shape the PRDs describe reusing across Instagram/TikTok/X/Pinterest —
 * this file implements it against PRD-09's own numbers (§4, §5, §7), not
 * assumed to match the Instagram sibling's thresholds.
 */

import { FIRE_RATIO, LOW_SAMPLE_FLOOR, OutlierBand, OutlierSnapshot, OutlierVideo, RATIO_DISPLAY_CAP, ScannedVideo, UP_RATIO } from './types';

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function bandFor(ratio: number | null): OutlierBand {
  if (ratio === null) return 'unknown';
  if (ratio >= FIRE_RATIO) return 'fire';
  if (ratio >= UP_RATIO) return 'up';
  return 'flat';
}

/**
 * Computes the median and badges every video against it.
 *
 * Pinned videos are excluded from the median (PRD §5: "Exclude pins from the
 * median or every account looks flat") but still appear in the results list
 * with a badge of their own, since a pinned outlier is still an outlier.
 */
export function computeSnapshot(profileId: string, videos: ScannedVideo[]): OutlierSnapshot {
  const baseline = videos.filter(v => !v.pinned && v.views !== null).map(v => v.views as number);
  const med = median(baseline);

  const outlierVideos: OutlierVideo[] = videos.map(video => {
    const ratio = med !== null && med > 0 && video.views !== null ? video.views / med : null;
    const displayRatio = ratio === null ? null : Math.min(ratio, RATIO_DISPLAY_CAP);
    return {
      ...video,
      ratio,
      displayRatio,
      ratioCapped: ratio !== null && ratio > RATIO_DISPLAY_CAP,
      band: bandFor(ratio),
    };
  });

  const dated = videos.filter(v => v.postedAt !== null).map(v => v.postedAt as number);

  return {
    profileId,
    median: med,
    sampleSize: baseline.length,
    loadedCount: videos.length,
    lowSample: baseline.length < LOW_SAMPLE_FLOOR,
    videos: outlierVideos,
    dateRange: {
      earliest: dated.length ? Math.min(...dated) : null,
      latest: dated.length ? Math.max(...dated) : null,
    },
  };
}

/** The glyph + label shown on a badge, per PRD §4's example strip. */
export function badgeGlyph(band: OutlierBand): string {
  switch (band) {
    case 'fire':
      return '🔥';
    case 'up':
      return '↑';
    case 'flat':
      return '—';
    case 'unknown':
      return '·';
  }
}

/** "11.4×" / "20×+" when capped / "—" when unknown. */
export function formatRatio(video: OutlierVideo): string {
  if (video.displayRatio === null) return '—';
  if (video.ratioCapped) return `${Math.floor(video.displayRatio)}×+`;
  return `${video.displayRatio.toFixed(1)}×`;
}
