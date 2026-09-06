/**
 * Shared shapes. The DOM-bound half (scan.ts, selectors.ts, content.ts) and
 * the pure half (velocity.ts, export.ts) both import from here so there is
 * exactly one definition of what a post is.
 */

/** A raw count as read off the page: the value we round-tripped, plus
 * whether it came from an abbreviated form ("1.2K") rather than an exact one. */
export interface ParsedCount {
  value: number;
  approx: boolean;
}

/** What scan.ts can pull out of one timeline entry, before any velocity math. */
export interface RawPost {
  /** The status id, from the permalink href. Stable across DOM recycling. */
  id: string;
  url: string;
  authorHandle: string;
  authorName: string;
  textPreview: string;
  likes: ParsedCount | null;
  reposts: ParsedCount | null;
  replies: ParsedCount | null;
  /** Epoch ms from the post's <time datetime> attribute, or null if absent. */
  publishedAt: number | null;
  isAd: boolean;
  isQuote: boolean;
}

/** RawPost plus everything derived from it. What the badge, filter and export
 * layers actually operate on. */
export interface Post extends RawPost {
  /** likes + reposts + replies, or null when any input count is missing. */
  engagement: number | null;
  /** engagement ÷ hours since posting. Null when engagement or age is unknown. */
  velocityPerHour: number | null;
  /** True when the post is under 5 minutes old — too new for a velocity to mean anything. */
  tooNew: boolean;
  /** velocityPerHour ÷ the author's median velocity. Null until a baseline exists. */
  outlierRatio: number | null;
  /** True when any count feeding this post's numbers was abbreviated. */
  approx: boolean;
  ageMs: number | null;
}

/* ── Author baselines ───────────────────────────────────────────────────
 * "Local state: author medians, filter settings. Nothing else." (PRD §4)
 * No post text, no counts beyond what is needed to keep a rolling median.
 */

export interface AuthorBaseline {
  handle: string;
  /** Most recent velocity observations, oldest first, capped at MAX_SAMPLES. */
  samples: number[];
  updatedAt: number;
}

export const MAX_BASELINE_SAMPLES = 20;
/** Fewer than this many samples and a ratio would be noise wearing a badge. */
export const MIN_BASELINE_SAMPLES = 3;

/* ── Filters ─────────────────────────────────────────────────────────── */

export type AgeBand = 'any' | '1h' | '6h' | '24h';
export type FilterMode = 'dim' | 'hide';

export interface FilterSettings {
  minVelocity: number | null;
  minRatio: number | null;
  ageBand: AgeBand;
  mode: FilterMode;
}

export const DEFAULT_FILTERS: FilterSettings = {
  minVelocity: null,
  minRatio: null,
  ageBand: 'any',
  mode: 'dim',
};

export type SortMode = 'default' | 'velocity';

/* ── Export ──────────────────────────────────────────────────────────── */

export type ExportFormat = 'csv' | 'md';

/* ── Messages (content ⇄ background, content ⇄ popup) ───────────────── */

export interface ExportRequest {
  type: 'XVF_EXPORT';
  filename: string;
  /** data: URL — built in the content script so the service worker never
   * needs DOM APIs or a Blob. */
  dataUrl: string;
}

export interface ExportResponse {
  ok: boolean;
  error?: string;
}

export interface StatusRequest {
  type: 'XVF_GET_STATUS';
}

export interface StatusResponse {
  onSupportedPage: boolean;
  postsSeen: number;
  postsShown: number;
  filters: FilterSettings;
}

/* ── Local instrumentation ──────────────────────────────────────────────
 * Counter names only — no post ids, no handles, no text. See PRIVACY.md.
 */
export type MetricEvent =
  | 'badge_rendered'
  | 'filter_set'
  | 'filter_cleared'
  | 'sort_velocity_used'
  | 'export_csv'
  | 'export_md'
  | 'mode_dim'
  | 'mode_hide'
  | 'popup_opened';

export type FailureReason = 'parse_post' | 'dom_layout_changed';
