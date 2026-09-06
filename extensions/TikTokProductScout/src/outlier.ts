/**
 * The Outlier engine (README "Shared modules"): a creator's own median view
 * count as the baseline, a ratio against it, and — the part that keeps this
 * honest — a confidence label whenever the sample behind that baseline is
 * thin. This is the commercial-intelligence framing from PRD-08 §4: a single
 * viral video proves nothing, so the badge must say so rather than imply a
 * confident number from one data point.
 */

import { CreatorBaseline, OutlierResult } from './types';

/** Below this many videos, a creator's median is one or two data points wearing a stats word. */
export const MIN_RELIABLE_SAMPLE = 3;

export function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Builds (or updates) a creator's baseline from view counts read off their
 * profile. Zero and negative values are dropped — TikTok occasionally renders
 * a placeholder before a count loads, and letting a zero corrupt the median
 * would understate every ratio.
 */
export function buildBaseline(handle: string, views: number[], now: number = Date.now()): CreatorBaseline | null {
  const clean = views.filter(v => Number.isFinite(v) && v > 0);
  if (!clean.length) return null;
  return { handle, median: median(clean), sampleSize: clean.length, updatedAt: now };
}

/**
 * The ratio badge's data. `ratio` is null until a baseline exists at all
 * (PRD §5: "show the ratio as pending until then, rather than guessing").
 * `confidence` stays 'low-sample' below MIN_RELIABLE_SAMPLE even once a ratio
 * exists — a creator who has posted once has a baseline that is meaningless,
 * and PRD §7 says to flag that, not hide the badge.
 */
export function computeOutlier(views: number | null, baseline: CreatorBaseline | null): OutlierResult {
  if (views === null || views <= 0 || !baseline || baseline.median <= 0) {
    return { ratio: null, confidence: 'pending' };
  }
  const ratio = views / baseline.median;
  const confidence = baseline.sampleSize < MIN_RELIABLE_SAMPLE ? 'low-sample' : 'reliable';
  return { ratio, confidence };
}

/** The compact form used on the in-feed badge: "6.2×", "6.2× (low sample)", or "pending". */
export function formatRatio(result: OutlierResult): string {
  if (result.ratio === null) return 'pending';
  const base = `${result.ratio.toFixed(1)}×`;
  return result.confidence === 'low-sample' ? `${base} (low sample)` : base;
}

/**
 * A product's median ratio across its tracked videos. Pending videos (no
 * baseline yet) are excluded rather than treated as 0 — mixing "unknown" with
 * "unremarkable" would quietly drag every product's number down.
 */
export function medianRatioOf(results: OutlierResult[]): number | null {
  const known = results.map(r => r.ratio).filter((ratio): ratio is number => ratio !== null);
  if (!known.length) return null;
  return median(known);
}
