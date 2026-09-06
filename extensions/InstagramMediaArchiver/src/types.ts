/**
 * Shared shapes: a media kind, one archived-media log entry, the export
 * backup format, and the message pair between content.ts and background.ts.
 *
 * The log records only what was saved — URL, filename, date, media type —
 * never the media itself (PRD §4/§6), so chrome.storage.local stays far
 * under quota.
 */

export type MediaKind = 'image' | 'video';

/** One row in the local archive log (PRD §4: "post URL, date, media type,
 *  saved filename"). */
export interface LogEntry {
  /** `${postId}-${index}` — stable across re-saves of the same slide. */
  id: string;
  postUrl: string;
  postId: string;
  handle: string;
  mediaKind: MediaKind;
  filename: string;
  savedAt: number;
}

export interface Backup {
  format: 'instagram-media-archiver';
  version: 1;
  exportedAt: string;
  entries: LogEntry[];
}

export type ExportFormat = 'csv' | 'json';

/**
 * content.ts has no access to chrome.downloads — only extension pages and
 * the service worker do — so a click on an (ownership-gated) Save button
 * sends this to background.ts, which performs the actual download and logs
 * it once the download has started.
 */
export interface SaveMediaRequest {
  type: 'IMA_SAVE_MEDIA';
  mediaUrl: string;
  filename: string;
  entry: LogEntry;
}

export interface SaveMediaResponse {
  ok: boolean;
  error?: string;
}
