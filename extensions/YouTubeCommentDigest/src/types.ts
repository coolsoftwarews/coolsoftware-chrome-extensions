/** A single top-level comment, flattened (PRD §4 — replies are a count badge, never expanded). */
export interface Comment {
  /** Stable within one panel session: a content hash, not a YouTube id (see comment.ts). */
  id: string;
  author: string | null;
  authorUrl: string | null;
  text: string;
  /** null when the like count could not be parsed — the comment still shows (PRD §5). */
  likeCount: number | null;
  /** null when no reply-count text was found or it could not be parsed. */
  replyCount: number | null;
  publishedText: string | null;
  /** Coarse epoch estimate from publishedText, for the "newest first" sort. null if unparseable. */
  publishedAt: number | null;
  pinned: boolean;
  hearted: boolean;
  /** Position in the DOM at scan time — the basis for the "top" sort. */
  domOrder: number;
}

export type SortMode = 'top' | 'likes' | 'replies' | 'newest';

export const SORT_MODES: SortMode[] = ['top', 'likes', 'replies', 'newest'];

export interface VideoMeta {
  videoId: string | null;
  title: string | null;
  channel: string | null;
}

/**
 * What the content script hands the panel. `supported` is false on anything
 * that isn't a YouTube watch page; `commentsDisabled` is a distinct state from
 * "supported but zero comments loaded yet" (PRD §7).
 */
export interface PanelState {
  supported: boolean;
  meta: VideoMeta;
  commentsDisabled: boolean;
  comments: Comment[];
  /** YouTube's own "1,234 Comments" header text, when readable — never a promise of completeness. */
  declaredTotalText: string | null;
}

export interface WordFreqEntry {
  term: string;
  count: number;
  /** Distinct comments the term appears in — a term one comment repeats 40x should not look like 40 comments agree. */
  commentCount: number;
}

export interface WordFreqResult {
  words: WordFreqEntry[];
  phrases: WordFreqEntry[];
}

export type ExportFormat = 'md' | 'csv';

/* ── Messages (panel ⇄ content script) ───────────────────────────────── */

export type PanelToContent =
  | { type: 'YCD_GET_STATE' }
  | { type: 'YCD_LOAD_MORE' }
  | { type: 'YCD_SCROLL_TO'; id: string };

export type ContentToPanel = { type: 'YCD_STATE_CHANGED' };
