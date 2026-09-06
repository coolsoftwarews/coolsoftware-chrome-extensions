/**
 * The outlier engine (README's shared module of the same name): median
 * baseline, ratio badges, sample-size honesty. Deliberately pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check every rule headlessly. The
 * DOM-bound half that turns a grid into RawPost[] lives in scan.ts.
 */

import { CAP_RATIO, MIN_RELIABLE_SAMPLE, MetricSource, OutlierBand, ProfileStats, RawPost, ScoredPost } from './types';

/* ── Number parsing ──────────────────────────────────────────────────── */

const COMPACT_MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "12.3K" → 12300, "1,234" → 1234, "3.1M" → 3100000. Returns null rather than
 * guessing — an unparsed count must never be silently treated as zero.
 */
export function parseCompactNumber(input: string | null | undefined): number | null {
  if (!input) return null;
  const text = input.trim().toLowerCase();
  if (!text) return null;

  const match = text.match(/([\d.,]+)\s*([kmb])?/);
  if (!match) return null;

  const digits = match[1];
  const suffix = match[2];
  // "1,234" is a thousands separator; "1.2m" is a decimal plus a suffix.
  // Stripping commas handles both, because a suffixed number never groups.
  const numeric = Number(digits.replace(/,/g, ''));
  if (!Number.isFinite(numeric)) return null;

  return Math.round(suffix ? numeric * COMPACT_MULTIPLIERS[suffix] : numeric);
}

/** 12345 → "12.3K". Used for badges and the header strip, so it stays short. */
export function formatCompact(value: number): string {
  const sign = value < 0 ? '-' : '';
  const abs = Math.abs(value);
  if (abs >= 1e9) return `${sign}${trimZero(abs / 1e9)}B`;
  if (abs >= 1e6) return `${sign}${trimZero(abs / 1e6)}M`;
  if (abs >= 1e3) return `${sign}${trimZero(abs / 1e3)}K`;
  return `${sign}${Math.round(abs)}`;
}

function trimZero(value: number): string {
  const fixed = value.toFixed(1);
  return fixed.endsWith('.0') ? fixed.slice(0, -2) : fixed;
}

/** Median of a numeric list; null for an empty list. Even-length averages the middle pair. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? Math.round((sorted[mid - 1] + sorted[mid]) / 2) : sorted[mid];
}

/* ── Profile baseline ────────────────────────────────────────────────── */

/**
 * The account's recent median, from whatever is currently loaded. Pinned
 * posts are excluded from the calculation (PRD §7) but still badged normally
 * by scorePost — an old pinned post at the top of the grid must not drag the
 * "recent" baseline toward it.
 */
export function computeProfileStats(posts: RawPost[]): ProfileStats {
  const unpinned = posts.filter(p => !p.pinned);

  const views = unpinned.map(p => p.views).filter((v): v is number => v !== null && v >= 0);
  const likes = unpinned.map(p => p.likes).filter((v): v is number => v !== null && v >= 0);
  const dates = posts.map(p => p.takenAt).filter((v): v is number => v !== null);

  return {
    totalLoaded: posts.length,
    viewsSampleSize: views.length,
    viewsMedian: median(views),
    likesSampleSize: likes.length,
    likesMedian: median(likes),
    // PRD §5: below ~12 posts, the median is not yet a reliable baseline.
    reliable: unpinned.length >= MIN_RELIABLE_SAMPLE,
    dateRangeStart: dates.length ? Math.min(...dates) : null,
    dateRangeEnd: dates.length ? Math.max(...dates) : null,
  };
}

/* ── Bands ───────────────────────────────────────────────────────────── */

/**
 * PRD §4 lists the bands as `🔥 ≥5×`, `🔥 ≥2×`, `↑ ≥1.5×`, `— under` — the
 * illustrative example a few lines above it shows a 2.4× post as `↑` rather
 * than `🔥`, but the band list is the spec of record here, so it wins: both
 * the ≥5× and ≥2× tiers render the fire glyph (fire5 gets the stronger
 * colour/weight in the UI), and only 1.5–2× gets the arrow.
 */
export function bandFor(ratio: number): OutlierBand {
  if (ratio >= 5) return 'fire5';
  if (ratio >= 2) return 'fire2';
  if (ratio >= 1.5) return 'up';
  return 'flat';
}

export function bandGlyph(band: OutlierBand): string {
  switch (band) {
    case 'fire5':
    case 'fire2':
      return '🔥';
    case 'up':
      return '↑';
    case 'flat':
      return '—';
    case 'unrated':
      return '';
  }
}

/** "8.7×", capped at "20×+", suffixed "× likes" for the like-based fallback. */
export function formatRatio(ratio: number, source: MetricSource, capped: boolean): string {
  const number = capped ? `${CAP_RATIO}×+` : `${ratio.toFixed(1)}×`;
  return source === 'likes' ? `${number} likes` : number;
}

/**
 * Scores one post against the profile baseline. Views are preferred; when a
 * post has no view count it falls back to a like-based ratio computed
 * against the *likes* median specifically, never the views median — mixing
 * the two denominators is exactly what PRD §5 says not to do.
 */
export function scorePost(post: RawPost, stats: ProfileStats): ScoredPost {
  let source: MetricSource = 'unknown';
  let raw: number | null = null;
  let baseline: number | null = null;

  if (post.views !== null && stats.viewsMedian !== null && stats.viewsMedian > 0) {
    source = 'views';
    raw = post.views;
    baseline = stats.viewsMedian;
  } else if (post.likes !== null && stats.likesMedian !== null && stats.likesMedian > 0) {
    source = 'likes';
    raw = post.likes;
    baseline = stats.likesMedian;
  }

  if (raw === null || baseline === null) {
    return { ...post, ratio: null, displayRatio: null, ratioCapped: false, band: 'unrated', metricSource: source, ratioLabel: '' };
  }

  const ratio = raw / baseline;
  const capped = ratio >= CAP_RATIO;
  const displayRatio = capped ? CAP_RATIO : ratio;
  const band = bandFor(ratio);

  return {
    ...post,
    ratio,
    displayRatio,
    ratioCapped: capped,
    band,
    metricSource: source,
    ratioLabel: formatRatio(displayRatio, source, capped),
  };
}

export function scoreAll(posts: RawPost[], stats: ProfileStats): ScoredPost[] {
  return posts.map(post => scorePost(post, stats));
}
