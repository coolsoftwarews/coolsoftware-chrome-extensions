/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6: "no network
 * requests of any kind"), which puts two obligations on this file: never
 * lose an index pass, and always let the user take their data out (export
 * all / import / clear all). Same shape as WebHighlighter's and
 * XConversationSaver's storage.ts — this product is the "Saver" pattern from
 * docs/extensions/README.md.
 */

import { buildOrTouchItem, defaultCollections } from './capture';
import { LocalData, mergeBackup, MergeStats } from './merge';
import { Backup, BookmarkItem, BookmarkPost, Collection, PanelOptions, QuotaStatus } from './types';

const ITEM_PREFIX = 'xbo:item:';
const COLLECTIONS_KEY = 'xbo:collections';
const OPTIONS_KEY = 'xbo:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested —
 *  and this product deliberately doesn't request it (minimum permissions,
 *  PRD §6). */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function itemKey(id: string): string {
  return ITEM_PREFIX + id;
}

/* ── Items ───────────────────────────────────────────────────────────── */

export async function readAllItems(): Promise<BookmarkItem[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as BookmarkItem)
    .filter(item => item && item.id && item.post && item.post.id)
    .sort((a, b) => (b.indexedAt ?? 0) - (a.indexedAt ?? 0));
}

export async function readItem(id: string): Promise<BookmarkItem | null> {
  const key = itemKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as BookmarkItem | undefined) ?? null;
}

export async function deleteItem(id: string): Promise<void> {
  await chrome.storage.local.remove(itemKey(id));
}

/**
 * Indexes (or re-touches) a batch of bookmarks read off the page in one
 * pass. Reads the whole item table once and writes once, rather than one
 * read/write per bookmark — a scroll batch is a few dozen posts at most, but
 * there's no reason to pay for a round trip per item. Storage failures are
 * never swallowed: a quota failure must fail loudly with an export prompt,
 * never drop items silently (PRD §7: storage quota).
 */
export async function indexBookmarks(
  posts: BookmarkPost[],
  defaultCollectionId: string,
  sessionAt: number
): Promise<{ items: BookmarkItem[]; newCount: number; updatedCount: number }> {
  if (!posts.length) return { items: [], newCount: 0, updatedCount: 0 };

  const all = await chrome.storage.local.get(null);
  const writes: Record<string, unknown> = {};
  const items: BookmarkItem[] = [];
  let newCount = 0;
  let updatedCount = 0;

  for (const post of posts) {
    const key = itemKey(post.id);
    const existing = (all[key] as BookmarkItem | undefined) ?? null;

    // Already confirmed present earlier in *this same* session, with nothing
    // about the post changed since — skip the write entirely. A Bookmarks
    // tab left open re-scans on a light interval (content.ts), and without
    // this check every tick would re-write every visible item even though
    // nothing changed, just to keep lastSeenAt current (it's already current
    // — see capture.ts#buildOrTouchItem's `sessionAt` note).
    if (existing && existing.lastSeenAt === sessionAt && existing.post.text === post.text && existing.post.postDate === post.postDate) {
      items.push(existing);
      continue;
    }

    const item = buildOrTouchItem(post, existing, defaultCollectionId, sessionAt);
    if (!item) continue;
    if (!existing) newCount++;
    else if (existing.post.text !== item.post.text || existing.post.postDate !== item.post.postDate) updatedCount++;
    writes[key] = item;
    items.push(item);
  }

  if (Object.keys(writes).length) {
    try {
      await chrome.storage.local.set(writes);
    } catch {
      throw new Error('Storage is full. Export your library, then remove a few bookmarks to free up room, and try again.');
    }
  }

  return { items, newCount, updatedCount };
}

export async function setItemTags(id: string, tags: string[]): Promise<BookmarkItem | null> {
  const existing = await readItem(id);
  if (!existing) return null;
  const next: BookmarkItem = { ...existing, tags, updatedAt: Date.now() };
  await chrome.storage.local.set({ [itemKey(id)]: next });
  return next;
}

