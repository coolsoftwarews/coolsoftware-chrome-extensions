/**
 * Shared shapes for the profile grid → outlier engine → hook panel → export
 * pipeline. PRD-09 §4 scope, kept intentionally narrow.
 */

/* ── What the grid gives us ──────────────────────────────────────────── */

/**
 * One video (or photo/slideshow post) as read from the profile grid, before
 * any ratio math. Every field beyond `id` and `views` is nullable — PRD-09 §5
 * and §7 both flag that captions, durations and dates may not be readable
 * from the grid without opening the post, and the product must degrade
 * gracefully rather than break when that happens.
 */
export interface ScannedVideo {
  /** TikTok video id, parsed from the post's href. Doubles as a stable key. */
  id: string;
  href: string;
  views: number | null;
  /** First line of the caption, if the grid exposes one (e.g. thumbnail alt text). */
  captionFirstLine: string | null;
  /** Hashtags found in whatever caption text was readable. */
  hashtags: string[];
  /** Seconds, if a duration badge is present on the tile. */
  durationSeconds: number | null;
  /** Epoch ms, only when the grid exposes a date; almost never for TikTok. */
  postedAt: number | null;
  /** Creator-pinned to the top of their grid — excluded from the median (§5). */
  pinned: boolean;
  /** Photo/slideshow post rather than a video (§7 edge case). */
  isPhoto: boolean;
}

/* ── Outlier engine ───────────────────────────────────────────────────── */

export type OutlierBand = 'fire' | 'up' | 'flat' | 'unknown';

export interface OutlierVideo extends ScannedVideo {
  /** views ÷ median of non-pinned loaded videos. Null when the median is 0/unknown. */
  ratio: number | null;
  /** Ratio clamped to the display cap (§7: "cap the badge at 20×+"). */
  displayRatio: number | null;
  /** True when `ratio` was clamped down to reach `displayRatio`. */
  ratioCapped: boolean;
  band: OutlierBand;
}

export interface OutlierSnapshot {
  profileId: string;
  /** Median of non-pinned loaded videos with a known view count. Null under 1 sample. */
  median: number | null;
  /** Count of non-pinned videos with a known view count — what the median is built from. */
  sampleSize: number;
  /** Count of every loaded tile, pinned or not, view count known or not. */
  loadedCount: number;
  /** True when sampleSize is below the honesty floor (§5, §7: grey under ~12). */
  lowSample: boolean;
  videos: OutlierVideo[];
  /** Earliest/latest known post date among videos where a date was readable. */
  dateRange: { earliest: number | null; latest: number | null };
}

export const LOW_SAMPLE_FLOOR = 12;
export const FIRE_RATIO = 2;
export const UP_RATIO = 1;
export const RATIO_DISPLAY_CAP = 20;

/* ── Filters & sort ──────────────────────────────────────────────────── */

export type RatioFilter = 'all' | '2x' | '5x';
export type DateFilter = 'all' | '30d' | '90d';
export type LengthBand = 'all' | 'under15' | '15to30' | '30to60' | 'over60';
export type SortKey = 'ratio' | 'views' | 'date';

export interface FilterState {
  ratio: RatioFilter;
  date: DateFilter;
  length: LengthBand;
  sort: SortKey;
}

export const DEFAULT_FILTERS: FilterState = {
  ratio: 'all',
  date: 'all',
  length: 'all',
  sort: 'ratio',
};

/* ── Hook panel ──────────────────────────────────────────────────────── */

export interface HashtagObservation {
  tag: string;
  outlierCount: number;
  outlierPct: number;
  baselinePct: number;
}

export interface HookInsights {
  sufficientData: true;
  outlierCount: number;
  /** e.g. "7 of 9 outliers open with a question". Observations, never advice. */
  observations: string[];
  sharedHashtags: HashtagObservation[];
  /** null when too few videos had a readable duration to say anything. */
  lengthBand: { outlierBand: string; baselineBand: string } | null;
  /** null when no post in the set had a readable date. */
  postingTime: { hourBuckets: Record<string, number>; dayBuckets: Record<string, number> } | null;
}

export interface InsufficientHookData {
  sufficientData: false;
  outlierCount: number;
  minimumRequired: number;
}

export type HookResult = HookInsights | InsufficientHookData;

export const MIN_HOOK_SAMPLE = 8;

/* ── Local state ─────────────────────────────────────────────────────── */

export interface MedianCacheEntry {
  profileId: string;
  median: number;
  sampleSize: number;
  updatedAt: number;
}

export interface Backup {
  format: 'tiktok-creator-outliers';
  version: 1;
  exportedAt: string;
  filters: FilterState;
  medianCache: MedianCacheEntry[];
}

/* ── Messages (content ⇄ background) ────────────────────────────────── */

export type ExportFormat = 'csv' | 'md';

export interface ExportFileRequest {
  type: 'TCO_EXPORT_FILE';
  filename: string;
  content: string;
  mimeType: string;
}

export interface ExportFileResponse {
  ok: boolean;
  error?: string;
}

/* ── Local-only instrumentation (README "Hard constraints") ────────────── */

export type MetricKey =
  | 'profile_scanned'
  | 'hook_panel_opened'
  | 'export_csv'
  | 'export_md'
  | 'filter_ratio'
  | 'filter_date'
  | 'filter_length'
  | 'sort_changed'
  | 'parse_failure';

export interface Metrics {
  counts: Partial<Record<MetricKey, number>>;
  /** Distinct profile handles seen, capped — lets the panel show "N profiles analysed". */
  profilesAnalyzed: string[];
}
