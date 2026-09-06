/**
 * Pure logic — no DOM, no chrome.* — so scripts/selftest.mjs can check every
 * one of these headlessly. The DOM-bound half that reads the plain
 * inputs these functions consume lives in scrape.ts.
 *
 * This is also where PRD-46 §5's ownership gate itself lives, deliberately
 * factored out of the DOM layer: isOwnPost and resolveMediaAuthor take
 * plain handle strings / plain structured post data, so the one rule this
 * whole product exists to enforce — no Save button on a post the logged-in
 * account did not author, and a repost/quote's *original* author is what
 * counts, never who reposted it — can be exercised with fixtures instead of
 * a live X session.
 */

import { AuthorInfo, MediaKind, MediaOwnership, OwnershipResult, ScrapedMedia, ScrapedTweet, VideoSourceCandidate } from './types';

/** Strips a leading "@" and lowercases, so the same person is always one
 *  comparison key regardless of how X capitalized/decorated it. */
export function normalizeHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@/, '').toLowerCase();
}

/** Extracts the numeric status id from a post permalink. */
export function parseStatusId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

export function canonicalStatusUrl(handle: string, id: string): string {
  const normalized = normalizeHandle(handle);
  return normalized ? `https://x.com/${normalized}/status/${id}` : `https://x.com/i/status/${id}`;
}

/** True for a tab whose content script this extension is allowed to talk to. */
export function isXUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)x\.com$/.test(parsed.hostname) || /(^|\.)twitter\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/* ── The ownership gate (PRD §5) ────────────────────────────────────────── */

/**
 * The whole gate, boiled down to one comparison: does the specific media
 * item's resolved author match the logged-in viewer, case-insensitively?
 * Fails closed (owned: false) whenever either handle is missing — an
 * extension that can't confirm ownership must default to doing nothing,
 * never to trusting a URL or a cached value (PRD §5.3 / Instagram-sibling
 * PRD-44 §5's identical wording).
 */
export function isOwnPost(viewerHandle: string | null | undefined, authorHandle: string | null | undefined): OwnershipResult {
  const viewer = normalizeHandle(viewerHandle);
  const author = normalizeHandle(authorHandle);
  if (!viewer) return { owned: false, reason: 'no-viewer-handle' };
  if (!author) return { owned: false, reason: 'no-author-handle' };
  return viewer === author ? { owned: true, reason: 'match' } : { owned: false, reason: 'mismatch' };
}

/**
 * PRD §4/§5's repost/quote-tweet rule, as a pure function over plain
 * structured data: a piece of media's *owning* author is the quoted post's
 * author when that media belongs to the nested quoted post, and the
 * outer/main post's author otherwise. There is deliberately no
 * "who reposted this" input here at all — a plain repost never changes
 * `mainAuthor` (scrape.ts reads it from the article's own byline, which X
 * renders as the *original* author even for a repost), so the reposting
 * account can never leak into an ownership decision through this function.
 */
export function resolveMediaAuthor(mainAuthor: AuthorInfo, quotedAuthor: AuthorInfo | null, source: 'main' | 'quoted'): AuthorInfo {
  if (source === 'quoted' && quotedAuthor) return quotedAuthor;
  return mainAuthor;
}

/**
 * Runs the full gate over every media item on one scraped post, given the
 * viewer's handle read live at the moment of evaluation (PRD §5/§7: "never
 * cached across the virtualized timeline"). This is the single function
 * content.ts calls to decide which Save buttons, if any, may render.
 */
export function evaluateMediaOwnership(tweet: Pick<ScrapedTweet, 'mainAuthor' | 'quotedAuthor' | 'media'>, viewerHandle: string): MediaOwnership[] {
  return tweet.media.map(item => {
    const author = resolveMediaAuthor(tweet.mainAuthor, tweet.quotedAuthor, item.source);
    return {
      ...item,
      authorHandle: author.handle,
      ownership: isOwnPost(viewerHandle, author.handle),
    };
  });
}

