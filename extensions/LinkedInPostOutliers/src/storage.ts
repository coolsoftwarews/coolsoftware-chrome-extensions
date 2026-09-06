/**
 * chrome.storage.local is the whole backend (PRD §4: "that's the whole
 * storage story"). Two things live here: the last-used filter, and a small
 * cache of the most recently computed reliable median per author so a
 * thin-sample hashtag/search page can still badge confidently after the
 * user has visited that author's profile history at least once. No account,
 * no server, nothing ever transmitted — see PRIVACY.md.
 */

import { AuthorCacheRecord, Backup, CACHE_TTL_MS, DEFAULT_FILTERS, FilterState } from './types';

const FILTER_KEY = 'lpo:filter';
const AUTHOR_PREFIX = 'lpo:author:';

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

/* ── Per-author median cache ────────────────────────────────────────── */

function authorKey(authorId: string): string {
  return AUTHOR_PREFIX + authorId.toLowerCase();
}

export async function readAuthorCache(): Promise<Map<string, AuthorCacheRecord>> {
  try {
    const all = await chrome.storage.local.get(null);
    const map = new Map<string, AuthorCacheRecord>();
    const now = Date.now();
    for (const [key, value] of Object.entries(all)) {
      if (!key.startsWith(AUTHOR_PREFIX)) continue;
      const record = value as AuthorCacheRecord;
      if (!record?.authorId || record.median === undefined) continue;
      if (now - record.computedAt > CACHE_TTL_MS) continue;
      map.set(record.authorId, record);
    }
    return map;
  } catch {
    return new Map();
  }
}

export async function writeAuthorCache(record: AuthorCacheRecord): Promise<void> {
  try {
    await chrome.storage.local.set({ [authorKey(record.authorId)]: record });
  } catch {
    /* the cache is a convenience, never a requirement */
  }
}

async function readAllAuthorRecords(): Promise<AuthorCacheRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(AUTHOR_PREFIX))
    .map(([, value]) => value as AuthorCacheRecord)
    .filter(record => record && record.authorId && typeof record.median === 'number');
}

/* ── Whole-library operations (export all / import / clear all) ───────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-post-outliers',
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: await readFilters(),
    authors: await readAllAuthorRecords(),
  };
}

export interface ImportResult {
  authors: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-post-outliers' || !Array.isArray(backup.authors)) {
    throw new Error('That file is not a LinkedIn Post Outlier Finder backup.');
  }

  let count = 0;
  for (const record of backup.authors) {
    if (!record?.authorId || typeof record.median !== 'number') continue;
    await writeAuthorCache(record);
    count++;
  }
  if (backup.filters) await writeFilters({ ...DEFAULT_FILTERS, ...backup.filters });

  return { authors: count };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(AUTHOR_PREFIX) || key === FILTER_KEY);
  if (keys.length) await chrome.storage.local.remove(keys);
}
