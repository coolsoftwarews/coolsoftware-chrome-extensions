/**
 * The outlier engine (README's shared module of the same name): median
 * baseline per author, ratio badges, sample-size honesty. Deliberately pure
 * — no DOM, no chrome.* — so scripts/selftest.mjs can check every rule
 * headlessly. The DOM-bound half that turns a page into RawPost[] lives in
 * dom.ts/scan.ts.
 */

import {
  AuthorBaseline,
  AuthorCacheRecord,
  CACHE_TTL_MS,
  CAP_RATIO,
  MEDIAN_EXCLUSION_MULTIPLE,
  MIN_RELIABLE_SAMPLE,
  OutlierBand,
  RawPost,
  ScoredPost,
} from './types';

/* ── Number parsing ──────────────────────────────────────────────────── */

const COMPACT_MULTIPLIERS: Record<string, number> = { k: 1e3, m: 1e6, b: 1e9 };

/**
 * "1,234" → 1234, "1.2K" → 1200, "3.4M" → 3400000. Returns null rather than
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

/**
 * PRD §7: a single runaway post must not drag its own author's baseline
 * upward. Two passes — a preliminary median over every value, then a final
 * median over whatever remains once anything more than
 * MEDIAN_EXCLUSION_MULTIPLE times the preliminary median is dropped. Unlike
 * PRD-06's Instagram engine (which only caps the *display* ratio), this
 * exclusion happens in the calculation itself, per this build's own brief.
 */
export function robustMedian(
  values: number[],
  multiple = MEDIAN_EXCLUSION_MULTIPLE
): { median: number | null; excludedCount: number } {
  if (values.length === 0) return { median: null, excludedCount: 0 };

  const preliminary = median(values)!;
  // A zero (or negative, which should never happen) preliminary median makes
  // "15x the median" meaningless — nothing is excluded in that case, since
  // there is no sensible threshold to exclude against.
  if (preliminary <= 0) return { median: preliminary, excludedCount: 0 };

  const threshold = preliminary * multiple;
  const kept = values.filter(v => v <= threshold);
  // Safety net: never let the exclusion rule empty the sample entirely.
  const finalValues = kept.length > 0 ? kept : values;

  return { median: median(finalValues), excludedCount: values.length - finalValues.length };
}

/* ── Per-author baseline ─────────────────────────────────────────────── */

export function engagementOf(post: Pick<RawPost, 'reactions' | 'comments'>): number | null {
  if (post.reactions === null && post.comments === null) return null;
  return (post.reactions ?? 0) + (post.comments ?? 0);
}

/**
 * Computes a baseline for every author present in `posts` (live sample),
 * falling back to a cached record when the live sample is too thin (PRD §4
 * "Local state" / §5). Pinned/featured posts are excluded from the
 * calculation but still returned so the caller can score them normally.
 */
export function computeAuthorBaselines(
  posts: RawPost[],
  cache: Map<string, AuthorCacheRecord>,
  now = Date.now()
): Map<string, AuthorBaseline> {
  const byAuthor = new Map<string, RawPost[]>();
  for (const post of posts) {
    const list = byAuthor.get(post.authorId) ?? [];
    list.push(post);
    byAuthor.set(post.authorId, list);
  }

  const result = new Map<string, AuthorBaseline>();

  for (const [authorId, authorPosts] of byAuthor) {
    const values = authorPosts
      .filter(p => !p.pinned)
      .map(engagementOf)
      .filter((v): v is number => v !== null);

    if (values.length >= MIN_RELIABLE_SAMPLE) {
      const { median: baseline, excludedCount } = robustMedian(values);
      result.set(authorId, {
        authorId,
        median: baseline,
        sampleSize: values.length - excludedCount,
        excludedAsOutliers: excludedCount,
        reliable: baseline !== null,
        source: 'live',
        cachedAt: null,
      });
      continue;
    }

    const cached = cache.get(authorId);
    if (cached && now - cached.computedAt <= CACHE_TTL_MS) {
      result.set(authorId, {
        authorId,
        median: cached.median,
        sampleSize: cached.sampleSize,
        excludedAsOutliers: 0,
        reliable: true,
        source: 'cached',
        cachedAt: cached.computedAt,
      });
      continue;
    }

    result.set(authorId, {
      authorId,
      median: null,
      sampleSize: values.length,
      excludedAsOutliers: 0,
      reliable: false,
      source: 'none',
      cachedAt: null,
    });
  }

  return result;
}

/* ── Bands ───────────────────────────────────────────────────────────── */

/** Same band list this portfolio's outlier engine always uses (README shared module). */
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
      return '\u{1F525}';
    case 'up':
      return '↑';
    case 'flat':
      return '—';
    case 'unrated':
      return '';
  }
}

/** "4.2×", capped at "20×+". */
export function formatRatio(ratio: number, capped: boolean): string {
  return capped ? `${CAP_RATIO}×+` : `${ratio.toFixed(1)}×`;
}

/**
 * Scores one post against its own author's baseline. A post is left unrated
 * (never a false zero) when either the engagement or the baseline is
 * unknown/unreliable.
 */
export function scorePost(post: RawPost, baseline: AuthorBaseline | undefined): ScoredPost {
  const engagement = engagementOf(post);
  const baselineMedian = baseline?.median ?? null;

  if (engagement === null || baselineMedian === null || baselineMedian <= 0 || !baseline?.reliable) {
    return {
      ...post,
      engagement,
      ratio: null,
      displayRatio: null,
      ratioCapped: false,
      band: 'unrated',
      ratioLabel: '',
      baselineSampleSize: baseline?.sampleSize ?? 0,
      baselineSource: baseline?.source ?? 'none',
    };
  }

  const ratio = engagement / baselineMedian;
  const capped = ratio >= CAP_RATIO;
  const displayRatio = capped ? CAP_RATIO : ratio;
  const band = bandFor(ratio);

  return {
    ...post,
    engagement,
    ratio,
    displayRatio,
    ratioCapped: capped,
    band,
    ratioLabel: formatRatio(displayRatio, capped),
    baselineSampleSize: baseline.sampleSize,
    baselineSource: baseline.source,
  };
}

export function scoreAll(posts: RawPost[], baselines: Map<string, AuthorBaseline>): ScoredPost[] {
  return posts.map(post => scorePost(post, baselines.get(post.authorId)));
}
