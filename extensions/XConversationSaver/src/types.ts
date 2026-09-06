/**
 * The shared shapes for a capture card, a collection, and the backup format —
 * this product is the "Saver" pattern from docs/extensions/README.md
 * (same shape as WebHighlighter's storage layer and Instagram Research Saver)
 * wearing X's clothes: a post is a card, a thread is a card with several posts.
 */

export interface Collection {
  id: string;
  name: string;
  createdAt: number;
}

/** Ships with four collections, all renameable (PRD §4). No add/delete in V1 —
 *  the PRD only asks for renameable defaults, and this product stays narrow. */
export const DEFAULT_COLLECTIONS: ReadonlyArray<{ id: string; name: string }> = [
  { id: 'hooks', name: 'Hooks' },
  { id: 'prospects', name: 'Prospects' },
  { id: 'ideas', name: 'Ideas' },
  { id: 'reference', name: 'Reference' },
];

/** A conversation is a thread with more than one author (PRD §8 edge case). */
export type ItemKind = 'post' | 'thread' | 'conversation';

export interface PostMetrics {
  replies: number | null;
  reposts: number | null;
  likes: number | null;
  views: number | null;
}

export interface QuotedPost {
  author: string;
  handle: string;
  text: string;
}

/** One captured post — a thread/conversation card holds several of these. */
export interface CapturedPost {
  /** The status id parsed from the post's permalink. Stable across re-saves. */
  id: string;
  author: string;
  handle: string;
  text: string;
  url: string;
  /** ISO datetime from the post's `<time datetime>` attribute, or '' if absent. */
  postDate: string;
  metrics: PostMetrics;
  quoted: QuotedPost | null;
  mediaCount: number;
  /** A reference to the first media item's remote URL — never downloaded or
   *  fetched by the extension (PRD §4: "no media download beyond a thumbnail"). */
  thumbnail: string;
}

/** The capture card — what gets stored per save (PRD §4). */
export interface SavedItem {
  /** The root/first post's id. Stable across re-saves, so saving the same
   *  post twice updates this card instead of duplicating it (PRD §8). */
  id: string;
  kind: ItemKind;
  posts: CapturedPost[];
  /** Unique handles across `posts`, in first-seen order. */
  authors: string[];
  collectionId: string;
  note: string;
  /** True when a "Show more replies" affordance was visible and not expanded
   *  at capture time (PRD §6/§11 — default to what's rendered, report the
   *  honest partial rather than a silently truncated thread). */
  truncated: boolean;
  /** First time this card was saved — preserved across re-saves. */
  savedAt: number;
  /** Last time this card's captured content was refreshed. */
  updatedAt: number;
}

export interface PersonNote {
  handle: string;
  note: string;
  updatedAt: number;
}

export interface Backup {
  format: 'x-conversation-saver';
  version: 1;
  exportedAt: string;
  items: SavedItem[];
  collections: Collection[];
  people: PersonNote[];
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export type ExportFormat = 'csv' | 'md' | 'json';

/** The panel learns about a save the content script just made through this. */
export type ContentToPanel = { type: 'XCS_ITEM_SAVED'; id: string; kind: ItemKind };
