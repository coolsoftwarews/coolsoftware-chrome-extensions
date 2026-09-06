/**
 * The shared shapes for a capture card, a collection, and the backup format —
 * this product is the "Saver" pattern from docs/extensions/README.md
 * (see WebHighlighter's PageRecord and InstagramResearchSaver's SavedPost for
 * the sibling shapes) wearing Pinterest's clothes.
 */

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

/** Ships with four collections, all renameable (PRD §4). */
export const DEFAULT_COLLECTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'competitors', name: 'Competitors' },
  { id: 'title-patterns', name: 'Title patterns' },
  { id: 'product-framing', name: 'Product framing' },
  { id: 'design-ideas', name: 'Design ideas' },
];

export type CapturedFrom = 'grid' | 'detail';

/** The capture card — what gets stored per saved pin (PRD §4 field table). */
export interface PinCapture {
  /** Derived from the pin's numeric id in its URL; stable across re-saves. */
  id: string;
  pinUrl: string;
  /** A size-capped data URI, or the remote CDN URL when capture didn't hold (PRD §6). */
  imageUrl: string;
  imageIsRemote: boolean;
  title: string;
  description: string;
  /** True when the description could not be confirmed complete (PRD §6). */
  descriptionTruncated: boolean;
  destinationDomain: string;
  destinationUrl: string;
  boardName: string;
  creator: string;
  /** Saves count exactly as Pinterest displayed it — format varies by region, kept as text. */
  savesRaw: string;
  capturedFrom: CapturedFrom;
  /** ISO date (YYYY-MM-DD) the pin was first seen/captured. */
  dateSeen: string;
  /** First time this pin was saved — preserved across re-saves. */
  savedAt: number;
  /** Last time this card's page data was refreshed. */
  updatedAt: number;
  note: string;
  collectionId: string;
}

/** What the content script scrapes from the page before it becomes a PinCapture. */
export interface RawCapture {
  pinUrl: string;
  imageDataUri: string | null;
  imageRemoteUrl: string;
  titleRaw: string;
  descriptionRaw: string;
  descriptionTruncated: boolean;
  destinationDomainRaw: string;
  destinationUrlRaw: string;
  boardNameRaw: string;
  creatorRaw: string;
  savesRaw: string;
  capturedFrom: CapturedFrom;
}

export interface Backup {
  format: 'pinterest-competitor-research';
  version: 1;
  exportedAt: string;
  pins: PinCapture[];
  collections: Collection[];
}

export interface ImportResult {
  pins: number;
  collections: number;
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export interface DomainGroup {
  domain: string;
  count: number;
  pins: PinCapture[];
}

export type ExportFormat = 'csv' | 'md' | 'json';
