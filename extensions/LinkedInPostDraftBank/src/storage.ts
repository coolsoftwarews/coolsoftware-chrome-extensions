/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §6). Every item lives under
 * its own key so a single save/delete never has to read-modify-write the
 * entire library.
 */

import { Backup, ImportResult, LibraryItem } from './types';

const ITEM_PREFIX = 'pdb:item:';
const OPTIONS_KEY = 'pdb:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function itemKey(id: string): string {
  return ITEM_PREFIX + id;
}

export function newId(): string {
  return `i_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export async function readAllItems(): Promise<LibraryItem[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as LibraryItem)
    .filter(item => item && typeof item.id === 'string' && typeof item.text === 'string')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function readItem(id: string): Promise<LibraryItem | null> {
  const key = itemKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as LibraryItem | undefined) ?? null;
}

export async function writeItem(item: LibraryItem): Promise<void> {
  await chrome.storage.local.set({ [itemKey(item.id)]: item });
}

export async function deleteItem(id: string): Promise<void> {
  await chrome.storage.local.remove(itemKey(id));
}

export function emptyDraft(text = ''): LibraryItem {
  const now = Date.now();
  return { id: newId(), kind: 'draft', text, tags: [], createdAt: now, updatedAt: now };
}

/**
 * Finds an archived published post by its stable LinkedIn URN, so editing a
 * post that's already live updates the existing archive row in place rather
 * than adding a near-duplicate (PRD §7).
 */
export async function findPublishedByUrn(postUrn: string): Promise<LibraryItem | null> {
  const items = await readAllItems();
  return items.find(item => item.kind === 'published' && item.postUrn === postUrn) ?? null;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-post-draft-bank',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await readAllItems(),
  };
}

/**
 * Merges a backup into local storage. An incoming item wins on a matching id
 * (same rule as WebHighlighter/XConversationSaver), so re-importing the same
 * file twice is idempotent rather than duplicating everything.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-post-draft-bank' || !Array.isArray(backup.items)) {
    throw new Error('That file is not a LinkedIn Post Draft Bank backup.');
  }

  let items = 0;
  let newItems = 0;

  for (const incoming of backup.items) {
    if (!incoming?.id || typeof incoming.text !== 'string' || !incoming.kind) continue;
    const existing = await readItem(incoming.id);
    if (!existing) newItems++;
    await writeItem({
      ...incoming,
      tags: Array.isArray(incoming.tags) ? incoming.tags : [],
    } as LibraryItem);
    items++;
  }

  return { items, newItems };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(ITEM_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
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

/* ── Options (export prefs, device preview) ─────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
