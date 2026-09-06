/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6/§7), which puts two
 * obligations on this file: never lose a save, and always let the user take
 * their data out. Same shape as WebHighlighter's and InstagramResearchSaver's
 * storage.ts — this product is the "Saver" pattern from
 * docs/extensions/README.md.
 */

import { defaultCollections } from './capture';
import { mergeImport, validateBackup } from './merge';
import { Backup, Collection, ImportResult, PinCapture, QuotaStatus } from './types';

const PIN_PREFIX = 'pcr:pin:';
const COLLECTIONS_KEY = 'pcr:collections';
const OPTIONS_KEY = 'pcr:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function pinKey(id: string): string {
  return PIN_PREFIX + id;
}

/* ── Pins ────────────────────────────────────────────────────────────── */

export async function readAllPins(): Promise<PinCapture[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PIN_PREFIX))
    .map(([, value]) => value as PinCapture)
    .filter(pin => pin && pin.id && pin.pinUrl)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export async function readPin(id: string): Promise<PinCapture | null> {
  const key = pinKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as PinCapture | undefined) ?? null;
}

export async function writePin(pin: PinCapture): Promise<void> {
  await chrome.storage.local.set({ [pinKey(pin.id)]: pin });
}

export async function writeAllPins(pins: PinCapture[]): Promise<void> {
  if (!pins.length) return;
  const entries: Record<string, PinCapture> = {};
  for (const pin of pins) entries[pinKey(pin.id)] = pin;
  await chrome.storage.local.set(entries);
}

export async function deletePin(id: string): Promise<void> {
  await chrome.storage.local.remove(pinKey(id));
}

/**
 * Persists a capture card. `build` receives the existing card (if this pin
 * was saved before) so the caller can merge rather than duplicate — see
 * capture.ts#buildCapture. Storage failures are never swallowed: PRD §8 is
 * explicit that a quota failure must fail loudly with an export prompt, never
 * drop the item silently.
 */
export async function savePin(id: string, build: (existing: PinCapture | null) => PinCapture): Promise<PinCapture> {
  const existing = await readPin(id);
  const pin = build(existing);
  try {
    await writePin(pin);
  } catch {
    throw new Error('Storage is full. Export your research, then remove a few pins to free up room, and try again.');
  }
  return pin;
}

export async function updatePin(
  id: string,
  patch: Partial<Pick<PinCapture, 'note' | 'collectionId'>>
): Promise<PinCapture | null> {
  const existing = await readPin(id);
  if (!existing) return null;
  const updated: PinCapture = { ...existing, ...patch, updatedAt: Date.now() };
  await writePin(updated);
  return updated;
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

export async function addCollection(name: string): Promise<Collection> {
  const collections = await readCollections();
  const collection: Collection = {
    id: `c_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || 'Untitled',
    createdAt: Date.now(),
  };
  await writeCollections([...collections, collection]);
  return collection;
}

export async function renameCollection(id: string, name: string): Promise<void> {
  const collections = await readCollections();
  const trimmed = name.trim();
  if (!trimmed) return;
  await writeCollections(collections.map(c => (c.id === id ? { ...c, name: trimmed } : c)));
}

/**
 * Deletes a collection. Pins inside it are reassigned to the first remaining
 * collection rather than deleted — a saved pin must never disappear because
 * of a collection edit. Deleting the last collection is refused so there is
 * always somewhere for a new save to land.
 */
export async function deleteCollection(id: string): Promise<Collection[]> {
  const collections = await readCollections();
  if (collections.length <= 1) return collections;

  const remaining = collections.filter(c => c.id !== id);
  const fallbackId = remaining[0].id;
  const pins = await readAllPins();
  const affected = pins.filter(p => p.collectionId === id);
  if (affected.length) {
    await writeAllPins(affected.map(p => ({ ...p, collectionId: fallbackId, updatedAt: Date.now() })));
  }
  await writeCollections(remaining);
  return remaining;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(PIN_PREFIX));
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

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'pinterest-competitor-research',
    version: 1,
    exportedAt: new Date().toISOString(),
    pins: await readAllPins(),
    collections: await readCollections(),
  };
}

/**
 * Merges a backup into local storage using the pure logic in merge.ts. Pins
 * matched by id and collections matched by id; the incoming file wins on
 * conflicts, so importing the same backup twice never duplicates a card.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = validateBackup(raw);
  const existingPins = await readAllPins();
  const existingCollections = await readCollections();
  const { collections, pins, stats } = mergeImport(backup, existingPins, existingCollections);
  await writeCollections(collections);
  await writeAllPins(pins);
  return stats;
}

/* ── Options ─────────────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
