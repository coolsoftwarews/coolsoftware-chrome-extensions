/**
 * chrome.storage.local is the whole backend (PRD §5/§6: no server, no
 * account, no network call anywhere). This file owns the watchlist — the one
 * feature that persists across visits — plus the export/import/clear-all
 * backup format every extension in this portfolio ships.
 */

import { FilterState, ProductWatch, ProductWatchSnapshot, SearchWatch, SearchWatchSnapshot } from './types';

const SEARCH_WATCH_PREFIX = 'apo:watch:search:';
const PRODUCT_WATCH_PREFIX = 'apo:watch:product:';
const OPTIONS_KEY = 'apo:options';

/** Enough history to see a trend without the watchlist growing without bound. */
const MAX_SNAPSHOTS = 30;

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function searchWatchKey(key: string): string {
  return SEARCH_WATCH_PREFIX + key;
}

function productWatchKey(marketplace: string, asin: string): string {
  return PRODUCT_WATCH_PREFIX + marketplace + ':' + asin;
}

/** `.at(-1)` needs ES2022 lib; this tsconfig targets ES2020 like the rest of the portfolio. */
function last<T>(items: T[]): T | undefined {
  return items.length ? items[items.length - 1] : undefined;
}

/* ── Search watches ──────────────────────────────────────────────────── */

export async function readSearchWatch(key: string): Promise<SearchWatch | null> {
  const storageKey = searchWatchKey(key);
  const stored = await chrome.storage.local.get(storageKey);
  return (stored?.[storageKey] as SearchWatch | undefined) ?? null;
}

export async function listSearchWatches(): Promise<SearchWatch[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(SEARCH_WATCH_PREFIX))
    .map(([, v]) => v as SearchWatch)
    .filter(w => w && w.key && Array.isArray(w.snapshots))
    .sort((a, b) => (last(b.snapshots)?.capturedAt ?? '').localeCompare(last(a.snapshots)?.capturedAt ?? ''));
}

export async function addSearchSnapshot(
  key: string,
  meta: { marketplace: string; query: string; url: string },
  snapshot: SearchWatchSnapshot
): Promise<SearchWatch> {
  const existing = await readSearchWatch(key);
  const watch: SearchWatch = existing ?? {
    key,
    marketplace: meta.marketplace,
    query: meta.query,
    url: meta.url,
    createdAt: snapshot.capturedAt,
    snapshots: [],
  };
  watch.url = meta.url || watch.url;
  watch.snapshots = [...watch.snapshots, snapshot].slice(-MAX_SNAPSHOTS);
  await chrome.storage.local.set({ [searchWatchKey(key)]: watch });
  return watch;
}

export async function removeSearchWatch(key: string): Promise<void> {
  await chrome.storage.local.remove(searchWatchKey(key));
}

/* ── Product watches ─────────────────────────────────────────────────── */

export async function readProductWatch(marketplace: string, asin: string): Promise<ProductWatch | null> {
  const storageKey = productWatchKey(marketplace, asin);
  const stored = await chrome.storage.local.get(storageKey);
  return (stored?.[storageKey] as ProductWatch | undefined) ?? null;
}

export async function listProductWatches(): Promise<ProductWatch[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([k]) => k.startsWith(PRODUCT_WATCH_PREFIX))
    .map(([, v]) => v as ProductWatch)
    .filter(w => w && w.asin && Array.isArray(w.snapshots))
    .sort((a, b) => (last(b.snapshots)?.capturedAt ?? '').localeCompare(last(a.snapshots)?.capturedAt ?? ''));
}

export async function addProductSnapshot(
  marketplace: string,
  asin: string,
  meta: { title: string; url: string },
  snapshot: ProductWatchSnapshot
): Promise<ProductWatch> {
  const existing = await readProductWatch(marketplace, asin);
  const watch: ProductWatch = existing ?? {
    asin,
    marketplace,
    title: meta.title,
    url: meta.url,
    createdAt: snapshot.capturedAt,
    snapshots: [],
  };
  watch.title = meta.title || watch.title;
  watch.url = meta.url || watch.url;
  watch.snapshots = [...watch.snapshots, snapshot].slice(-MAX_SNAPSHOTS);
  await chrome.storage.local.set({ [productWatchKey(marketplace, asin)]: watch });
  return watch;
}

export async function removeProductWatch(marketplace: string, asin: string): Promise<void> {
  await chrome.storage.local.remove(productWatchKey(marketplace, asin));
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'amazon-product-opportunity';
  version: 1;
  exportedAt: string;
  searchWatches: SearchWatch[];
  productWatches: ProductWatch[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'amazon-product-opportunity',
    version: 1,
    exportedAt: new Date().toISOString(),
    searchWatches: await listSearchWatches(),
    productWatches: await listProductWatches(),
  };
}

export interface ImportResult {
  searches: number;
  products: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (
    !backup ||
    backup.format !== 'amazon-product-opportunity' ||
    !Array.isArray(backup.searchWatches) ||
    !Array.isArray(backup.productWatches)
  ) {
    throw new Error('That file is not an Amazon Product Opportunity backup.');
  }

  let searches = 0;
  for (const watch of backup.searchWatches) {
    if (!watch?.key || !Array.isArray(watch.snapshots)) continue;
    await chrome.storage.local.set({ [searchWatchKey(watch.key)]: watch });
    searches++;
  }

  let products = 0;
  for (const watch of backup.productWatches) {
    if (!watch?.asin || !watch?.marketplace || !Array.isArray(watch.snapshots)) continue;
    await chrome.storage.local.set({ [productWatchKey(watch.marketplace, watch.asin)]: watch });
    products++;
  }

  return { searches, products };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(k => k.startsWith(SEARCH_WATCH_PREFIX) || k.startsWith(PRODUCT_WATCH_PREFIX));
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

/* ── Filter preferences ──────────────────────────────────────────────── */

export async function readOptions(fallback: FilterState): Promise<FilterState> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<FilterState>) ?? {}) };
}

export async function writeOptions(options: FilterState): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
