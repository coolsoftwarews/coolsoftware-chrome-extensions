/**
 * The shared shapes for an indexed bookmark, a folder (collection), and the
 * backup format — this product is the "Saver" pattern from
 * docs/extensions/README.md (same shape as WebHighlighter's and
 * XConversationSaver's storage layers) wearing X's Bookmarks page: a
 * bookmark is a single-post card, never a thread.
 */

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

/** Ships with four folders, all renameable — plus "new folder" (PRD §4: "lets
 *  them tag/fold bookmarked posts into local collections"). Unlike
 *  XConversationSaver's fixed four, this PRD explicitly treats folders as a
 *  core organizing primitive a bookmark-heavy user needs to grow over time. */
export const DEFAULT_COLLECTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'read-later', name: 'Read later' },
  { id: 'reference', name: 'Reference' },
  { id: 'favorites', name: 'Favorites' },
  { id: 'research', name: 'Research' },
];

export interface BookmarkMetrics {
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  views: number | null;
}

/** What scrape.ts reads off one bookmarked post — the DOM-bound half. */
export interface BookmarkPost {
  /** The status id parsed from the post's permalink. Stable across re-index passes. */
  id: string;
  author: string;
  handle: string;
  text: string;
  url: string;
  /** ISO datetime from the post's `<time datetime>` attribute, or '' if absent. */
  postDate: string;
  metrics: BookmarkMetrics;
  mediaCount: number;
  /** A reference to the first media item's remote URL — never downloaded or
   *  fetched by the extension (PRD §7: only a thumbnail URL is stored). */
  thumbnail: string;
}

/** The indexed card — what gets stored per bookmark (PRD §4). */
export interface BookmarkItem {
  /** The root post's status id. Stable across re-index passes, so indexing
   *  the same bookmark again updates this card instead of duplicating it
   *  (PRD §7: "duplicate indexing on re-scroll"). */
  id: string;
  post: BookmarkPost;
  tags: string[];
  collectionId: string;
  note: string;
  /** First time this bookmark was indexed. Preserved across re-index passes. */
  indexedAt: number;
  /** The most recent indexing *session's* start time this item was observed
   *  in (see capture.ts#isPossiblyRemoved) — not a per-scan-tick timestamp,
   *  so items seen earlier in the same scroll session are never mistaken for
   *  stale ones. */
  lastSeenAt: number;
  /** Last time this card's own captured post content changed. */
  updatedAt: number;
}

export interface Backup {
  format: 'x-bookmark-organizer';
  version: 1;
  exportedAt: string;
  items: BookmarkItem[];
  collections: Collection[];
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export type ExportFormat = 'csv' | 'md' | 'json';

export interface PanelOptions {
  /** The start time of the most recently completed indexing session on the
   *  Bookmarks page — the staleness comparison point for
   *  capture.ts#isPossiblyRemoved. Null until the user has visited Bookmarks
   *  with the extension installed at least once. */
  lastReindexAt: number | null;
}

/** Command sent from the panel to the content script to start a bounded
 *  auto-scroll re-index pass (PRD §4/§10 — user-triggered, foreground only,
 *  never a background crawl). */
export type PanelToContent =
  | { type: 'XBO_START_REINDEX'; screens: number };

/** One-way status ping from the content script back to an open panel. The
 *  content script is only ever injected on the Bookmarks page itself (see
 *  content_scripts.matches in scripts/build.mjs), so if the active tab isn't
 *  there, sendMessage simply has no receiver — the panel catches that and
 *  shows its own "open your Bookmarks page" hint rather than needing a
 *  reply message for it. */
export type ContentToPanel = { type: 'XBO_REINDEX_DONE'; scrolled: number; wrongTab?: boolean };
