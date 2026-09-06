/**
 * Turns whatever scrape.ts read off the page into a capture card. Deliberately
 * pure — no DOM, no chrome.* — so scripts/selftest.mjs can check it
 * headlessly. The DOM-bound half lives in scrape.ts and is covered by the
 * manual checklist in README.md, the same split WebHighlighter's
 * quote.ts/anchor.ts and Instagram Research Saver's capture.ts/scrape.ts use.
 */

import { CapturedPost, Collection, DEFAULT_COLLECTIONS, ItemKind, SavedItem } from './types';

/**
 * A "thread" is every captured post from one author; the moment a second
 * author appears it's a "conversation, not a thread" (PRD §8 edge case).
 */
export function classifyKind(posts: CapturedPost[]): ItemKind {
  if (posts.length <= 1) return 'post';
  return new Set(posts.map(p => p.handle).filter(Boolean)).size <= 1 ? 'thread' : 'conversation';
}

export function uniqueAuthors(posts: CapturedPost[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const post of posts) {
    if (!post.handle || seen.has(post.handle)) continue;
    seen.add(post.handle);
    out.push(post.handle);
  }
  return out;
}

/**
 * Builds (or updates) the capture card for a post/thread. Saving the same
 * root post twice (PRD §8: "update, don't duplicate") refreshes the captured
 * text, metrics and post list, but the collection and note the user already
 * set are preserved, and the original saved date does not move.
 */
export function buildItem(
  posts: CapturedPost[],
  existing: SavedItem | null,
  defaultCollectionId: string,
  truncated = false
): SavedItem | null {
  const clean = posts.filter((p): p is CapturedPost => Boolean(p && p.id));
  if (!clean.length) return null;
  const now = Date.now();
  return {
    id: clean[0].id,
    kind: classifyKind(clean),
    posts: clean,
    authors: uniqueAuthors(clean),
    collectionId: existing?.collectionId ?? defaultCollectionId,
    note: existing?.note ?? '',
    truncated,
    savedAt: existing?.savedAt ?? now,
    updatedAt: now,
  };
}

export function defaultCollections(): Collection[] {
  const now = Date.now();
  return DEFAULT_COLLECTIONS.map((c, i) => ({ ...c, createdAt: now + i }));
}

/** Items matching a search across post text, author, handle and note (PRD §4). */
export function matchesSearch(item: SavedItem, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  if (item.note.toLowerCase().includes(q)) return true;
  return item.posts.some(
    p =>
      p.text.toLowerCase().includes(q) ||
      p.author.toLowerCase().includes(q) ||
      p.handle.toLowerCase().includes(q)
  );
}

export interface PersonGroup {
  handle: string;
  author: string;
  items: SavedItem[];
}

/**
 * Groups saved items by the root post's author for the People view (PRD §4):
 * "saved 6 posts from this person", grouped by author, with a per-person note.
 * Sorted by how many items are saved from them, most first.
 */
export function groupByPerson(items: SavedItem[]): PersonGroup[] {
  const groups = new Map<string, PersonGroup>();
  for (const item of items) {
    const root = item.posts[0];
    if (!root?.handle) continue;
    const group = groups.get(root.handle) ?? { handle: root.handle, author: root.author, items: [] };
    group.items.push(item);
    groups.set(root.handle, group);
  }
  return [...groups.values()].sort((a, b) => b.items.length - a.items.length);
}
