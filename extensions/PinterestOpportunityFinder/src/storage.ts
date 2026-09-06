/**
 * chrome.storage.local is the whole backend. No server, no account, no
 * network call anywhere in this extension (PRD §6 / hard constraints). The
 * only state that persists (PRD §4) is the user's last filter and a cached
 * median per query — everything else is recomputed from the page each time.
 */

import { DEFAULT_FILTERS, Filters, QueryCache } from './types';

const QUERY_PREFIX = 'pof:query:';
const FILTERS_KEY = 'pof:filters';
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function queryKey(query: string): string {
  return QUERY_PREFIX + query;
}

export async function readQueryCache(query: string): Promise<QueryCache | null> {
  const key = queryKey(query);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as QueryCache | undefined) ?? null;
}

export async function writeQueryCache(cache: QueryCache): Promise<void> {
  await chrome.storage.local.set({ [queryKey(cache.query)]: cache });
}

export async function readAllQueryCaches(): Promise<QueryCache[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(QUERY_PREFIX))
    .map(([, value]) => value as QueryCache)
    .filter(cache => cache && typeof cache.query === 'string')
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function readFilters(): Promise<Filters> {
  const stored = await chrome.storage.local.get(FILTERS_KEY);
  return { ...DEFAULT_FILTERS, ...((stored?.[FILTERS_KEY] as Partial<Filters>) ?? {}) };
}

export async function writeFilters(filters: Filters): Promise<void> {
  await chrome.storage.local.set({ [FILTERS_KEY]: filters });
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'pinterest-opportunity-finder';
  version: 1;
  exportedAt: string;
  filters: Filters;
  queries: QueryCache[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'pinterest-opportunity-finder',
    version: 1,
    exportedAt: new Date().toISOString(),
    filters: await readFilters(),
    queries: await readAllQueryCaches(),
  };
}

export interface ImportResult {
  queries: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'pinterest-opportunity-finder' || !Array.isArray(backup.queries)) {
    throw new Error('That file is not a Pinterest Opportunity Finder backup.');
  }

  let count = 0;
  for (const cache of backup.queries) {
    if (!cache?.query || typeof cache.sampleSize !== 'number') continue;
    await writeQueryCache(cache);
    count++;
  }

  if (backup.filters) await writeFilters({ ...DEFAULT_FILTERS, ...backup.filters });

  return { queries: count };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(QUERY_PREFIX) || key === FILTERS_KEY);
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
