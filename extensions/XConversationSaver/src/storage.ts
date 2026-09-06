/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §7: "Privacy: No
 * network requests"), which puts two obligations on this file: never lose a
 * save, and always let the user take their data out (export all / import /
 * clear all). Same shape as WebHighlighter's storage.ts and Instagram
 * Research Saver's storage.ts — this product is the "Saver" pattern from
 * docs/extensions/README.md.
 */

import { defaultCollections } from './capture';
import { LocalData, mergeBackup, MergeStats } from './merge';
import { Backup, Collection, PersonNote, QuotaStatus, SavedItem } from './types';

const ITEM_PREFIX = 'xcs:item:';
const COLLECTIONS_KEY = 'xcs:collections';
const PEOPLE_KEY = 'xcs:people';
const OPTIONS_KEY = 'xcs:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested — and
 *  this product deliberately doesn't request it (minimum permissions, PRD §7). */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function itemKey(id: string): string {
  return ITEM_PREFIX + id;
}

/* ── Items ───────────────────────────────────────────────────────────── */

export async function readAllItems(): Promise<SavedItem[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as SavedItem)
    .filter(item => item && item.id && Array.isArray(item.posts) && item.posts.length > 0)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export async function readItem(id: string): Promise<SavedItem | null> {
  const key = itemKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as SavedItem | undefined) ?? null;
}

export async function writeItem(item: SavedItem): Promise<void> {
  await chrome.storage.local.set({ [itemKey(item.id)]: item });
}

export async function deleteItem(id: string): Promise<void> {
  await chrome.storage.local.remove(itemKey(id));
}

/**
 * Persists a capture card. `build` receives the existing card (if this post
 * was saved before) so the caller can merge rather than duplicate — see
 * capture.ts#buildItem. Storage failures are never swallowed: a quota failure
 * must fail loudly with an export prompt, never drop the save silently
 * (PRD §4: "quota warning at 80%").
 */
export async function saveItem(
  id: string,
  build: (existing: SavedItem | null) => SavedItem | null
): Promise<SavedItem> {
  const existing = await readItem(id);
  const item = build(existing);
  if (!item) throw new Error('Nothing on this post could be captured.');
  try {
    await writeItem(item);
  } catch {
    throw new Error('Storage is full. Export your library, then remove a few items to free up room, and try again.');
  }
  return item;
}

export async function moveItemToCollection(id: string, collectionId: string): Promise<SavedItem | null> {
  const existing = await readItem(id);
  if (!existing) return null;
  const next: SavedItem = { ...existing, collectionId, updatedAt: Date.now() };
  await writeItem(next);
  return next;
}

export async function setItemNote(id: string, note: string): Promise<SavedItem | null> {
  const existing = await readItem(id);
  if (!existing) return null;
  const next: SavedItem = { ...existing, note, updatedAt: Date.now() };
  await writeItem(next);
  return next;
}

/* ── Collections ─────────────────────────────────────────────────────── */

export async function readCollections(): Promise<Collection[]> {
  const stored = await chrome.storage.local.get(COLLECTIONS_KEY);
  const collections = stored?.[COLLECTIONS_KEY] as Collection[] | undefined;
  if (collections?.length) return collections;
  const seeded = defaultCollections();
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: seeded });
  return seeded;
}

export async function writeCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: collections });
}

export async function renameCollection(id: string, name: string): Promise<Collection[]> {
  const collections = await readCollections();
  const trimmed = name.trim();
  const next = trimmed ? collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)) : collections;
  await writeCollections(next);
  return next;
}

/* ── People notes ────────────────────────────────────────────────────── */

export async function readPeople(): Promise<PersonNote[]> {
  const stored = await chrome.storage.local.get(PEOPLE_KEY);
  return (stored?.[PEOPLE_KEY] as PersonNote[] | undefined) ?? [];
}

export async function writePersonNote(handle: string, note: string): Promise<PersonNote[]> {
  const people = await readPeople();
  const trimmed = note.trim();
  const next = people.filter(p => p.handle !== handle);
  if (trimmed) next.push({ handle, note: trimmed, updatedAt: Date.now() });
  await chrome.storage.local.set({ [PEOPLE_KEY]: next });
  return next;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  const [items, collections, people] = await Promise.all([readAllItems(), readCollections(), readPeople()]);
  return {
    format: 'x-conversation-saver',
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    collections,
    people,
  };
}

export type ImportResult = MergeStats;

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'x-conversation-saver' || !Array.isArray(backup.items)) {
    throw new Error('That file is not an X Conversation Saver backup.');
  }

  const local: LocalData = {
    items: await readAllItems(),
    collections: await readCollections(),
    people: await readPeople(),
  };
  const merged = mergeBackup(local, backup);

  const writes: Record<string, unknown> = {
    [COLLECTIONS_KEY]: merged.collections,
    [PEOPLE_KEY]: merged.people,
  };
  for (const item of merged.items) writes[itemKey(item.id)] = item;
  await chrome.storage.local.set(writes);

  return merged.stats;
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    key => key.startsWith(ITEM_PREFIX) || key === COLLECTIONS_KEY || key === PEOPLE_KEY
  );
  if (keys.length) await chrome.storage.local.remove(keys);
  await chrome.storage.local.set({ [COLLECTIONS_KEY]: defaultCollections() });
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

/* ── Panel options ───────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
