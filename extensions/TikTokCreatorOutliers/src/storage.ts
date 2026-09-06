/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere (README "Hard constraints"). PRD §4 keeps the stored
 * product data deliberately narrow: "cached medians per creator, last-used
 * filter. Nothing else." Usage counters live separately in metrics.ts.
 */

import { Backup, DEFAULT_FILTERS, FilterState, MedianCacheEntry } from './types';

const FILTERS_KEY = 'tco:filters';
const MEDIAN_PREFIX = 'tco:median:';

/** Cached medians are a convenience, not a record of truth — stale numbers are worse than none. */
const MEDIAN_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export async function readFilters(): Promise<FilterState> {
  const stored = await chrome.storage.local.get(FILTERS_KEY);
  return { ...DEFAULT_FILTERS, ...((stored?.[FILTERS_KEY] as Partial<FilterState>) ?? {}) };
}

export async function writeFilters(filters: FilterState): Promise<void> {
  await chrome.storage.local.set({ [FILTERS_KEY]: filters });
}

export async function readMedianCache(profileId: string): Promise<MedianCacheEntry | null> {
  const key = MEDIAN_PREFIX + profileId;
  const stored = await chrome.storage.local.get(key);
  const entry = stored?.[key] as MedianCacheEntry | undefined;
  if (!entry) return null;
  if (Date.now() - entry.updatedAt > MEDIAN_TTL_MS) return null;
  return entry;
}

export async function writeMedianCache(entry: MedianCacheEntry): Promise<void> {
  await chrome.storage.local.set({ [MEDIAN_PREFIX + entry.profileId]: entry });
}

/* ── Whole-library operations (README: export all / import / clear all) ── */

async function readAllMedianCache(): Promise<MedianCacheEntry[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(MEDIAN_PREFIX))
    .map(([, value]) => value as MedianCacheEntry)
    .filter(entry => entry && typeof entry.median === 'number');
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'tiktok-creator-outliers',
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: await readFilters(),
    medianCache: await readAllMedianCache(),
  };
}

export interface ImportResult {
  profiles: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'tiktok-creator-outliers' || !Array.isArray(backup.medianCache)) {
    throw new Error('That file is not a TikTok Creator Outliers backup.');
  }

  let profiles = 0;
  for (const entry of backup.medianCache) {
    if (!entry?.profileId || typeof entry.median !== 'number') continue;
    await writeMedianCache(entry);
    profiles++;
  }

  if (backup.filters) await writeFilters({ ...DEFAULT_FILTERS, ...backup.filters });

  return { profiles };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(MEDIAN_PREFIX) || key === FILTERS_KEY);
  if (keys.length) await chrome.storage.local.remove(keys);
}
