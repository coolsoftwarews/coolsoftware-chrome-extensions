/**
 * chrome.storage.local is the whole backend (README hard constraints: local
 * storage only, no account, no server). Three kinds of record live here:
 *
 *   - products     — what the user chose to track (the board)
 *   - creator baselines — cached medians from profile visits
 *   - coverage / metrics — local-only counters
 *
 * Un-tracked videos are never persisted (see types.ts ScannedVideo doc) —
 * only what the user explicitly tracks needs to survive a reload, which keeps
 * this file's storage footprint bounded without needing a pruning strategy.
 */

import { CoverageState, CreatorBaseline, Product, TrackedVideo } from './types';

const PRODUCT_PREFIX = 'tps:product:';
const CREATOR_PREFIX = 'tps:creator:';
const COVERAGE_KEY = 'tps:coverage';
const OPTIONS_KEY = 'tps:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested — not requested here. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

/** Baselines beyond this age are still used (a stale median beats none), but the panel flags them as stale past 30 days. */
export const BASELINE_STALE_MS = 30 * 24 * 60 * 60 * 1000;

/** Caps the dedupe window so a long browsing session cannot grow storage without bound (PRD §7: don't double-count recycled tiles). */
const COVERAGE_WINDOW = 5000;

/* ── Products ─────────────────────────────────────────────────────────── */

function productKey(id: string): string {
  return PRODUCT_PREFIX + id;
}

export async function readAllProducts(): Promise<Product[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(PRODUCT_PREFIX))
    .map(([, value]) => value as Product)
    .filter(p => p && Array.isArray(p.videos))
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function readProduct(id: string): Promise<Product | null> {
  const stored = await chrome.storage.local.get(productKey(id));
  return (stored?.[productKey(id)] as Product | undefined) ?? null;
}

export async function writeProduct(product: Product): Promise<void> {
  await chrome.storage.local.set({ [productKey(product.id)]: product });
}

export async function deleteProduct(id: string): Promise<void> {
  await chrome.storage.local.remove(productKey(id));
}

/**
 * Finds an existing product by its auto-group key (shop item / caption
 * keyword) so repeat sightings of the same product merge instead of forking
 * into duplicate cards. Manual products (typed names) are never auto-merged
 * into — the user owns that grouping decision.
 */
export async function findProductByGroupKey(groupKey: string): Promise<Product | null> {
  const products = await readAllProducts();
  return products.find(p => p.groupType !== 'manual' && p.groupKey === groupKey) ?? null;
}

/** Read-modify-write, serialized per product id so two rapid "+ Track" clicks on the same product don't race. */
const queues = new Map<string, Promise<unknown>>();

export function mutateProduct<T>(id: string, seed: Product, mutate: (product: Product) => T): Promise<T> {
  const previous = queues.get(id) ?? Promise.resolve();
  const next = previous.then(async () => {
    const product = (await readProduct(id)) ?? seed;
    const result = mutate(product);
    product.updatedAt = Date.now();
    await writeProduct(product);
    return result;
  });
  queues.set(
    id,
    next.catch(() => undefined)
  );
  return next;
}

/** Adds a video to a product, deduped by video id — re-tracking the same video (a recycled tile) is a no-op, not a duplicate row. */
export function addVideoToProduct(video: TrackedVideo, product: Product): boolean {
  if (product.videos.some(v => v.id === video.id)) return false;
  product.videos.push(video);
  return true;
}

/* ── Creator baselines ───────────────────────────────────────────────── */

function creatorKey(handle: string): string {
  return CREATOR_PREFIX + handle;
}

export async function readBaseline(handle: string): Promise<CreatorBaseline | null> {
  const key = creatorKey(handle);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as CreatorBaseline | undefined) ?? null;
}

export async function writeBaseline(baseline: CreatorBaseline): Promise<void> {
  await chrome.storage.local.set({ [creatorKey(baseline.handle)]: baseline });
}

export async function readAllBaselines(): Promise<Map<string, CreatorBaseline>> {
  const all = await chrome.storage.local.get(null);
  const map = new Map<string, CreatorBaseline>();
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith(CREATOR_PREFIX) && value) map.set((value as CreatorBaseline).handle, value as CreatorBaseline);
  }
  return map;
}

/* ── Coverage ("from N videos you've viewed") ────────────────────────── */

const EMPTY_COVERAGE: CoverageState = { videosViewedTotal: 0, recentIds: [] };

export async function readCoverage(): Promise<CoverageState> {
  const stored = await chrome.storage.local.get(COVERAGE_KEY);
  return { ...EMPTY_COVERAGE, ...((stored?.[COVERAGE_KEY] as Partial<CoverageState>) ?? {}) };
}

let coverageQueue: Promise<unknown> = Promise.resolve();

/** Records that a video was scanned this session. Returns true only if it was genuinely new (not a recycled tile). */
export function noteVideoSeen(id: string): Promise<boolean> {
  const result = coverageQueue.then(async () => {
    const coverage = await readCoverage();
    if (coverage.recentIds.includes(id)) return false;
    coverage.recentIds = [...coverage.recentIds, id].slice(-COVERAGE_WINDOW);
    coverage.videosViewedTotal += 1;
    await chrome.storage.local.set({ [COVERAGE_KEY]: coverage });
    return true;
  });
  coverageQueue = result.catch(() => undefined);
  return result;
}

/* ── Options ──────────────────────────────────────────────────────────── */

export async function readOptions<T>(fallback: T): Promise<T> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<T>) ?? {}) };
}

export async function writeOptions<T>(options: T): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}

/* ── Whole-library operations (README hard constraints: export all / import / clear all) ── */

export interface Backup {
  format: 'tiktok-product-scout';
  version: 1;
  exportedAt: string;
  products: Product[];
  baselines: CreatorBaseline[];
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'tiktok-product-scout',
    version: 1,
    exportedAt: new Date().toISOString(),
    products: await readAllProducts(),
    baselines: [...(await readAllBaselines()).values()],
  };
}

export interface ImportResult {
  products: number;
  videos: number;
  baselines: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'tiktok-product-scout' || !Array.isArray(backup.products)) {
    throw new Error('That file is not a TikTok Product Scout backup.');
  }

  let products = 0;
  let videos = 0;

  for (const incoming of backup.products) {
    if (!incoming?.id || !Array.isArray(incoming.videos)) continue;
    const existing = await readProduct(incoming.id);
    const merged: Product = existing ?? { ...incoming, videos: [] };
    if (existing) merged.name = incoming.name || merged.name;

    const byId = new Map(merged.videos.map(v => [v.id, v]));
    for (const video of incoming.videos) {
      if (!video?.id) continue;
      if (!byId.has(video.id)) videos++;
      byId.set(video.id, video);
    }
    merged.videos = [...byId.values()];
    merged.updatedAt = Date.now();
    await writeProduct(merged);
    products++;
  }

  let baselines = 0;
  for (const baseline of backup.baselines ?? []) {
    if (!baseline?.handle) continue;
    await writeBaseline(baseline);
    baselines++;
  }

  return { products, videos, baselines };
}

/** The metrics key lives in metrics.ts; duplicated here as a literal rather than imported, to keep this file free of a dependency on that one. */
const METRICS_KEY = 'tps:metrics';

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(
    key =>
      key.startsWith(PRODUCT_PREFIX) ||
      key.startsWith(CREATOR_PREFIX) ||
      key === COVERAGE_KEY ||
      key === METRICS_KEY
  );
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
