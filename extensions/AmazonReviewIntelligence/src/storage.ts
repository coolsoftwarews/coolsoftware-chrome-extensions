/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §6). Records are keyed by
 * ASIN so reviews accumulate as the user navigates their own review pages
 * (PRD §5), never by fetching anything ourselves.
 */

import { AsinRecord, Filters, HistorySnapshot, Review } from './types';

const ASIN_PREFIX = 'ari:asin:';
const OPTIONS_KEY = 'ari:options';

const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;
const MAX_HISTORY_ENTRIES = 60;

export function asinKey(asin: string): string {
  return ASIN_PREFIX + asin;
}

export async function readAsin(asin: string): Promise<AsinRecord | null> {
  const key = asinKey(asin);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as AsinRecord | undefined) ?? null;
}

export async function writeAsin(record: AsinRecord): Promise<void> {
  await chrome.storage.local.set({ [asinKey(record.asin)]: { ...record, updatedAt: Date.now() } });
}

export function emptyAsinRecord(asin: string, productTitle: string, productUrl: string, domain: string): AsinRecord {
  return { asin, productTitle, productUrl, domain, reviews: [], note: '', history: [], updatedAt: Date.now() };
}

function mergeReviews(existing: Review[], incoming: Review[]): { reviews: Review[]; added: number } {
  const byId = new Map(existing.map(r => [r.id, r]));
  let added = 0;
  for (const review of incoming) {
    if (!byId.has(review.id)) added++;
    byId.set(review.id, review); // the freshest read of a review wins (e.g. a vote count going up)
  }
  return { reviews: [...byId.values()], added };
}

/**
 * Mutations are read-modify-write on one key, so two nearly-simultaneous page
 * scans for the same ASIN (e.g. two tabs) would drop one. Serializing per
 * ASIN costs nothing at this volume.
 */
const queues = new Map<string, Promise<unknown>>();

function mutateAsin<T>(asin: string, mutate: (record: AsinRecord) => T, seed: () => AsinRecord): Promise<T> {
  const previous = queues.get(asin) ?? Promise.resolve();
  const next = previous.then(async () => {
    const record = (await readAsin(asin)) ?? seed();
    const result = mutate(record);
    await writeAsin(record);
    return result;
  });
  queues.set(
    asin,
    next.catch(() => undefined),
  );
  return next;
}

export interface AccumulateResult {
  totalAccumulated: number;
  added: number;
}

/** Merges freshly-scanned reviews from the page the user is on into the ASIN's record. */
export function accumulateReviews(
  ctx: { asin: string; productTitle: string; productUrl: string; domain: string },
  incoming: Review[],
): Promise<AccumulateResult> {
  return mutateAsin(
    ctx.asin,
    record => {
      record.productTitle = ctx.productTitle || record.productTitle;
      record.productUrl = ctx.productUrl || record.productUrl;
      record.domain = ctx.domain || record.domain;
      const { reviews, added } = mergeReviews(record.reviews, incoming);
      record.reviews = reviews;
      return { totalAccumulated: reviews.length, added };
    },
    () => emptyAsinRecord(ctx.asin, ctx.productTitle, ctx.productUrl, ctx.domain),
  );
}

export async function setNote(asin: string, note: string): Promise<void> {
  const record = await readAsin(asin);
  if (!record) return;
  record.note = note;
  await writeAsin(record);
}

/**
 * Appends today's theme counts to history so the next run can say "up from
 * 18 to 31" (PRD §4). One entry per calendar day — re-opening the panel five
 * times today does not create five rows.
 */
export async function recordSnapshot(asin: string, snapshot: Omit<HistorySnapshot, 'date'>): Promise<void> {
  const record = await readAsin(asin);
  if (!record) return;
  const date = new Date().toISOString().slice(0, 10);
  const withoutToday = record.history.filter(h => h.date !== date);
  record.history = [...withoutToday, { date, ...snapshot }]
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(-MAX_HISTORY_ENTRIES);
  await writeAsin(record);
}

/** The most recent snapshot strictly before today, for the delta comparison. */
export function previousSnapshot(record: AsinRecord): HistorySnapshot | null {
  const today = new Date().toISOString().slice(0, 10);
  const before = record.history.filter(h => h.date < today);
  return before.length ? before[before.length - 1] : null;
}

/* ── Whole-library operations ────────────────────────────────────────── */

export interface Backup {
  format: 'amazon-review-intelligence';
  version: 1;
  exportedAt: string;
  products: AsinRecord[];
}

export async function readAllAsins(): Promise<AsinRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ASIN_PREFIX))
    .map(([, value]) => value as AsinRecord)
    .filter(record => record && record.asin && Array.isArray(record.reviews))
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'amazon-review-intelligence',
    version: 1,
    exportedAt: new Date().toISOString(),
    products: await readAllAsins(),
  };
}

export interface ImportResult {
  products: number;
  reviews: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'amazon-review-intelligence' || !Array.isArray(backup.products)) {
    throw new Error('That file is not an Amazon Review Intelligence backup.');
  }

  let products = 0;
  let reviews = 0;

  for (const incoming of backup.products) {
    if (!incoming?.asin || !Array.isArray(incoming.reviews)) continue;
    const existing = await readAsin(incoming.asin);
    const merged = existing ? { ...existing } : emptyAsinRecord(incoming.asin, incoming.productTitle, incoming.productUrl, incoming.domain);
    const { reviews: mergedReviews, added } = mergeReviews(merged.reviews, incoming.reviews);
    merged.reviews = mergedReviews;
    merged.note = incoming.note || merged.note || '';
    merged.productTitle = merged.productTitle || incoming.productTitle;
    merged.productUrl = merged.productUrl || incoming.productUrl;
    merged.domain = merged.domain || incoming.domain;

    const historyByDate = new Map(merged.history.map(h => [h.date, h]));
    for (const entry of incoming.history ?? []) historyByDate.set(entry.date, entry);
    merged.history = [...historyByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-MAX_HISTORY_ENTRIES);

    await writeAsin(merged);
    products++;
    reviews += added;
  }

  return { products, reviews };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(ASIN_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function clearAsin(asin: string): Promise<void> {
  await chrome.storage.local.remove(asinKey(asin));
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

/* ── Filters (persisted across popup opens) ──────────────────────────── */

export async function readFilters(fallback: Filters): Promise<Filters> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...fallback, ...((stored?.[OPTIONS_KEY] as Partial<Filters>) ?? {}) };
}

export async function writeFilters(filters: Filters): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: filters });
}
