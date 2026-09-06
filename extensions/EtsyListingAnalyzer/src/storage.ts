/**
 * chrome.storage.local is the whole backend (PRD: "Backend: None"). Two kinds
 * of record live here: the compare tray (up to 6 listings, PRD §4) and saved
 * teardowns (one per listing, with a note and a snapshot history so a revisit
 * can show what changed). Everything the user creates is theirs: export all /
 * import / clear all (docs/extensions/README.md's hard constraints).
 */

import { CompareTray, SavedTeardown, Teardown, TRAY_LIMIT } from './types';

const TRAY_KEY = 'ela:tray';
const SAVED_PREFIX = 'ela:saved:';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function savedKey(listingId: string): string {
  return SAVED_PREFIX + listingId;
}

/* ── Compare tray ────────────────────────────────────────────────────── */

export async function readTray(): Promise<Teardown[]> {
  const stored = await chrome.storage.local.get(TRAY_KEY);
  const tray = stored?.[TRAY_KEY] as CompareTray | undefined;
  return Array.isArray(tray?.entries) ? tray!.entries : [];
}

async function writeTray(entries: Teardown[]): Promise<void> {
  await chrome.storage.local.set({ [TRAY_KEY]: { entries } satisfies CompareTray });
}

export interface TrayResult {
  ok: boolean;
  reason?: string;
  entries: Teardown[];
}

export async function addToTray(teardown: Teardown): Promise<TrayResult> {
  const entries = await readTray();
  if (entries.some(e => e.listingId === teardown.listingId)) {
    return { ok: false, reason: 'This listing is already in the compare tray.', entries };
  }
  if (entries.length >= TRAY_LIMIT) {
    return { ok: false, reason: `The compare tray holds ${TRAY_LIMIT} listings — remove one first.`, entries };
  }
  const next = [...entries, teardown];
  await writeTray(next);
  return { ok: true, entries: next };
}

export async function removeFromTray(listingId: string): Promise<Teardown[]> {
  const next = (await readTray()).filter(e => e.listingId !== listingId);
  await writeTray(next);
  return next;
}

export async function clearTray(): Promise<void> {
  await chrome.storage.local.remove(TRAY_KEY);
}

/* ── Saved teardowns ─────────────────────────────────────────────────── */

export async function readSaved(listingId: string): Promise<SavedTeardown | null> {
  const key = savedKey(listingId);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as SavedTeardown | undefined) ?? null;
}

export async function listSaved(): Promise<SavedTeardown[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(SAVED_PREFIX))
    .map(([, value]) => value as SavedTeardown)
    .filter(record => record && record.listingId && Array.isArray(record.snapshots))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

/**
 * Appends a new snapshot unless the listing is unchanged since the last one
 * (revisiting an unchanged listing shouldn't spam the history). The note is
 * always updated, even when the snapshot isn't.
 */
export async function saveTeardown(teardown: Teardown, note: string): Promise<SavedTeardown> {
  const existing = await readSaved(teardown.listingId);
  const last = existing?.snapshots[existing.snapshots.length - 1];
  const unchanged = last && JSON.stringify({ ...last, capturedAt: 0 }) === JSON.stringify({ ...teardown, capturedAt: 0 });

  const record: SavedTeardown = {
    listingId: teardown.listingId,
    note,
    snapshots: unchanged ? existing!.snapshots : [...(existing?.snapshots ?? []), teardown],
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [savedKey(teardown.listingId)]: record });
  return record;
}

export async function removeSaved(listingId: string): Promise<void> {
  await chrome.storage.local.remove(savedKey(listingId));
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'etsy-listing-analyzer';
  version: 1;
  exportedAt: string;
  tray: Teardown[];
  saved: SavedTeardown[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'etsy-listing-analyzer',
    version: 1,
    exportedAt: new Date().toISOString(),
    tray: await readTray(),
    saved: await listSaved(),
  };
}

export interface ImportResult {
  tray: number;
  saved: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'etsy-listing-analyzer' || !Array.isArray(backup.saved)) {
    throw new Error('That file is not an Etsy Listing Analyzer backup.');
  }

  let trayCount = 0;
  if (Array.isArray(backup.tray) && backup.tray.length) {
    const existingTray = await readTray();
    const byId = new Map(existingTray.map(e => [e.listingId, e]));
    for (const entry of backup.tray) {
      if (!entry?.listingId) continue;
      byId.set(entry.listingId, entry);
    }
    const merged = [...byId.values()].slice(0, TRAY_LIMIT);
    await writeTray(merged);
    trayCount = merged.length;
  }

  let savedCount = 0;
  for (const incoming of backup.saved) {
    if (!incoming?.listingId || !Array.isArray(incoming.snapshots)) continue;
    const existing = await readSaved(incoming.listingId);
    const merged: SavedTeardown = existing
      ? { ...existing, note: incoming.note || existing.note, snapshots: mergeSnapshots(existing.snapshots, incoming.snapshots) }
      : incoming;
    await chrome.storage.local.set({ [savedKey(incoming.listingId)]: merged });
    savedCount++;
  }

  return { tray: trayCount, saved: savedCount };
}

function mergeSnapshots(a: Teardown[], b: Teardown[]): Teardown[] {
  const byTime = new Map<number, Teardown>();
  for (const snap of [...a, ...b]) byTime.set(snap.capturedAt, snap);
  return [...byTime.values()].sort((x, y) => x.capturedAt - y.capturedAt);
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key === TRAY_KEY || key.startsWith(SAVED_PREFIX));
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