export async function setItemNote(id: string, note: string): Promise<BookmarkItem | null> {
  const existing = await readItem(id);
  if (!existing) return null;
  const next: BookmarkItem = { ...existing, note, updatedAt: Date.now() };
  await chrome.storage.local.set({ [itemKey(id)]: next });
  return next;
}

export async function moveItemToCollection(id: string, collectionId: string): Promise<BookmarkItem | null> {
  const existing = await readItem(id);
  if (!existing) return null;
  const next: BookmarkItem = { ...existing, collectionId, updatedAt: Date.now() };
  await chrome.storage.local.set({ [itemKey(id)]: next });
  return next;
}

/* ── Collections (folders) ──────────────────────────────────────────── */

export async function readCollections(): Promise<Collection[]> {
  const stored = await chrome.storage.local.get(COLLECTIONS_KEY);
  const collections = stored?.[COLLECTIONS_KEY] as Collection[] | undefined;
  if (collections?.length) return collections;
  const seeded = defaultCollections();
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: seeded });
  return seeded;
}

async function writeCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: collections });
}

export async function createCollection(name: string): Promise<Collection[]> {
  const trimmed = name.trim();
  if (!trimmed) return readCollections();
  const collections = await readCollections();
  const id = `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const next = [...collections, { id, name: trimmed, createdAt: Date.now() }];
  await writeCollections(next);
  return next;
}

export async function renameCollection(id: string, name: string): Promise<Collection[]> {
  const collections = await readCollections();
  const trimmed = name.trim();
  const next = trimmed ? collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)) : collections;
  await writeCollections(next);
  return next;
}

/* ── Panel options (staleness marker etc.) ──────────────────────────── */

const DEFAULT_OPTIONS: PanelOptions = { lastReindexAt: null };

export async function readOptions(): Promise<PanelOptions> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...((stored?.[OPTIONS_KEY] as Partial<PanelOptions>) ?? {}) };
}

export async function writeOptions(options: PanelOptions): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}

/** Marks the start of a new indexing session as "the most recent one" —
 *  called once, at the moment a Bookmarks page visit begins scanning
 *  (content.ts#boot), never mid-session. Returns the session's own
 *  timestamp so the caller stamps every item it touches with the same
 *  value (capture.ts#buildOrTouchItem's `sessionAt`). */
export async function beginIndexingSession(): Promise<number> {
  const sessionAt = Date.now();
  await writeOptions({ lastReindexAt: sessionAt });
  return sessionAt;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  const [items, collections] = await Promise.all([readAllItems(), readCollections()]);
  return {
    format: 'x-bookmark-organizer',
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    collections,
  };
}

export type ImportResult = MergeStats;

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'x-bookmark-organizer' || !Array.isArray(backup.items)) {
    throw new Error('That file is not an X Bookmark Organizer backup.');
  }

  const local: LocalData = {
    items: await readAllItems(),
    collections: await readCollections(),
  };
  const merged = mergeBackup(local, backup);

  const writes: Record<string, unknown> = { [COLLECTIONS_KEY]: merged.collections };
  for (const item of merged.items) writes[itemKey(item.id)] = item;
  await chrome.storage.local.set(writes);

  return merged.stats;
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(ITEM_PREFIX) || key === COLLECTIONS_KEY);
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: defaultCollections(), [OPTIONS_KEY]: DEFAULT_OPTIONS });
}

export async function quotaStatus(): Promise<QuotaStatus> {
  let bytes = 0;
  try {
    bytes = await chrome.storage.local.getBytesInUse(null);
  } catch {
    /* not implemented everywhere; treat as empty */
  }
  const ratio = bytes / QUOTA_BYTES;
  return { bytes, ratio, warn: ratio >= WARN_RATIO };
}
