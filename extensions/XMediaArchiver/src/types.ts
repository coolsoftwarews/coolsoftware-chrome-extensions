/**
 * Shared shapes. There is no "library" of collections/tags in this product
 * (PRD-46 §4) — the only thing that persists locally is a flat log of what's
 * been saved (post URL, date, media type, filename), so it stays much
 * smaller than the "Saver" pattern's item shape used elsewhere in this
 * portfolio (XBookmarkOrganizer, XConversationSaver).
 */

export type MediaKind = 'image' | 'video';

/** One post's author identity, as read off X's own DOM (display name +
 *  normalized handle, no leading "@"). Used for both the logged-in viewer
 *  and any post byline — same shape either way. */
export interface AuthorInfo {
  author: string;
  handle: string;
}

/** One media item X rendered inside a post, tagged with *which* post's
 *  byline it actually belongs to (PRD §4/§5's quote-tweet distinction):
 *  'main' is the outer/quoting post's own attached media, 'quoted' is media
 *  that belongs to a nested quoted post, not the post that quoted it. */
export interface ScrapedMedia {
  url: string;
  kind: MediaKind;
  source: 'main' | 'quoted';
}

/** What scrape.ts reads off one post `<article>` — the DOM-bound half.
 *  `mainAuthor` is read from the article's *own* byline, which for a
 *  repost is already the original author (X renders a repost as the
 *  original article with a separate "so-and-so reposted" decoration, never
 *  as a rewritten byline) — see scrape.ts's own comment on this. */
export interface ScrapedTweet {
  id: string | null;
  url: string;
  mainAuthor: AuthorInfo;
  /** Present only when this post embeds a quote-tweet; that embedded
   *  post's own byline, read independently of the outer post's byline. */
  quotedAuthor: AuthorInfo | null;
  media: ScrapedMedia[];
}

export type OwnershipReason = 'match' | 'no-viewer-handle' | 'no-author-handle' | 'mismatch';

/** The result of the ownership gate (PRD §5): `owned` is the only thing
 *  content.ts is allowed to act on, and it is false whenever a handle
 *  couldn't be confidently read at all — never true by default. */
export interface OwnershipResult {
  owned: boolean;
  reason: OwnershipReason;
}

/** One media item after the ownership gate has been evaluated against a
 *  live-read viewer handle — the shape content.ts actually renders a Save
 *  button from. `authorHandle` is always the *resolved* author for this
 *  specific item (the quoted post's handle when `source === 'quoted'`),
 *  never the outer post's handle by default. */
export interface MediaOwnership extends ScrapedMedia {
  authorHandle: string;
  ownership: OwnershipResult;
}

/** A minimal candidate video source as read off a `<video>`/`<source>`
 *  element — plain data, so chooseHighestBitrateVideoSource can be tested
 *  without a real <video> element. */
export interface VideoSourceCandidate {
  url: string;
  width: number | null;
  height: number | null;
}

/** One row in the local save log (PRD §4: "post URL, date, media type,
 *  saved filename"). Never stores the media file itself, only a record. */
export interface LogEntry {
  /** postId + media index, unique per saved file (so re-saving the same
   *  item updates the record instead of duplicating it). */
  id: string;
  postId: string;
  postUrl: string;
  handle: string;
  mediaType: MediaKind;
  filename: string;
  /** Epoch ms the file was saved. */
  savedAt: number;
}

export type ExportFormat = 'csv' | 'json';

/** The only message this extension ever sends: content script -> background
 *  -> chrome.downloads.download, because chrome.downloads is not available
 *  inside a content script (the standing gotcha every extension in this
 *  portfolio that downloads a file works around the same way). The
 *  background performs no fetch of its own; `url` is the remote media URL
 *  the page already rendered, and chrome.downloads.download fetches it with
 *  the browser's own download manager, not this extension's code. */
export interface DownloadMediaMessage {
  type: 'XMA_DOWNLOAD_MEDIA';
  url: string;
  filename: string;
}

export interface DownloadMediaResponse {
  ok: boolean;
  error?: string;
}
