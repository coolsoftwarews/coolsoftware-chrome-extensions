/**
 * Shared types for Meta Ad Winner.
 *
 * The product's entire premise (PRD §4) is that the Ad Library already
 * contains the answer — longevity — and just doesn't rank by it. So the core
 * type here is a "computed ad": whatever the Library rendered, plus the three
 * numbers the Library doesn't show (days running, variant count, group).
 */

export type AdFormat = 'image' | 'video' | 'carousel' | 'unknown';
export type AdStatus = 'active' | 'stopped';

/** What the page parser can read directly off one ad card, before any math. */
export interface RawAd {
  /** Meta's own "Library ID" — stable, unique, printed on every card. */
  libraryId: string;
  advertiser: string;
  /** Body copy, normalized whitespace but otherwise verbatim. */
  bodyText: string;
  /** Registered domain of the landing page link, e.g. "example.com". */
  landingDomain: string;
  /** ISO date (YYYY-MM-DD) the ad started running. */
  startDate: string | null;
  /** ISO date it stopped, or null if it's still active. */
  stopDate: string | null;
  status: AdStatus;
  format: AdFormat;
  thumbnailUrl: string | null;
  /** Deep link back to this ad's page in the Ad Library. */
  libraryUrl: string;
  /** The library's own "Ads shown in <region>" line, verbatim. */
  region: string;
}

/** A RawAd plus the three numbers that are this product's whole point. */
export interface ComputedAd extends RawAd {
  daysRunning: number;
  variantGroupId: string;
  variantCount: number;
}

export interface VariantGroup {
  id: string;
  members: ComputedAd[];
}

export type SortKey = 'days' | 'variants' | 'start';

export interface FilterState {
  minDays: number;
  activeOnly: boolean;
  minVariants: number;
  format: AdFormat | 'all';
}

export const DEFAULT_FILTERS: FilterState = {
  minDays: 0,
  activeOnly: false,
  minVariants: 0,
  format: 'all',
};

export const DEFAULT_SORT: SortKey = 'days';

/* ── Swipe file (the Saver) ──────────────────────────────────────────── */

export interface SavedAd {
  id: string;
  savedAt: number;
  collectionId: string | null;
  note: string;
  advertiser: string;
  adText: string;
  landingDomain: string;
  startDate: string | null;
  daysRunning: number;
  variantCount: number;
  format: AdFormat;
  status: AdStatus;
  thumbnailUrl: string | null;
  libraryUrl: string;
}

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

export interface Backup {
  format: 'facebook-ad-winner';
  version: 1;
  exportedAt: string;
  items: SavedAd[];
  collections: Collection[];
}

export interface ImportResult {
  items: number;
  collections: number;
}

/* ── Export ──────────────────────────────────────────────────────────── */

export type ExportFormat = 'csv' | 'md' | 'json';
export type ExportScope = 'results' | 'swipefile';

/* ── Messages (content script ⇄ background) ─────────────────────────── */

export type ContentToBackground = {
  type: 'FAW_DOWNLOAD';
  filename: string;
  mime: string;
  content: string;
};

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}
