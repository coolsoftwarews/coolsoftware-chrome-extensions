/**
 * Turns whatever scrape.ts read off the Bookmarks page into a bookmark card,
 * plus the search/staleness/tagging logic the panel needs. Deliberately pure
 * — no DOM, no chrome.* — so scripts/selftest.mjs can check it headlessly.
 * The DOM-bound half lives in scrape.ts, the same split every DOM-reading
 * extension in this portfolio uses.
 */

import { BookmarkItem, BookmarkPost, Collection, DEFAULT_COLLECTIONS } from './types';

/**
 * Builds (or updates) the card for one bookmark. Indexing the same bookmark
 * twice (PRD §7: "duplicate indexing on re-scroll") refreshes the captured
 * text/metrics and marks it seen in the current session, but the folder,
 * tags and note the user already set are preserved, and the original
 * indexed date does not move.
 *
 * `sessionAt` is the *session's* start time, not `Date.now()` at call time —
 * every bookmark touched during one indexing pass shares the same
 * `lastSeenAt` stamp, which is what makes isPossiblyRemoved below exact
 * rather than a source of false positives within a single scroll session.
 */
export function buildOrTouchItem(
  post: BookmarkPost,
  existing: BookmarkItem | null,
  defaultCollectionId: string,
  sessionAt: number
): BookmarkItem | null {
  if (!post?.id) return null;
  const now = Date.now();
  return {
    id: post.id,
    post,
    tags: existing?.tags ?? [],
    collectionId: existing?.collectionId ?? defaultCollectionId,
    note: existing?.note ?? '',
    indexedAt: existing?.indexedAt ?? now,
    lastSeenAt: sessionAt,
    updatedAt: now,
  };
}

export function defaultCollections(): Collection[] {
  const now = Date.now();
  return DEFAULT_COLLECTIONS.map((c, i) => ({ ...c, createdAt: now + i }));
}

/**
 * "Not seen on your last visit" (PRD §7) — a bookmark whose most recent
 * confirmed sighting predates the most recently *completed* indexing
 * session. This never fires for an item seen earlier in the *same* session
 * as the current `lastReindexAt` (see buildOrTouchItem's `sessionAt` note)
 * and never fires until at least one session has been recorded at all.
 * Deliberately a flag, not a delete — PRD §7 is explicit that a false
 * negative from partial scrolling must never silently remove data.
 */
export function isPossiblyRemoved(item: BookmarkItem, lastReindexAt: number | null): boolean {
  return lastReindexAt !== null && item.lastSeenAt < lastReindexAt;
}

/** Bookmarks matching a search across post text, author, handle, tags and
 *  note (PRD §4: "full-text search across everything indexed so far"). */
export function matchesSearch(item: BookmarkItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.note.toLowerCase().includes(q)) return true;
  if (item.tags.some(t => t.toLowerCase().includes(q))) return true;
  const { post } = item;
  return (
    post.text.toLowerCase().includes(q) ||
    post.author.toLowerCase().includes(q) ||
    post.handle.toLowerCase().includes(q)
  );
}

/** Every distinct tag currently in use, alphabetical — for the panel's tag filter. */
export function allTags(items: BookmarkItem[]): string[] {
  const seen = new Map<string, string>(); // lowercase -> first-seen casing
  for (const item of items) {
    for (const tag of item.tags) {
      const key = tag.toLowerCase();
      if (!seen.has(key)) seen.set(key, tag);
    }
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
}

export function hasTag(item: BookmarkItem, tag: string): boolean {
  const key = tag.toLowerCase();
  return item.tags.some(t => t.toLowerCase() === key);
}