/* ── Video source selection (PRD §7) ─────────────────────────────────────── */

/**
 * Picks the highest-resolution real source among what the page rendered —
 * PRD §7: "save the highest-bitrate source the page loaded, not a
 * preview/poster frame." Width × height stands in for bitrate since that's
 * the only signal X's markup reliably exposes across `<source>` variants.
 *
 * A `blob:` URL is returned when it's the only source X rendered, but *not*
 * because it can be saved — it can't; it's an MSE handle with no file behind
 * it. It's returned as a marker meaning "this post has a video", which
 * content.ts#withRealVideoUrls then swaps for the real MP4 that
 * mainworld.ts read out of X's own tweet data (or drops, if none was found).
 * Reject blobs here and that swap has nothing to act on, so the video would
 * never be offered even when the real URL is known.
 */
export function chooseHighestBitrateVideoSource(candidates: VideoSourceCandidate[]): VideoSourceCandidate | null {
  // blob: sources carry no width/height in the URL, so they score 0 and lose
  // to any real, dimensioned candidate — they only win when nothing else was
  // rendered. Only an empty/missing URL is actually ineligible.
  const eligible = candidates.filter(c => c.url);
  if (!eligible.length) return null;
  return eligible.reduce((best, current) => {
    const bestScore = (best.width ?? 0) * (best.height ?? 0);
    const currentScore = (current.width ?? 0) * (current.height ?? 0);
    return currentScore > bestScore ? current : best;
  });
}

/* ── Filenames (PRD §4: "x-<handle>-<post-id>-<n>.<ext>") ─────────────────── */

function sanitizeFilenamePart(part: string): string {
  return part.replace(/[^a-z0-9_-]/gi, '') || 'unknown';
}

export function buildMediaFilename(handle: string, postId: string, index: number, ext: string): string {
  const safeHandle = sanitizeFilenamePart(normalizeHandle(handle) || 'unknown');
  const safeId = sanitizeFilenamePart(postId || '0');
  const safeExt = sanitizeFilenamePart(ext || 'bin').toLowerCase();
  return `x-${safeHandle}-${safeId}-${Math.max(1, Math.trunc(index))}.${safeExt}`;
}

/** Best-effort extension from a media URL: X images carry `?format=jpg`
 *  (or similar); video URLs usually end in a real extension in the path.
 *  Falls back to a kind-appropriate default rather than leaving the file
 *  extension-less. */
export function extensionFromUrl(url: string, kind: MediaKind): string {
  const fallback = kind === 'video' ? 'mp4' : 'jpg';
  try {
    const parsed = new URL(url);
    const format = parsed.searchParams.get('format');
    if (format && /^[a-z0-9]{2,5}$/i.test(format)) return format.toLowerCase();
    const match = parsed.pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match) return match[1].toLowerCase();
  } catch {
    /* not a valid absolute URL — use the fallback */
  }
  return fallback;
}

/* ── Log export (PRD §4: "Export CSV/JSON, clear-all") ───────────────────── */

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

const CSV_HEADERS = ['Handle', 'Media type', 'Filename', 'Post URL', 'Saved date'];

export interface LogEntryLike {
  handle: string;
  mediaType: MediaKind;
  filename: string;
  postUrl: string;
  savedAt: number;
}

export function buildLogCsv(entries: LogEntryLike[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const entry of entries) {
    rows.push(
      [entry.handle, entry.mediaType, entry.filename, entry.postUrl, new Date(entry.savedAt).toISOString()]
        .map(v => csvCell(String(v)))
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function buildLogJson(entries: LogEntryLike[]): string {
  return JSON.stringify(
    {
      format: 'x-media-archiver',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries,
    },
    null,
    2
  );
}

export function buildExportFilename(kind: 'csv' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `x-media-archiver-log-${stamp}.${kind}`;
}
