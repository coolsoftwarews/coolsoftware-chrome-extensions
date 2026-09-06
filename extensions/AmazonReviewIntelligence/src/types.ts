/**
 * Shared shapes. Reviews are read from the page the user opened (PRD §5) —
 * nothing here is fetched, only parsed out of the DOM and clustered locally.
 */

export type LanguageBucket = 'latin' | 'cyrillic' | 'cjk' | 'arabic' | 'hangul' | 'greek' | 'hebrew' | 'other';

export interface Review {
  /** Stable per-review id: Amazon's own DOM id when present, else a content hash. */
  id: string;
  rating: number; // 1-5
  title: string;
  /** Body text. Empty for a media-only review (PRD §7). */
  text: string;
  /** As printed by Amazon, e.g. "Reviewed in the United States on January 5, 2024". */
  dateRaw: string;
  /** Parsed to YYYY-MM-DD when the date text could be understood. */
  dateIso: string | null;
  verified: boolean;
  /** Size/colour strip text, e.g. "Color: Black | Size: Large". Empty when absent. */
  variation: string;
  language: LanguageBucket;
  /** True when the review has no usable text (image/video only). */
  mediaOnly: boolean;
  helpfulVotes: number;
}

export interface ThemeCluster {
  id: string;
  /** "battery / charge / dies" — up to 3 representative terms. */
  label: string;
  terms: string[];
  count: number;
  reviewIds: string[];
}

export type ThemeBand = 'negative' | 'praise';

export interface AnalysisResult {
  language: LanguageBucket;
  band: ThemeBand;
  /** Reviews this band was computed from, in this language bucket. */
  reviewsInBand: number;
  themes: ThemeCluster[];
  /** True when reviewsInBand was too small to cluster meaningfully. */
  insufficient: boolean;
}

export interface ProductSnapshot {
  asin: string;
  totalReviews: number;
  negativeCount: number; // 1-2 star
  positiveCount: number; // 4-5 star
  neutralCount: number; // 3 star
  languages: Partial<Record<LanguageBucket, number>>;
}

/** One saved point in time, used to compute "up from 18 to 31". */
export interface HistorySnapshot {
  date: string; // YYYY-MM-DD
  totalReviews: number;
  negativeCount: number;
  /** theme key (sorted terms joined by "|") -> count, at the time of this snapshot. */
  themeCounts: Record<string, number>;
}

export interface AsinRecord {
  asin: string;
  productTitle: string;
  productUrl: string;
  domain: string;
  reviews: Review[];
  note: string;
  history: HistorySnapshot[];
  updatedAt: number;
}

export interface Filters {
  starBand: 0 | 1 | 2 | 3 | 4 | 5; // 0 = all
  verifiedOnly: boolean;
  keyword: string;
  dateFrom: string; // YYYY-MM-DD or ''
  dateTo: string; // YYYY-MM-DD or ''
}

export const DEFAULT_FILTERS: Filters = {
  starBand: 0,
  verifiedOnly: false,
  keyword: '',
  dateFrom: '',
  dateTo: '',
};

/* ── Messages (panel <-> content) ────────────────────────────────────── */

export interface PageContext {
  supported: boolean;
  asin: string | null;
  productTitle: string;
  productUrl: string;
  domain: string;
  reviewsOnPage: number;
  hasMorePages: boolean;
  unsupportedReason: string | null;
}

export type PanelToContent = { type: 'ARI_GET_CONTEXT' } | { type: 'ARI_RESCAN' };

export type ContentToBackground = {
  type: 'ARI_PAGE_ANALYZED';
  reviewsOnPage: number;
  totalAccumulated: number;
  hasMorePages: boolean;
};
