/* ── Search results ──────────────────────────────────────────────────── */

export type ResultKind = 'video' | 'short' | 'live' | 'upcoming';

/**
 * Everything we can learn about one search result from YouTube's own DOM,
 * before any background enrichment runs. Every numeric field is nullable
 * because YouTube omits them freely (no view count on premieres, no date on
 * live, no duration on Shorts rows).
 */
export interface ResultData {
  videoId: string;
  kind: ResultKind;
  title: string;
  /** Channel id (UC…) or @handle — whichever the DOM gave us. Cache key. */
  channelKey: string | null;
  channelUrl: string | null;
  channelName: string | null;
  /** Parsed from "1.2M views" — approximate by construction. */
  views: number | null;
  /** Epoch ms, derived from "3 days ago". Approximate. */
  publishedAt: number | null;
  durationSeconds: number | null;
}

/** DOM-derived data plus whatever the background enrichment resolved. */
export interface EnrichedResult extends ResultData {
  subscribers: number | null;
  /** Median view count across the channel's recent uploads. */
  channelMedianViews: number | null;
  /** views ÷ max(days since publish, 1). Null when either input is missing. */
  viewsPerDay: number | null;
  /** views ÷ channelMedianViews. Null until the channel resolves. */
  outlierRatio: number | null;
}

/* ── Filters ─────────────────────────────────────────────────────────── */

export type DatePreset = 'any' | '24h' | '7d' | '30d' | '90d' | '1y' | 'custom';

export type SortKey = 'relevance' | 'vpd' | 'views' | 'date' | 'outlier';

export interface FilterState {
  datePreset: DatePreset;
  /** ISO yyyy-mm-dd, only meaningful when datePreset === 'custom'. */
  dateFrom: string | null;
  dateTo: string | null;
  viewsMin: number | null;
  viewsMax: number | null;
  vpdMin: number | null;
  vpdMax: number | null;
  subsMin: number | null;
  subsMax: number | null;
  /** Minutes, not seconds — the UI speaks minutes. */
  durationMinMinutes: number | null;
  durationMaxMinutes: number | null;
  excludeShorts: boolean;
  excludeLive: boolean;
  sort: SortKey;
}

export const EMPTY_FILTERS: FilterState = {
  datePreset: 'any',
  dateFrom: null,
  dateTo: null,
  viewsMin: null,
  viewsMax: null,
  vpdMin: null,
  vpdMax: null,
  subsMin: null,
  subsMax: null,
  durationMinMinutes: null,
  durationMaxMinutes: null,
  excludeShorts: false,
  excludeLive: false,
  sort: 'relevance',
};

export interface Preset {
  id: string;
  name: string;
  builtIn: boolean;
  filters: FilterState;
}

/* ── Channel enrichment ──────────────────────────────────────────────── */

export interface ChannelStats {
  channelKey: string;
  subscribers: number | null;
  medianViews: number | null;
  /** Epoch ms of the fetch, for TTL. */
  fetchedAt: number;
  /** True when the fetch failed; cached briefly so we stop retrying. */
  failed: boolean;
}

/* ── Messages ────────────────────────────────────────────────────────── */

export interface ChannelStatsRequest {
  type: 'YPF_CHANNEL_STATS';
  channelKey: string;
  channelUrl: string;
}

export interface ChannelStatsResponse {
  ok: boolean;
  stats?: ChannelStats;
  error?: string;
}

/* ── Local instrumentation ───────────────────────────────────────────── */

/**
 * Counter names for the local-only metrics in §8 of the PRD. Nothing here
 * leaves the machine and none of it identifies a video, channel or query.
 */
export type MetricKey =
  | 'filter.date'
  | 'filter.views'
  | 'filter.vpd'
  | 'filter.subs'
  | 'filter.duration'
  | 'filter.kind'
  | 'sort.changed'
  | 'preset.used'
  | 'filters.cleared'
  | 'enrich.ok'
  | 'enrich.fail'
  | 'selectors.miss'
  | 'search.filtered'
  | 'search.emptyResult';
