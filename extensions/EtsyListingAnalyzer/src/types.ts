/**
 * A "teardown" is everything the panel shows about one listing (PRD §4). It is
 * built once per page view from whatever is on the page — nothing is fetched,
 * nothing is crawled, and any field Etsy doesn't expose comes back `null`
 * rather than guessed (PRD §7 edge cases).
 */

export interface TitleAnalysis {
  text: string;
  wordCount: number;
  charCount: number;
  /** null when there are no tags to check the title against. */
  frontLoaded: boolean | null;
}

export interface TagsAnalysis {
  /** Etsy caps listings at 13 tags; this is how many the seller used. */
  count: number;
  max: number;
  tags: string[];
}

export interface PhotosAnalysis {
  count: number | null;
  hasVideo: boolean;
}

export interface PriceAnalysis {
  /** ISO 4217 code as printed by the page (e.g. "GBP"). Never converted. */
  currency: string | null;
  min: number | null;
  max: number | null;
  isRange: boolean;
  freeShipping: boolean;
  /** Digital downloads have no shipping fields at all (PRD §7). */
  isDigital: boolean;
}

export interface OptionsAnalysis {
  variationCount: number;
  hasPersonalization: boolean;
}

export interface SalesAnalysis {
  /** Purchases shown on the listing itself, distinct from shop-wide sales. */
  purchases: number | null;
  rating: number | null;
  reviewCount: number | null;
}

export interface ShopAnalysis {
  name: string | null;
  establishedYear: number | null;
  totalSales: number | null;
  location: string | null;
}

export interface ListingStatus {
  soldOut: boolean;
  deactivated: boolean;
}

export interface Teardown {
  listingId: string;
  url: string;
  capturedAt: number;
  title: TitleAnalysis;
  tags: TagsAnalysis;
  photos: PhotosAnalysis;
  price: PriceAnalysis;
  options: OptionsAnalysis;
  sales: SalesAnalysis;
  shop: ShopAnalysis;
  status: ListingStatus;
  /** Field labels the extractor could not find — shown so the panel never
   *  silently pretends a missing field is a zero (PRD §7: Etsy layout changes). */
  unavailable: string[];
}

export interface SavedTeardown {
  listingId: string;
  note: string;
  /** Chronological snapshots for this listing; latest last. */
  snapshots: Teardown[];
  updatedAt: number;
}

export interface CompareTray {
  entries: Teardown[];
}

export const TRAY_LIMIT = 6;
export const TAG_RECURRENCE_MIN_SAMPLE = 4;

/* ── Messages (panel overlay ⇄ content script) ───────────────────────── */

export type PanelCommand =
  | { type: 'ELA_TOGGLE_PANEL' };
