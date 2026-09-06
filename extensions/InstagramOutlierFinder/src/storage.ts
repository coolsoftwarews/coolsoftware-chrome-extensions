/**
 * chrome.storage.local is the whole backend (PRD §4: "that's the whole
 * storage story"). Three things live here: the last-used filter, a small
 * cache of computed medians per profile so revisiting is instant, and the
 * local usage counters in metrics.ts. No account, no server, nothing ever
 * transmitted — see PRIVACY.md.
 */

import { Backup, FilterState, DEFAULT_FILTERS, ProfileCacheRecord } from './types';

const FILTER_KEY = 'iof:filter';
const CACHE_PREFIX = 'iof:cache:';

/** A cached median older than this is treated as stale rather than instant-shown as fact. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/* ── Last-used filter ────────────────────────────────────────────────── */

export async function readFilters(): Promise<FilterState> {
  try {
    const stored = await chrome.storage.local.get(FILTER_KEY);
    const value = stored?.[FILTER_KEY] as Partial<FilterState> | undefined;
    return { ...DEFAULT_FILTERS, ...(value ?? {}) };
  } catch {
    return { ...DEFAULT_FILTERS };
  }
}

export async function writeFilters(filters: FilterState): Promise<void> {
  try {
    await chrome.storage.local.set({ [FILTER_KEY]: filters });
  } catch {
    /* the filter row still works in-memory even if persistence fails */
  }
}

/* ── Per-profile median cache ───────────────────────────────────────── */

function cacheKey(handle: string): string {
  return CACHE_PREFIX + handle.toLowerCase();
}

export async function readProfileCache(handle: string): Promise<ProfileCacheRecord | null> {
  try {
    const key = cacheKey(handle);
    const stored = await chrome.storage.local.get(key);
    const record = stored?.[key] as ProfileCacheRecord | undefined;
    if (!record) return null;
    if (Date.now() - record.computedAt > CACHE_TTL_MS) return null;
    return record;
  } catch {
    return null;
  }
}

export async function writeProfileCache(record: ProfileCacheRecord): Promise<void> {
  try {
    await chrome.storage.local.set({ [cacheKey(record.handle)]: record });
  } catch {
    /* the cache is a convenience, never a requirement */
  }
}

async function readAllProfileCaches(): Promise<ProfileCacheRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(CACHE_PREFIX))
    .map(([, value]) => value as ProfileCacheRecord)
    .filter(record => record && record.handle && record.stats);
}

/* ── Whole-library operations (export all / import / clear all) ───────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'instagram-outlier-finder',
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: await readFilters(),
    profiles: await readAllProfileCaches(),
  };
}

export interface ImportResult {
  profiles: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'instagram-outlier-finder' || !Array.isArray(backup.profiles)) {
    throw new Error('That file is not an Instagram Outlier Finder backup.');
  }

  let count = 0;
  for (const record of backup.profiles) {
    if (!record?.handle || !record?.stats) continue;
    await writeProfileCache(record);
    count++;
  }
  if (backup.filters) await writeFilters({ ...DEFAULT_FILTERS, ...backup.filters });

  return { profiles: count };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(CACHE_PREFIX) || key === FILTER_KEY);
  if (keys.length) await chrome.storage.local.remove(keys);
}
