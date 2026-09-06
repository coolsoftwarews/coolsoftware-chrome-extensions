/**
 * The shared shapes for a capture card, a collection, and the backup format —
 * mirrors WebHighlighter's storage model (PageRecord ⇄ SavedPost), because this
 * product is the "Saver" pattern (see docs/extensions/README.md) wearing
 * Instagram's clothes.
 */

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

/** Ships with four collections, all renameable, plus "new collection" (PRD §4). */
export const DEFAULT_COLLECTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'hooks', name: 'Hooks' },
  { id: 'competitors', name: 'Competitors' },
  { id: 'ad-ideas', name: 'Ad Ideas' },
  { id: 'reel-ideas', name: 'Reel Ideas' },
];

export type MediaType = 'post' | 'reel';

export interface PostMetrics {
  views: number | null;
  likes: number | null;
  comments: number | null;
}

/** The capture card — what gets stored per saved post (PRD §4 field table). */
export interface SavedPost {
  /** Derived from the post URL's shortcode; stable across re-saves. */
  id: string;
  postUrl: string;
  creatorHandle: string;
  /** A size-capped data URI, or the remote CDN URL when the budget didn't hold (PRD §6). */
  thumbnail: string;
  thumbnailIsRemote: boolean;
  caption: string;
  postDate: string;
  /** First time this post was saved — preserved across re-saves. */
  savedAt: number;
  /** Last time this card's page data was refreshed. */
  updatedAt: number;
  note: string;
  collectionId: string;
  metrics: PostMetrics;
  /** Number of slides in a carousel; null when the post is not a carousel. */
  carouselCount: number | null;
  mediaType: MediaType;
}

/** What the content script scrapes from the page before it becomes a SavedPost. */
export interface RawCapture {
  postUrl: string;
  creatorHandle: string;
  thumbnailDataUri: string | null;
  thumbnailRemoteUrl: string;
  captionRaw: string;
  postDateRaw: string;
  viewsRaw: string | null;
  likesRaw: string | null;
  commentsRaw: string | null;
  carouselCount: number | null;
  mediaType: MediaType;
}

export interface Backup {
  format: 'instagram-research-saver';
  version: 1;
  exportedAt: string;
  posts: SavedPost[];
  collections: Collection[];
}

export interface ImportResult {
  posts: number;
  collections: number;
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export type ExportFormat = 'csv' | 'md' | 'json';
