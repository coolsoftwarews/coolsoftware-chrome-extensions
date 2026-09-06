/**
 * Shared shapes. A post is scanned off whatever page LinkedIn currently
 * renders (profile history / hashtag / search), grouped and baselined by its
 * author, scored, then filtered/sorted for display and export. Every
 * numeric field the DOM can plausibly omit is nullable — an unknown value
 * degrades a badge, it never crashes one (PRD §5/§7).
 */

export type PostType = 'text' | 'image' | 'document' | 'video' | 'poll' | 'article' | 'other';

/** Which page shape the content script is currently reading (PRD §4). */
export type PageMode = 'profile' | 'mixed' | 'unsupported';

/** One post, after DOM extraction. */
export interface RawPost {
  /** Post URN when LinkedIn exposes one, else a derived fallback id (PRD §7 dedupe). */
  id: string;
  /** Normalized profile URL of the ORIGINAL author — never the resharer (PRD §7). */
  authorId: string;
  authorName: string;
  authorHeadline: string;
  postType: PostType;
  /** True when this container is a "X reposted this" wrapper (PRD §7). */
  isRepost: boolean;
  /** True only when a Featured/pinned marker is detected — excluded from the author's median, still badged (PRD §4). */
  pinned: boolean;
  reactions: number | null;
  comments: number | null;
  reposts: number | null;
  /** Best-guess epoch ms from a relative label ("2d", "3w"); null when unparseable. */
  postedAt: number | null;
  postedAtLabel: string;
  /** Link to the post, when one could be recovered. */
  url: string;
}

/** The engine's per-metric-source-free constants (README's shared "outlier engine" module). */
export const MIN_RELIABLE_SAMPLE = 5;
/** PRD §7: a single runaway post is excluded from the median calculation itself, not just from display. */
export const MEDIAN_EXCLUSION_MULTIPLE = 15;
/** PRD §4: the displayed multiplier is capped so one outlier doesn't compress every other badge. */
export const CAP_RATIO = 20;
/** A cached per-author median older than this is treated as absent rather than shown as fact. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type BaselineSource = 'live' | 'cached' | 'none';

/** The baseline computed for one author from whatever's currently visible, or the local cache. */
export interface AuthorBaseline {
  authorId: string;
  median: number | null;
  /** How many of this author's own posts fed the median (live sample, or the cached sample size). */
  sampleSize: number;
  /** How many of this author's posts were excluded from the median as runaway outliers (PRD §7). */
  excludedAsOutliers: number;
  reliable: boolean;
  source: BaselineSource;
  /** Only set when source is 'cached' — when that median was computed. */
  cachedAt: number | null;
}

export type OutlierBand = 'fire5' | 'fire2' | 'up' | 'flat' | 'unrated';

/** A post plus its computed badge, ready to filter/sort/render/export. */
export interface ScoredPost extends RawPost {
  /** reactions + comments (PRD §4) — null only when both are unreadable. */
  engagement: number | null;
  ratio: number | null;
  /** Ratio clamped to CAP_RATIO for display; ratio itself stays exact for sorting/export. */
  displayRatio: number | null;
  ratioCapped: boolean;
  band: OutlierBand;
  ratioLabel: string;
  baselineSampleSize: number;
  baselineSource: BaselineSource;
}

/* ── Filters & sort (PRD §4) ─────────────────────────────────────────── */

export type RatioFilter = 'all' | '2x' | '5x';
export type DaysFilter = 30 | 90 | null;
export type SortKey = 'ratio' | 'date' | 'engagement';

export interface FilterState {
  ratio: RatioFilter;
  days: DaysFilter;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FilterState = {
  ratio: 'all',
  days: null,
  sort: 'ratio',
};

/* ── Storage records ─────────────────────────────────────────────────── */

/** Cached per-author so a thin-sample hashtag/search page can still badge confidently (PRD §4/§5). */
export interface AuthorCacheRecord {
  authorId: string;
  authorName: string;
  median: number;
  sampleSize: number;
  computedAt: number;
}

export interface Backup {
  format: 'linkedin-post-outliers';
  version: 1;
  exportedAt: string;
  filters: FilterState;
  authors: AuthorCacheRecord[];
}

/* ── Local-only instrumentation (PRD §8) ────────────────────────────── */

export type MetricEvent =
  | 'profile_scanned'
  | 'mixed_page_scanned'
  | 'filter_used'
  | 'sort_used'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** The PRD §8 health metric: page scans where extraction produced nothing usable. */
  parseFailures: number;
  activeDays: string[];
}

/* ── Messages: content script <-> background (only the download needs one) ─ */

export interface DownloadRequest {
  type: 'LPO_DOWNLOAD';
  filename: string;
  content: string;
  mimeType: string;
}

export interface DownloadResponse {
  ok: boolean;
  error?: string;
}
