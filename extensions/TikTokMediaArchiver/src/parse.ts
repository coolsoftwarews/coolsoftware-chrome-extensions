/**
 * String parsing with no DOM involved, so it can be checked headlessly —
 * same split TikTokProductScout's parse.ts/scan.ts and XBookmarkOrganizer's
 * parse.ts/scrape.ts use. This file also carries the ownership-match
 * predicate (PRD-45 §5): the DOM lookups that produce the two handles being
 * compared live in scrape.ts, but the comparison itself is pure and is the
 * single most important thing in this extension to get right, so it is
 * tested exhaustively in scripts/selftest.mjs.
 */

/** Strips a leading "@", trims whitespace, and lower-cases — so "@Acme",
 *  "acme" and " Acme " all normalize to the same value. Returns null for
 *  anything that normalizes to nothing, never an empty string, so a caller
 *  can never mistake "" for "always matches". */
export function normalizeHandle(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().replace(/^@/, '').trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/**
 * The ownership gate's comparison (PRD-45 §5.3): true only when both handles
 * are readable and equal, case-insensitively. Fails closed — null on either
 * side, or on both, is never a match. This is the one function content.ts's
 * Save-button gate calls; there is no other code path that decides
 * ownership.
 */
export function handlesMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeHandle(a);
  const right = normalizeHandle(b);
  return left !== null && right !== null && left === right;
}

/** `https://www.tiktok.com/@handle/video/123` or `.../@handle` → "@handle", or null. */
export function extractHandle(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/(@[\w.-]+)/);
  return match ? match[1] : null;
}

/** `https://www.tiktok.com/@handle/video/7123456789012345678?...` → the id, or null. */
export function extractVideoId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/video\/(\d+)/);
  return match ? match[1] : null;
}

/** Keeps a filename portion to characters safe on every OS this extension
 *  ships to — TikTok handles are already alnum/./_ but this is defensive
 *  rather than assumed. */
function sanitizeForFilename(part: string): string {
  const cleaned = part.replace(/[^a-z0-9._-]/gi, '');
  return cleaned || 'unknown';
}

/** Filename convention from PRD-45 §4: `tiktok-<handle>-<post-id>.mp4`. The
 *  handle is normalized (no "@", lower-cased) so the same creator always
 *  produces the same filename regardless of how their handle was cased on
 *  the page it was read from. */
export function buildFilename(handle: string | null | undefined, postId: string): string {
  const normalized = normalizeHandle(handle) ?? 'unknown';
  return `tiktok-${sanitizeForFilename(normalized)}-${sanitizeForFilename(postId)}.mp4`;
}

/** True for a URL that looks like a real, playable media source rather than
 *  an empty string, a data: placeholder, or a TikTok UI blank. Used to
 *  decide whether to keep waiting for the player's real source (PRD-45 §7)
 *  instead of saving a low-quality/placeholder URL. */
export function isUsableMediaUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  return /^(https?:|blob:)/i.test(url.trim());
}
