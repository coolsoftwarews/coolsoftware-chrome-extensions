/**
 * Shared shapes for a live unroll session. There is deliberately no "saved
 * item"/"library" type in this file — PRD-25 §4 keeps this product to a
 * current reading view only (no bookmarking; that's XConversationSaver's
 * job, PRD-13). The only thing that persists across sessions at all is the
 * export-format preference in storage.ts.
 */

export interface UnrolledPost {
  /** The status id parsed from the post's permalink. Empty for a deleted
   *  placeholder — see `deleted` below. */
  id: string;
  author: string;
  handle: string;
  /** Remote avatar URL, rendered via <img>, never fetched by extension code
   *  (same posture XConversationSaver already ships for thumbnails). */
  avatarUrl: string;
  text: string;
  /** ISO datetime from the post's <time datetime> attribute, or '' if absent. */
  postDate: string;
  url: string;
  media: {
    count: number;
    /** "1 image" / "2 images" / "1 video" / '' — a label, never the file. */
    label: string;
    thumbnailUrl: string;
  };
  quoted: { author: string; handle: string; text: string } | null;
  /** True for a synthetic gap the extractor inserted where X showed a
   *  "this post is unavailable" placeholder mid-thread (PRD-25 §7). Every
   *  other field is empty on a deleted placeholder. */
  deleted: boolean;
}

export type SessionStatus = 'collecting' | 'done' | 'capped' | 'error';

export interface ThreadSession {
  /** The root post's id — lets the panel tell "still the same thread" from
   *  "a new Unroll click started". */
  key: string;
  rootAuthor: string;
  rootHandle: string;
  posts: UnrolledPost[];
  status: SessionStatus;
  /** X's own "Show more replies" affordance was seen and not expanded. */
  truncated: boolean;
  /** The 200-post safety cap (PRD-25 §7) was hit. */
  cappedAt200: boolean;
  errorMessage?: string;
  startedAt: number;
}

export type ExportFormat = 'md' | 'txt';

export interface Options {
  exportFormat: ExportFormat;
}

export const DEFAULT_OPTIONS: Options = { exportFormat: 'md' };

/* ── Messages ────────────────────────────────────────────────────────── */

/** Content script → every extension page (broadcast via chrome.runtime.sendMessage).
 *  The panel filters on `sender.tab.id` matching the tab it's bound to, so a
 *  second open X tab's unroll never bleeds into this one's panel. */
export type ContentToPanel = { type: 'XTU_THREAD_UPDATE'; session: ThreadSession };

/** Panel → one tab's content script (targeted via chrome.tabs.sendMessage). */
export type PanelToContent =
  | { type: 'XTU_REQUEST_STATE' }
  | { type: 'XTU_STOP' };

/** Content script → background (asks it to open the side panel — content
 *  scripts have no chrome.sidePanel access of their own). */
export type ContentToBackground = { type: 'XTU_OPEN_PANEL' };
