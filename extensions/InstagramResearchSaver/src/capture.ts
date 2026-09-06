/**
 * Turns a raw scrape (whatever content.ts / scrape.ts could read off the page)
 * into a capture card. Deliberately pure — no DOM, no chrome.* — so
 * scripts/selftest.mjs can check it headlessly. The DOM-bound half that
 * produces a RawCapture lives in scrape.ts and is covered by the manual
 * checklist in the README, same split as WebHighlighter's quote.ts / anchor.ts.
 */

import { Collection, DEFAULT_COLLECTIONS, PostMetrics, RawCapture, SavedPost } from './types';

/** A caption this long is already a wall of text; keep it in full but not unbounded. */
const MAX_CAPTION_STORE_LENGTH = 5000;

export function postIdFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://www.instagram.com');
    const match = url.pathname.match(/\/(p|reel)\/([^/]+)/);
    if (match) return `${match[1]}:${match[2]}`;
  } catch {
    /* fall through to the raw-string fallback below */
  }
  return rawUrl.trim().toLowerCase();
}

/** Canonical `https://www.instagram.com/p|reel/{code}/` — strips query params and hosts. */
export function normalizeInstagramUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, 'https://www.instagram.com');
    const match = url.pathname.match(/\/(p|reel)\/([^/]+)/);
    if (match) return `https://www.instagram.com/${match[1]}/${match[2]}/`;
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Parses Instagram's compact count formatting — "12,345", "1.2M", "3.4K views",
 * "1,204 likes". Returns null (not 0) when nothing usable is present; PRD §8
 * calls out posts with no visible count as an expected case, and a silent 0
 * would misrepresent the post.
 */
export function parseCount(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const match = raw.replace(/,/g, '').match(/([\d]+(?:\.\d+)?)\s*([kmb])?/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  const suffix = match[2]?.toLowerCase();
  const multiplier = suffix === 'k' ? 1_000 : suffix === 'm' ? 1_000_000 : suffix === 'b' ? 1_000_000_000 : 1;
  return Math.round(value * multiplier);
}

function clampCaption(text: string): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length > MAX_CAPTION_STORE_LENGTH ? trimmed.slice(0, MAX_CAPTION_STORE_LENGTH) : trimmed;
}

function metricsFrom(raw: Pick<RawCapture, 'viewsRaw' | 'likesRaw' | 'commentsRaw'>): PostMetrics {
  return {
    views: parseCount(raw.viewsRaw),
    likes: parseCount(raw.likesRaw),
    comments: parseCount(raw.commentsRaw),
  };
}

/**
 * Picks what gets stored as the thumbnail: the size-capped data URI when the
 * capture produced one, otherwise the remote CDN URL (PRD §6 — "accept that
 * some images rot, but tell the user that's what happens").
 */
export function chooseThumbnail(raw: Pick<RawCapture, 'thumbnailDataUri' | 'thumbnailRemoteUrl'>): {
  thumbnail: string;
  thumbnailIsRemote: boolean;
} {
  if (raw.thumbnailDataUri) return { thumbnail: raw.thumbnailDataUri, thumbnailIsRemote: false };
  return { thumbnail: raw.thumbnailRemoteUrl, thumbnailIsRemote: true };
}

/**
 * Builds (or updates) the capture card for a post. Saving the same post twice
 * (PRD §8) updates the card in place — numbers, thumbnail, caption and date
 * refresh — but the collection and note the user already set are preserved,
 * and the original saved date does not move.
 */
export function buildCapture(raw: RawCapture, existing: SavedPost | null, defaultCollectionId: string): SavedPost {
  const now = Date.now();
  const thumb = chooseThumbnail(raw);
  return {
    id: postIdFromUrl(raw.postUrl),
    postUrl: normalizeInstagramUrl(raw.postUrl),
    creatorHandle: raw.creatorHandle.replace(/^@/, '').trim(),
    thumbnail: thumb.thumbnail,
    thumbnailIsRemote: thumb.thumbnailIsRemote,
    caption: clampCaption(raw.captionRaw),
    postDate: raw.postDateRaw.trim(),
    savedAt: existing?.savedAt ?? now,
    updatedAt: now,
    note: existing?.note ?? '',
    collectionId: existing?.collectionId ?? defaultCollectionId,
    metrics: metricsFrom(raw),
    carouselCount: raw.carouselCount,
    mediaType: raw.mediaType,
  };
}

export function defaultCollections(): Collection[] {
  const now = Date.now();
  return DEFAULT_COLLECTIONS.map((c, i) => ({ ...c, createdAt: now + i }));
}

/** Cards matching a search across caption, handle and note (PRD §4). */
export function matchesSearch(post: SavedPost, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    post.caption.toLowerCase().includes(q) ||
    post.creatorHandle.toLowerCase().includes(q) ||
    post.note.toLowerCase().includes(q)
  );
}
