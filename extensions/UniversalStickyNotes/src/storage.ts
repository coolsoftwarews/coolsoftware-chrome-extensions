/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension, which puts two obligations
 * on this file: never lose a note, and always let the user take their data
 * out (portfolio README's hard constraints, and PRD §4's data-ownership
 * triad — export / import / clear).
 */

import { Note, PageMeta, PageRecord } from './types';

export const PAGE_PREFIX = 'sn:page:';
const OPTIONS_KEY = 'sn:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

export function pageKey(normalizedUrl: string): string {
  return PAGE_PREFIX + normalizedUrl;
}

export async function readPage(normalizedUrl: string): Promise<PageRecord | null> {
  const key = pageKey(normalizedUrl);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as PageRecord | undefined) ?? null;
}

export async function writePage(record: PageRecord): Promise<void> {
  // A page with no notes is noise; drop the key instead of storing a husk.
  if (!record.notes.length) {
    await chrome.storage.local.remove(pageKey(record.meta.url));
    return;
  }
  await chrome.storage.local.set({ [pageKey(record.meta.url)]: { ...record, updatedAt: Date.now() } });
}

export async function deletePage(normalizedUrl: string): Promise<void> {
  await chrome.storage.local.remove(pageKey(normalizedUrl));
}

export function emptyRecord(meta: PageMeta): PageRecord {
  return { meta, notes: [], hidden: false, updatedAt: Date.now() };
}

/**
 * Mutations are read-modify-write on one key, so concurrent calls (a drag
 * ending while a resize also finishes) would drop one of them. Serializing
 * per page, per calling context, costs nothing at this volume.
 */
const queues = new Map<string, Promise<unknown>>();

/** Used by the content script, which knows the page's real metadata and can
 * create a page record that doesn't exist yet. */
export function mutatePage<T>(
  normalizedUrl: string,
  meta: PageMeta,
  mutate: (record: PageRecord) => T
): Promise<T> {
  const previous = queues.get(normalizedUrl) ?? Promise.resolve();
  const next = previous.then(async () => {
    const record = (await readPage(normalizedUrl)) ?? emptyRecord(meta);
    // Metadata can improve after a late-loading page settles; keep the best we have.
    record.meta = { ...record.meta, ...meta, captured: record.meta.captured || meta.captured };
    const result = mutate(record);
    await writePage(record);
    return result;
  });
  queues.set(
    normalizedUrl,
    next.catch(() => undefined)
  );
  return next;
}

/**
 * Used by the side panel, which manages notes across pages that may not have
 * a tab open right now and has no real metadata of its own to offer. Never
 * creates a page — if the record is gone, there is nothing to mutate.
 */
export function mutateExistingPage<T>(
  normalizedUrl: string,
  mutate: (record: PageRecord) => T
): Promise<T | undefined> {
  const previous = queues.get(normalizedUrl) ?? Promise.resolve();
  const next: Promise<T | undefined> = previous.then(async () => {
    const record = await readPage(normalizedUrl);
    if (!record) return undefined;
    const result = mutate(record);
    await writePage(record);
    return result;
  });
  queues.set(
    normalizedUrl,
    next.catch(() => undefined)
  );
  return next;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'universal-sticky-notes';
  version: 1;
  exportedAt: string;
  pages: PageRecord[];
}

export async function readAllPages(): Promise<PageRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PAGE_PREFIX))
    .map(([, value]) => value as PageRecord)
    .filter(record => record && record.meta && Array.isArray(record.notes))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'universal-sticky-notes',
    version: 1,
    exportedAt: new Date().toISOString(),
    pages: await readAllPages(),
  };
}

export interface ImportResult {
  pages: number;
  notes: number;
}

/**
 * Merges a backup into local storage. Existing pages are merged rather than
 * replaced, and notes are matched by id — importing the same file twice must
 * not double every note.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'universal-sticky-notes' || !Array.isArray(backup.pages)) {
    throw new Error('That file is not a Universal Sticky Notes backup.');
  }

  let pages = 0;
  let notes = 0;

  for (const incoming of backup.pages) {
    if (!incoming?.meta?.url || !Array.isArray(incoming.notes)) continue;

    const existing = await readPage(incoming.meta.url);
    const merged: PageRecord = existing
      ? { ...existing, meta: { ...existing.meta, ...incoming.meta } }
      : { ...incoming, notes: [] };

    const byId = new Map<string, Note>(merged.notes.map(note => [note.id, note]));
    for (const note of incoming.notes) {
      if (!note?.id || typeof note.text !== 'string') continue;
      if (!byId.has(note.id)) notes++;
      byId.set(note.id, note);
    }

    merged.notes = [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
    merged.hidden = existing?.hidden ?? incoming.hidden ?? false;
    await writePage(merged);
    pages++;
  }

  return { pages, notes };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(PAGE_PREFIX));
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

/* ── Options (currently unused, reserved for future panel prefs) ───────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
