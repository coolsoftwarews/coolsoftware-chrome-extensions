/**
 * Pure helpers — handle normalization, the ownership-match predicate, the
 * filename convention, and post-id extraction. No DOM, no chrome.* — every
 * function here is covered by scripts/selftest.mjs with plain string
 * inputs.
 *
 * handlesMatch() is the load-bearing predicate behind PRD §5's ownership
 * gate: content.ts calls it with two handles read live from the DOM
 * (scrape.ts), but the matching logic itself — case-insensitive equality,
 * fail closed on anything unreadable — is pure and tested here in
 * isolation from the DOM reads that feed it.
 */

const RESERVED_PATHS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'direct',
  'stories',
  'accounts',
  'about',
  'legal',
  'privacy',
  'developer',
  'directory',
  'tv',
  'lite',
]);

const HANDLE_RE = /^[A-Za-z0-9._]{1,30}$/;

/** Strips a leading "@", trims, lowercases. Anything that isn't a
 *  well-formed Instagram handle (empty, wrong characters, too long)
 *  normalizes to '' — never a best-effort guess. */
export function normalizeHandle(raw: string | null | undefined): string {
  if (!raw) return '';
  const trimmed = raw.trim().replace(/^@/, '');
  return HANDLE_RE.test(trimmed) ? trimmed.toLowerCase() : '';
}

/**
 * True only when both handles are non-empty and equal, case-insensitively
 * (PRD §5.3). This is the entire ownership gate: either side failing to
 * normalize — logged out, selector drift, an empty string — fails closed.
 * There is no "unknown, so allow it" branch; an unreadable handle is
 * treated exactly like a mismatched one.
 */
export function handlesMatch(
  loggedInHandle: string | null | undefined,
  authorHandle: string | null | undefined
): boolean {
  const a = normalizeHandle(loggedInHandle);
  const b = normalizeHandle(authorHandle);
  return a !== '' && b !== '' && a === b;
}

/** A path segment that reads as a real profile handle, not a reserved app
 *  route like /p/, /reel/ or /explore/. */
export function isProfilePath(segment: string): boolean {
  return HANDLE_RE.test(segment) && !RESERVED_PATHS.has(segment.toLowerCase());
}

const POST_ID_RE = /\/(?:p|reel)\/([^/?#]+)/;

/** Shortcode from a permalink, e.g.
 *  "https://www.instagram.com/p/Cxyz123/" -> "Cxyz123". '' if not a post/Reel URL. */
export function postIdFromUrl(url: string | null | undefined): string {
  if (!url) return '';
  const match = url.match(POST_ID_RE);
  return match ? match[1] : '';
}

function extFromMediaUrl(url: string, mediaKind: MediaKindLike): string {
  const match = url.match(/\.([a-zA-Z0-9]{2,4})(?:[?#]|$)/);
  const ext = match?.[1]?.toLowerCase();
  if (ext && /^[a-z0-9]+$/.test(ext)) return ext;
  return mediaKind === 'video' ? 'mp4' : 'jpg';
}

type MediaKindLike = 'image' | 'video';

/** Filename convention (PRD §4): instagram-<handle>-<post-id>-<n>.<ext> */
export function buildFilename(
  handle: string,
  postId: string,
  index: number,
  mediaUrl: string,
  mediaKind: MediaKindLike
): string {
  const safeHandle = normalizeHandle(handle) || 'unknown';
  const safePostId = (postId || 'post').replace(/[^A-Za-z0-9_-]/g, '') || 'post';
  const safeIndex = Number.isFinite(index) && index > 0 ? Math.floor(index) : 1;
  const ext = extFromMediaUrl(mediaUrl, mediaKind);
  return `instagram-${safeHandle}-${safePostId}-${safeIndex}.${ext}`;
}

/** Stable per-slide id for the local log — same post saved twice updates
 *  the same row instead of duplicating it. */
export function logEntryId(postId: string, index: number): string {
  return `${postId || 'post'}-${index}`;
}
