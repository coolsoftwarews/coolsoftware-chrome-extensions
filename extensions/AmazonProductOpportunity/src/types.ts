/**
 * A listing is read directly off a rendered Amazon results page — nothing here
 * is fetched, estimated or modelled (PRD §4: no sales/revenue/BSR estimates,
 * ever). Every field is either "what the page printed" or `null` when this
 * layout/locale did not print it.
 */
export interface ListingSnapshot {
  asin: string;
  /** 0-based order the card appeared in on this page. */
  position: number;
  title: string;
  /** Best-effort "by <brand>" read; null when the card does not expose one. */
  brand: string | null;
  price: number | null;
  priceRaw: string | null;
  currency: string | null;
  /** 0–5. */
  rating: number | null;
  reviewCount: number | null;
  /** null = Prime/FBA status not readable on this layout/locale (PRD §7). */
  prime: boolean | null;
  /** Sponsored slots are excluded from category stats, never from the list. */
  sponsored: boolean;
  url: string | null;
}

export interface SearchSnapshot {
  /** Hostname with a leading "www." stripped, e.g. "amazon.co.uk". */
  marketplace: string;
  /** The "k" query param, or a category breadcrumb fallback. */
  query: string;
  /** marketplace + query, lowercased — the watchlist / dedupe key. */
  canonicalKey: string;
  capturedAt: string;
  page: number;
  url: string;
  listings: ListingSnapshot[];
}

export type MoatLabel = 'light' | 'moderate' | 'strong' | 'unknown';
export type CeilingLabel = 'soft' | 'moderate' | 'strong' | 'unknown';
export type ConcentrationLabel = 'fragmented' | 'moderate' | 'concentrated' | 'unknown';

export interface CategoryStats {
  /** Organic listings, deduped by ASIN — what the "category read" describes. */
  totalListings: number;
  sponsoredExcluded: number;
  /** Listings whose brand could not be read; shown so the count is honest. */
  brandUnknown: number;
  medianReviews: number | null;
  medianRating: number | null;
  distinctBrands: number;
  moat: MoatLabel;
  ratingCeiling: {
    label: CeilingLabel;
    underThreshold: number;
    sample: number;
    threshold: number;
  };
  concentration: {
    label: ConcentrationLabel;
    topBrand: string | null;
    topBrandShare: number | null;
  };
}

export interface FilterState {
  maxReviews: number | null;
  /** Flag listings rated below this value as a rating gap / opportunity. */
  minRatingGap: number | null;
  priceMin: number | null;
  priceMax: number | null;
  /** Case-insensitive substring match against `brand`. */
  brand: string | null;
}

export const EMPTY_FILTERS: FilterState = {
  maxReviews: null,
  minRatingGap: null,
  priceMin: null,
  priceMax: null,
  brand: null,
};

export interface FilteredListing {
  listing: ListingSnapshot;
  matches: boolean;
  /** True when this listing is both low-review and under the rating gap — a candidate opening. */
  opportunity: boolean;
}

/* ── Watchlist ───────────────────────────────────────────────────────── */

export interface SearchWatchSnapshot {
  capturedAt: string;
  resultCount: number;
  medianReviews: number | null;
  medianRating: number | null;
  distinctBrands: number;
}

export interface SearchWatch {
  key: string;
  marketplace: string;
  query: string;
  url: string;
  createdAt: string;
  snapshots: SearchWatchSnapshot[];
}

export interface ProductWatchSnapshot {
  capturedAt: string;
  price: number | null;
  rating: number | null;
  reviewCount: number | null;
  prime: boolean | null;
}

export interface ProductWatch {
  asin: string;
  marketplace: string;
  title: string;
  url: string;
  createdAt: string;
  snapshots: ProductWatchSnapshot[];
}

export interface WatchDelta {
  sinceLabel: string;
  reviewsDelta: number | null;
  ratingDelta: number | null;
  priceDelta: number | null;
  resultCountDelta: number | null;
}

/* ── Export ──────────────────────────────────────────────────────────── */

export type ExportFormat = 'csv' | 'md';

/* ── Local usage counters ───────────────────────────────────────────── */

export type MetricEvent =
  | 'overlay_rendered'
  | 'search_analyzed'
  | 'filters_applied'
  | 'watch_search_added'
  | 'watch_product_added'
  | 'watch_removed'
  | 'export_results_csv'
  | 'export_results_md'
  | 'export_watchlist_csv'
  | 'export_watchlist_md'
  | 'data_exported'
  | 'data_imported'
  | 'popup_opened';

/* ── Messages (content script ⇄ popup) ─────────────────────────────── */

export type ContentToRuntime = { type: 'APO_SNAPSHOT_READY'; snapshot: SearchSnapshot };

export type PopupToContent =
  | { type: 'APO_GET_SNAPSHOT' }
  | { type: 'APO_APPLY_FILTERS'; filters: FilterState };

export type ContentToPopup = { type: 'APO_SNAPSHOT'; snapshot: SearchSnapshot | null; stats: CategoryStats | null };
