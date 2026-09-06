/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (README "hard constraints"). This
 * is the shared "Saver" shape: items (saved ads), collections, and the
 * export-all / import / clear-all backup every extension in the set offers.
 */

import { Backup, Collection, ImportResult, QuotaStatus, SavedAd } from './types';

const ITEM_PREFIX = 'faw:item:';
const COLLECTION_KEY = 'faw:collections';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function itemKey(id: string): string {
  return ITEM_PREFIX + id;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/* ── Items ───────────────────────────────────────────────────────────── */

export async function readItems(): Promise<SavedAd[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as SavedAd)
    .filter(item => item && typeof item.id === 'string')
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function saveItem(item: Omit<SavedAd, 'id' | 'savedAt'>): Promise<SavedAd> {
  const record: SavedAd = { ...item, id: newId('ad'), savedAt: Date.now() };
  await chrome.storage.local.set({ [itemKey(record.id)]: record });
  return record;
}

export async function updateItem(id: string, patch: Partial<SavedAd>): Promise<void> {
  const key = itemKey(id);
  const stored = await chrome.storage.local.get(key);
  const existing = stored?.[key] as SavedAd | undefined;
  if (!existing) return;
  await chrome.storage.local.set({ [key]: { ...existing, ...patch, id: existing.id } });
}

export async function deleteItem(id: string): Promise<void> {
  await chrome.storage.local.remove(itemKey(id));
}

/**
 * True when this exact ad (by Ad Library URL) is already in the swipe file —
 * used so "+ Save ad" can show "Saved" instead of creating a duplicate.
 */
export async function isSaved(libraryUrl: string): Promise<boolean> {
  const items = await readItems();
  return items.some(item => item.libraryUrl === libraryUrl);
}

/* ── Collections ─────────────────────────────────────────────────────── */

export async function readCollections(): Promise<Collection[]> {
  const stored = await chrome.storage.local.get(COLLECTION_KEY);
  const value = (stored?.[COLLECTION_KEY] as Collection[] | undefined) ?? [];
  return [...value].sort((a, b) => a.createdAt - b.createdAt);
}

async function writeCollections(collections: Collection[]): Promise<void> {
  await chrome.storage.local.set({ [COLLECTION_KEY]: collections });
}

export async function createCollection(name: string): Promise<Collection> {
  const trimmed = name.trim() || 'Untitled collection';
  const collections = await readCollections();
  const collection: Collection = { id: newId('col'), name: trimmed, createdAt: Date.now() };
  await writeCollections([...collections, collection]);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const collections = await readCollections();
  const trimmed = name.trim();
  if (!trimmed) return;
  await writeCollections(collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)));
}

/** Deletes the collection but keeps its ads — they become uncategorized, never deleted implicitly. */
export async function deleteCollection(id: string): Promise<void> {
  const collections = await readCollections();
  await writeCollections(collections.filter(c => c.id !== id));

  const items = await readItems();
  const affected = items.filter(item => item.collectionId === id);
  await Promise.all(affected.map(item => updateItem(item.id, { collectionId: null })));
}

/* ── Search ──────────────────────────────────────────────────────────── */

export function searchItems(items: SavedAd[], query: string): SavedAd[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(item =>
    [item.advertiser, item.adText, item.landingDomain, item.note].some(field => field.toLowerCase().includes(q))
  );
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  const [items, collections] = await Promise.all([readItems(), readCollections()]);
  return {
    format: 'facebook-ad-winner',
    version: 1,
    exportedAt: new Date().toISOString(),
    items,
    collections,
  };
}

/**
 * Merges a backup into local storage. Items are matched by id, so restoring
 * the same file twice never duplicates a saved ad; collections are matched
 * by id too, and re-created if a referenced collection is missing.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'facebook-ad-winner' || !Array.isArray(backup.items)) {
    throw new Error('That file is not a Meta Ad Winner backup.');
  }

  const existingCollections = await readCollections();
  const collectionIds = new Set(existingCollections.map(c => c.id));
  const incomingCollections = Array.isArray(backup.collections) ? backup.collections : [];
  const mergedCollections = [...existingCollections];
  let collectionsAdded = 0;
  for (const collection of incomingCollections) {
    if (!collection?.id || collectionIds.has(collection.id)) continue;
    mergedCollections.push(collection);
    collectionIds.add(collection.id);
    collectionsAdded++;
  }
  await writeCollections(mergedCollections);

  const existingItems = await readItems();
  const existingIds = new Set(existingItems.map(item => item.id));
  const writes: Record<string, SavedAd> = {};
  let itemsAdded = 0;
  for (const item of backup.items) {
    if (!item?.id || typeof item.libraryUrl !== 'string') continue;
    if (!existingIds.has(item.id)) itemsAdded++;
    writes[itemKey(item.id)] = item;
  }
  if (Object.keys(writes).length) await chrome.storage.local.set(writes);

  return { items: itemsAdded, collections: collectionsAdded };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(ITEM_PREFIX));
  keys.push(COLLECTION_KEY);
  await chrome.storage.local.remove(keys);
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
