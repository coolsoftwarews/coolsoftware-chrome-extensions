/**
 * Shared shapes. See PRD-20 §4–7 for the vocabulary these mirror: "niche
 * read", "concentration", "price band", "freshness".
 */

export type PageKind = 'search' | 'category';

/** What a per-listing count badge is actually showing — never mix the two. */
export type CountKind = 'sales' | 'reviews' | null;

/**
 * One listing card as read off the page. Every field is "what Etsy rendered",
 * never an API response — there is no Etsy API call anywhere in this
 * extension (PRD-20 §5, §6).
 */
export interface Listing {
  /** Etsy's own listing id when readable, else a stable hash of title+shop+href. */
  id: string;
  title: string;
  url: string;
  /** Numeric price in the listing's own currency, or null if unreadable. */
  price: number | null;
  /** Currency symbol/prefix as printed (e.g. "£", "$", "€"), '' if unknown. */
  currency: string;
  /** True when the card shows "From £x" / a low–high range rather than one price. */
  priceIsRange: boolean;
  shopName: string;
  /** True for a promoted/sponsored card — excluded from stats, kept for display (PRD-20 §5, §7). */
  isAd: boolean;
  /** Which count the badge is showing, so a median never silently mixes sales and reviews. */
  countKind: CountKind;
  count: number | null;
  /** Best-effort "Digital download" detection; unknown listings count as physical. */
  isDigital: boolean;
  /** The page (1-based) this card was read from, for the pagination sample note. */
  page: number;
}

/** The two page types this extension reads (PRD-20 §5). */
export interface PageContext {
  kind: PageKind;
  /** Search query text, or the category's display label. */
  query: string;
  /** Normalized, stable key used for caching and snapshots — see url.ts. */
  queryKey: string;
  page: number;
}

export interface ShopShare {
  shop: string;
  count: number;
  pct: number;
}

/**
 * The numbers behind the strip. Computed fresh on every extraction — nothing
 * here is ever sent anywhere, it just drives the in-page UI and exports.
 */
export interface NicheStats {
  query: string;
  queryKey: string;
  generatedAt: number;

  sampleListings: number;
  organicListings: number;
  adListings: number;
  samplePages: number;

  distinctShops: number;
  topShops: ShopShare[];
  /** Combined share of the top 3 shops among organic listings, 0–100. */
  top3Pct: number | null;

  /** Which count (sales or reviews) the median below is built from. */
  medianCountKind: CountKind;
  medianCount: number | null;
  /** True when the sample mixes sales-labelled and review-labelled cards. */
  mixedCountKinds: boolean;
  zeroCountListings: number;

  currency: string;
  currencyMixed: boolean;
  medianPrice: number | null;
  priceBandLow: number | null;
  priceBandHigh: number | null;
  variablePriceListings: number;

  digitalListings: number;
  physicalListings: number;
}

export interface TagCount {
  tag: string;
  count: number;
}

export interface TagTable {
  tags: TagCount[];
  /** Number of titles the tag counts were drawn from. */
  sampleSize: number;
}

export interface Filters {
  maxSales: number | null;
  minPrice: number | null;
  maxPrice: number | null;
  shop: string | null;
  organicOnly: boolean;
}

export const DEFAULT_FILTERS: Filters = {
  maxSales: null,
  minPrice: null,
  maxPrice: null,
  shop: null,
  organicOnly: false,
};

/** A user-triggered "+ Save niche" capture (PRD-20 §4). Never created automatically. */
export interface Snapshot {
  savedAt: number;
  stats: NicheStats;
}

export interface SnapshotRecord {
  queryKey: string;
  query: string;
  snapshots: Snapshot[];
}

/** Delta shown when returning to a query that already has a saved snapshot. */
export interface SnapshotDelta {
  daysSince: number;
  medianCountDelta: number | null;
  medianPriceDelta: number | null;
  top3PctDelta: number | null;
  /** True when the count kind changed between saves — delta is not comparable. */
  countKindChanged: boolean;
}

/* ── Messages (panel <-> content, content -> background) ─────────────── */

export type PanelToContent =
  | { type: 'ENF_GET_STATE' }
  | { type: 'ENF_APPLY_FILTERS'; filters: Filters }
  | { type: 'ENF_SAVE_SNAPSHOT' }
  | { type: 'ENF_EXPORT'; format: 'csv' | 'md' };

export interface ContentState {
  supported: boolean;
  reason: string | null;
  context: PageContext | null;
  stats: NicheStats | null;
  tags: TagTable | null;
  listings: Listing[];
  filters: Filters;
  filteredCount: number;
  delta: SnapshotDelta | null;
}

export type ContentToPanel = { type: 'ENF_STATE_CHANGED' };

export type ContentToBackground = {
  type: 'ENF_DOWNLOAD';
  filename: string;
  mime: string;
  content: string;
};
