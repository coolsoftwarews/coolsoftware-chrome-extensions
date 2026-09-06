/**
 * Shared shapes. Nothing here holds DOM references — those live only inside
 * scan.ts / badge.ts / drawer.ts, which are the DOM-bound half of this
 * extension and cannot be unit tested the way this file's consumers can.
 */

/* ── Commercial markers (PRD §4: "heuristics, not facts") ───────────────── */

export type MarkerType = 'shop_link' | 'product_tag' | 'bio_link' | 'discount_code' | 'shop_language';

/** 'verified' markers come from TikTok's own shop UI; 'heuristic' ones are caption text guesses. */
export type MarkerConfidence = 'verified' | 'heuristic';

export interface Marker {
  type: MarkerType;
  confidence: MarkerConfidence;
  label: string;
}

/* ── Outlier engine (README "Shared modules": median baseline, ratio badges, sample-size honesty) ── */

export interface CreatorBaseline {
  handle: string;
  /** Median view count across the creator's own recent videos, as last observed on their profile. */
  median: number;
  /** How many of the creator's videos contributed to that median. */
  sampleSize: number;
  updatedAt: number;
}

export type OutlierConfidence = 'pending' | 'low-sample' | 'reliable';

export interface OutlierResult {
  /** null until a baseline exists for this creator (PRD §5: "pending until then, rather than guessing"). */
  ratio: number | null;
  confidence: OutlierConfidence;
}

/* ── Videos ───────────────────────────────────────────────────────────── */

export type SourceContext = 'feed' | 'search' | 'hashtag' | 'profile' | 'video' | 'unknown';

/** A video as read off the page right now. Never persisted on its own — only
 * videos the user chooses to track are written to storage (PRD §4: coverage
 * is what the user scrolled, not a stored copy of everything rendered). */
export interface ScannedVideo {
  id: string;
  url: string;
  creatorHandle: string;
  caption: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  /** ISO date when derivable, otherwise the relative string TikTok printed ("3d ago"). */
  publishedAt: string | null;
  markers: Marker[];
  context: SourceContext;
}

/** The snapshot kept once a video is added to a tracked product. */
export interface TrackedVideo {
  id: string;
  url: string;
  creatorHandle: string;
  views: number | null;
  likes: number | null;
  comments: number | null;
  publishedAt: string | null;
  markers: Marker[];
  /** When the user tracked it — used for the board's "first / last seen" dates. */
  addedAt: number;
}

export type ProductGroupType = 'shop' | 'caption' | 'manual';

export interface Product {
  id: string;
  name: string;
  groupType: ProductGroupType;
  /** Normalized key used to auto-merge future videos into this product (shop item id, caption keyword). */
  groupKey: string;
  videos: TrackedVideo[];
  createdAt: number;
  updatedAt: number;
}

/* ── Computed / display ──────────────────────────────────────────────── */

export interface ProductStats {
  product: Product;
  /** Videos remaining after the panel's current filters are applied. */
  visibleVideos: TrackedVideo[];
  distinctCreators: number;
  medianRatio: number | null;
  firstSeen: number | null;
  lastSeen: number | null;
  pendingBaselines: number;
}

export interface BoardFilters {
  minRatio: number | null;
  onlyCommercial: boolean;
  /** Days: 7, 30, 90, or null for "all time". */
  withinDays: 7 | 30 | 90 | null;
  minViews: number | null;
}

export const DEFAULT_FILTERS: BoardFilters = {
  minRatio: null,
  onlyCommercial: false,
  withinDays: null,
  minViews: null,
};

/* ── Coverage (PRD §5: "say this in the UI") ─────────────────────────── */

export interface CoverageState {
  videosViewedTotal: number;
  /** Bounded ring buffer of recently seen ids, used only to avoid double-counting recycled feed tiles. */
  recentIds: string[];
}

/* ── Messages: content script (page) ⇄ background (toggle only) ─────── */

export type BackgroundToContent = { type: 'TPS_TOGGLE_BOARD' };
