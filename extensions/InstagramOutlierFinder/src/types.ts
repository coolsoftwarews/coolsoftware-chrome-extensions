/**
 * Shared shapes. Split roughly the way the PRD reads: a post is scanned off
 * the grid, scored against the profile's own median, then filtered and
 * sorted for display and export. Every numeric field the DOM can plausibly
 * omit is nullable — an unknown value degrades a badge, it never crashes one.
 */

export type PostKind = 'reel' | 'carousel' | 'post';

/** Which denominator a post's ratio was computed against — never mixed (PRD §5). */
export type MetricSource = 'views' | 'likes' | 'unknown';

export type OutlierBand = 'fire5' | 'fire2' | 'up' | 'flat' | 'unrated';

/** One grid tile, after DOM + embedded-JSON extraction. */
export interface RawPost {
  /** Instagram's own shortcode, e.g. "Cx1AbCdEfGh" — the stable id. */
  id: string;
  url: string;
  kind: PostKind;
  /** True when the DOM/JSON marks this as a pinned post (excluded from the median). */
  pinned: boolean;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** Epoch ms; null when neither the DOM nor embedded JSON exposed a date. */
  takenAt: number | null;
}

/** The account-level baseline computed from every loaded, non-pinned post. */
export interface ProfileStats {
  /** Every tile currently loaded in the grid, pinned or not. */
  totalLoaded: number;
  /** Non-pinned posts that exposed a view count — the views median's sample. */
  viewsSampleSize: number;
  viewsMedian: number | null;
  /** Non-pinned posts that exposed a like count — the likes median's sample. */
  likesSampleSize: number;
  likesMedian: number | null;
  /** PRD §5: below ~12 posts the median is not shown as a baseline. */
  reliable: boolean;
  dateRangeStart: number | null;
  dateRangeEnd: number | null;
}

export const MIN_RELIABLE_SAMPLE = 12;
/** PRD §7: cap the displayed multiplier so one viral post doesn't compress every badge. */
export const CAP_RATIO = 20;

/** A post plus its computed badge, ready to filter/sort/render/export. */
export interface ScoredPost extends RawPost {
  ratio: number | null;
  /** Ratio clamped to CAP_RATIO for display; ratio itself stays exact for sorting/export. */
  displayRatio: number | null;
  ratioCapped: boolean;
  band: OutlierBand;
  metricSource: MetricSource;
  /** e.g. "8.7×" or "8.7× likes" or "20×+" — what the badge and export both show. */
  ratioLabel: string;
}

/* ── Filters & sort (PRD §4) ─────────────────────────────────────────── */

export type RatioFilter = 'all' | '2x' | '5x';
export type KindFilter = 'all' | 'reels' | 'posts';
export type DaysFilter = 30 | 90 | null;
export type SortKey = 'ratio' | 'views' | 'date';

export interface FilterState {
  ratio: RatioFilter;
  kind: KindFilter;
  days: DaysFilter;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FilterState = {
  ratio: 'all',
  kind: 'all',
  days: null,
  sort: 'ratio',
};

/* ── Storage records ─────────────────────────────────────────────────── */

/** Cached per-profile so revisiting is instant (PRD §4 "local state"). */
export interface ProfileCacheRecord {
  handle: string;
  stats: ProfileStats;
  postCount: number;
  computedAt: number;
}

export interface Backup {
  format: 'instagram-outlier-finder';
  version: 1;
  exportedAt: string;
  filters: FilterState;
  profiles: ProfileCacheRecord[];
}

/* ── Local-only instrumentation (PRD §9) ────────────────────────────── */

export type MetricEvent =
  | 'profile_analysed'
  | 'filter_used'
  | 'sort_used'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** The PRD §9 health metric: grid loads where extraction produced nothing usable. */
  parseFailures: number;
  activeDays: string[];
}

/* ── Messages: content script ⇄ background (only the download needs one) ─ */

export interface DownloadRequest {
  type: 'IOF_DOWNLOAD';
  filename: string;
  content: string;
  mimeType: string;
}

export interface DownloadResponse {
  ok: boolean;
  error?: string;
}
