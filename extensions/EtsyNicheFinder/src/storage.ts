/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere (PRD-20 §6). Two kinds of state live here:
 *
 *  - Snapshots: permanent, created only by the user's own "+ Save niche"
 *    click (PRD-20 §4). Never written automatically.
 *  - Cache: ephemeral, per-query accumulation of listings across the pages
 *    the user actually paginates through (PRD-20 §7 "pagination"), so page 2
 *    of a search adds to page 1's sample instead of replacing it. Capped and
 *    time-boxed so a broad query can't grow storage without bound, and never
 *    written to except in response to a page the user is currently viewing —
 *    no background crawling (the hard "foreground only" constraint).
 */

import { Listing, NicheStats, Snapshot, SnapshotRecord } from './types';

const SNAPSHOT_PREFIX = 'enf:snap:';
const CACHE_PREFIX = 'enf:cache:';
const OPTIONS_KEY = 'enf:options';

const MAX_SNAPSHOTS_PER_QUERY = 10;
const MAX_CACHE_LISTINGS = 600;
const MAX_CACHE_PAGES = 10;
const CACHE_TTL_MS = 3 * 60 * 60 * 1000; // 3 hours — long enough to paginate, short enough not to accumulate forever

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested (not used here). */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

/* ── Snapshots ───────────────────────────────────────────────────────── */

function snapshotKey(queryKey: string): string {
  return SNAPSHOT_PREFIX + queryKey;
}

export async function readSnapshotRecord(queryKey: string): Promise<SnapshotRecord | null> {
  const key = snapshotKey(queryKey);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as SnapshotRecord | undefined) ?? null;
}

/** Appends today's numbers for this query. User-triggered only — see module docs. */
export async function saveSnapshot(queryKey: string, query: string, stats: NicheStats): Promise<SnapshotRecord> {
  const existing = (await readSnapshotRecord(queryKey)) ?? { queryKey, query, snapshots: [] };
  const snapshot: Snapshot = { savedAt: Date.now(), stats };
  const snapshots = [...existing.snapshots, snapshot]
    .sort((a, b) => a.savedAt - b.savedAt)
    .slice(-MAX_SNAPSHOTS_PER_QUERY);
  const record: SnapshotRecord = { queryKey, query, snapshots };
  await chrome.storage.local.set({ [snapshotKey(queryKey)]: record });
  return record;
}

export async function deleteSnapshotRecord(queryKey: string): Promise<void> {
  await chrome.storage.local.remove(snapshotKey(queryKey));
}

export interface SnapshotSummary {
  queryKey: string;
  query: string;
  savedAt: number;
  count: number;
}

/** For the popup's "your saved niches" list — newest save per query, most recent first. */
export async function readAllSnapshotSummaries(): Promise<SnapshotSummary[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(SNAPSHOT_PREFIX))
    .map(([, value]) => value as SnapshotRecord)
    .filter(record => record?.snapshots?.length)
    .map(record => ({
      queryKey: record.queryKey,
      query: record.query,
      savedAt: record.snapshots[record.snapshots.length - 1].savedAt,
      count: record.snapshots.length,
    }))
    .sort((a, b) => b.savedAt - a.savedAt);
}

/* ── Ephemeral pagination cache ──────────────────────────────────────── */

interface CacheEntry {
  queryKey: string;
  query: string;
  pages: number[];
  listings: Listing[];
  updatedAt: number;
}

function cacheKey(queryKey: string): string {
  return CACHE_PREFIX + queryKey;
}

export async function readCache(queryKey: string): Promise<CacheEntry | null> {
  const key = cacheKey(queryKey);
  const stored = await chrome.storage.local.get(key);
  const entry = stored?.[key] as CacheEntry | undefined;
  if (!entry || Date.now() - entry.updatedAt > CACHE_TTL_MS) return null;
  return entry;
}

/** Merges this page's listings into the running sample for this query. */
export async function mergeCache(queryKey: string, query: string, page: number, listings: Listing[]): Promise<CacheEntry> {
  const existing = await readCache(queryKey);
  const byId = new Map<string, Listing>((existing?.listings ?? []).map(l => [l.id, l]));
  for (const listing of listings) byId.set(listing.id, listing);

  const merged: CacheEntry = {
    queryKey,
    query,
    pages: [...new Set([...(existing?.pages ?? []), page])].sort((a, b) => a - b).slice(0, MAX_CACHE_PAGES),
    listings: [...byId.values()].slice(0, MAX_CACHE_LISTINGS),
    updatedAt: Date.now(),
  };
  await chrome.storage.local.set({ [cacheKey(queryKey)]: merged });
  return merged;
}

/** Opportunistic cleanup, run once per content-script boot — no alarms, no timers. */
export async function pruneStaleCache(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const stale = Object.entries(all)
    .filter(([key, value]) => key.startsWith(CACHE_PREFIX) && Date.now() - ((value as CacheEntry)?.updatedAt ?? 0) > CACHE_TTL_MS)
    .map(([key]) => key);
  if (stale.length) await chrome.storage.local.remove(stale);
}

/* ── Whole-library operations (export all / import / clear all) ────────
   Every product that stores anything owns this trio — hard constraint, not
   a nice-to-have. */

export interface Backup {
  format: 'etsy-niche-finder';
  version: 1;
  exportedAt: string;
  snapshots: SnapshotRecord[];
}

export async function exportBackup(): Promise<Backup> {
  const all = await chrome.storage.local.get(null);
  const snapshots = Object.entries(all)
    .filter(([key]) => key.startsWith(SNAPSHOT_PREFIX))
    .map(([, value]) => value as SnapshotRecord)
    .filter(record => record?.snapshots?.length);
  return { format: 'etsy-niche-finder', version: 1, exportedAt: new Date().toISOString(), snapshots };
}

export interface ImportResult {
  queries: number;
  snapshots: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'etsy-niche-finder' || !Array.isArray(backup.snapshots)) {
    throw new Error('That file is not an Etsy Niche Opportunity Finder backup.');
  }

  let queries = 0;
  let snapshots = 0;

  for (const incoming of backup.snapshots) {
    if (!incoming?.queryKey || !Array.isArray(incoming.snapshots)) continue;

    const existing = await readSnapshotRecord(incoming.queryKey);
    const bySavedAt = new Map<number, Snapshot>((existing?.snapshots ?? []).map(s => [s.savedAt, s]));
    for (const snap of incoming.snapshots) {
      if (!snap?.savedAt || !snap.stats) continue;
      if (!bySavedAt.has(snap.savedAt)) snapshots++;
      bySavedAt.set(snap.savedAt, snap);
    }

    const merged: SnapshotRecord = {
      queryKey: incoming.queryKey,
      query: incoming.query || existing?.query || incoming.queryKey,
      snapshots: [...bySavedAt.values()].sort((a, b) => a.savedAt - b.savedAt).slice(-MAX_SNAPSHOTS_PER_QUERY),
    };
    await chrome.storage.local.set({ [snapshotKey(incoming.queryKey)]: merged });
    queries++;
  }

  return { queries, snapshots };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(SNAPSHOT_PREFIX) || key.startsWith(CACHE_PREFIX));
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

/* ── Options ─────────────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
