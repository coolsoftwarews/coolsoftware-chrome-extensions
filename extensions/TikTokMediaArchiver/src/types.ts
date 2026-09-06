/**
 * Shared shapes. Nothing here holds a DOM reference — those live only in
 * scrape.ts, the DOM-bound half of this extension that cannot be unit
 * tested the way this file's consumers can (see scrape.ts's header comment
 * and README.md's manual test checklist).
 */

/** One entry in the local save log (PRD-45 §4). The media file itself is
 *  never stored here — only a record that it was saved, matching the
 *  "Storage: Log only, never the media itself" requirement in PRD-45 §6. */
export interface LogEntry {
  /** The post id, used as the storage key so re-saving the same post updates
   *  its log entry instead of duplicating it. */
  id: string;
  postUrl: string;
  /** Author handle, normalized (no leading "@", lower-cased) — see parse.ts#normalizeHandle. */
  handle: string;
  postId: string;
  filename: string;
  savedAt: number;
}

export type ExportFormat = 'csv' | 'json';

/** content.ts → background.ts. Content scripts cannot call chrome.downloads
 *  directly (it is not in the content-script API surface), so the two
 *  network-free privileged actions this extension needs — writing the video
 *  file the page's own player already loaded, and writing an export of the
 *  local log — are relayed through the service worker. */
export type ContentToBackground =
  | { type: 'TMA_DOWNLOAD'; url: string; filename: string }
  | { type: 'TMA_EXPORT'; text: string; filename: string; mime: 'text/csv' | 'application/json' };

export type BackgroundToContentResult =
  | { ok: true; downloadId: number }
  | { ok: false; error: string };

/** Toolbar icon / keyboard command → content script: toggle the on-page
 *  saved-videos log (there is no separate popup or side-panel page — see
 *  scripts/build.mjs's header comment on why the permission list stays
 *  narrow). */
export type BackgroundToContent = { type: 'TMA_TOGGLE_LOG' };
