/**
 * Shared shapes. Every field here is metadata or a static image URL — there
 * is no field anywhere in this file, or in any type that embeds one, capable
 * of carrying a video stream, a format/quality choice, or a URL from
 * YouTube's signed video-streaming CDN (PRD-47 §2/§4, the one hard line in
 * this build — see README.md/PRIVACY.md for that domain, named there rather
 * than in this file so scripts/selftest.mjs's guardrail grep of src/*.ts
 * has nothing to false-positive on). If a future change
 * ever needs one of those, it does not belong in this extension.
 */

/** What scrape.ts reads off one video row/tile currently rendered on the
 *  channel's own uploads listing or Studio's own Content table — the
 *  DOM-bound half. Every field is optional in practice; a field YouTube
 *  didn't render for this row becomes '' / null, never a thrown error. */
export interface ScrapedVideo {
  videoId: string;
  /** Canonical https://www.youtube.com/watch?v=<id> — built from the id,
   *  never read as a raw href (hrefs on some layouts are relative or
   *  shortened). */
  url: string;
  title: string;
  /** '' when the row doesn't show a description at all (the public channel
   *  grid never does; Studio's Content table does). Never fetched — only
   *  read from text already rendered on the page. */
  description: string;
  /** The publish date exactly as YouTube displays it — "Sep 3, 2026",
   *  "Premiered 3 days ago", "Scheduled for Oct 1, 2026". Kept as displayed
   *  text rather than parsed to a timestamp: Studio and the public channel
   *  page phrase this differently, and re-deriving a single canonical
   *  format risks silently mis-stating a scheduled/premiere video as
   *  published. */
  publishDateText: string;
  views: number | null;
  likes: number | null;
  /** A static image asset — i.ytimg.com/vi/<id>/....jpg — never the video
   *  stream. See PRD-47 §2. */
  thumbnailUrl: string;
}

/** One archived upload, as stored in chrome.storage.local (PRD §4). Archiving
 *  the same video id again updates this record in place — see
 *  parse.ts#buildRecord — it never creates a second entry (PRD §7). */
export interface UploadRecord {
  videoId: string;
  url: string;
  title: string;
  description: string;
  publishDateText: string;
  views: number | null;
  likes: number | null;
  /** The thumbnail image URL captured at archive/re-archive time. */
  thumbnailUrl: string;
  /** The video's page in YouTube Studio — the sanctioned, one-click path to
   *  the actual file (Content → video → the Studio-native Download action
   *  in its ⋮ menu). This extension links to that page; it never reaches
   *  through it. See PRD-47 §2/§4. */
  studioUrl: string;
  /** The channel key (id or @handle) confirmed as the archiving account's
   *  own channel at the moment this record was captured — kept for the
   *  record, not re-checked on read. */
  channelKey: string;
  /** First time this video was archived. Preserved across re-archives. */
  archivedAt: number;
  /** Last time this record's captured fields changed (title/description
   *  edited after archiving re-archives update this, per PRD §7). */
  updatedAt: number;
  /** ms epoch the thumbnail image last saved successfully, or null if it
   *  hasn't yet (PRD §7: "thumbnail not yet generated" retries rather than
   *  blocking the metadata entry on one missing asset). */
  thumbnailSavedAt: number | null;
}

export type ExportFormat = 'csv' | 'md' | 'json';

export interface Backup {
  format: 'youtube-upload-archiver';
  version: 1;
  exportedAt: string;
  items: UploadRecord[];
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

/**
 * The only message this extension ever sends: "save this one thumbnail
 * image to disk." chrome.downloads is not available inside a content
 * script (portfolio build memory), so the request is relayed to the
 * background worker, which calls chrome.downloads.download() with the
 * image URL exactly as scraped — the extension's own code never fetches
 * it, never inspects its bytes, and never builds any other kind of URL
 * for a video's content (PRD §2/§4/§6).
 */
export interface DownloadThumbnailMessage {
  type: 'YUA_DOWNLOAD_THUMBNAIL';
  videoId: string;
  thumbnailUrl: string;
  filename: string;
}

export interface DownloadThumbnailResponse {
  ok: boolean;
  error?: string;
}
