/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * import (PRD §4/§10: export only, no import needed here). Available
 * directly inside the content script (chrome.storage doesn't need the
 * background-relay chrome.downloads does), so archiving a video writes here
 * straight from content.ts.
 */

import { buildRecord, markThumbnailSaved, matchesRecordSearch, toCsv, toMarkdown } from './parse';
import { Backup, QuotaStatus, ScrapedVideo, UploadRecord } from './types';

const ITEM_PREFIX = 'yua:item:';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested —
 *  and this extension deliberately doesn't request it (minimum permissions,
 *  PRD §6). */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function itemKey(videoId: string): string {
  return ITEM_PREFIX + videoId;
}

/** Read-modify-write mutations over the same keys would race a fast double
 *  click (or a re-archive firing while an earlier one is still writing) —
 *  a single queue serializes them, same pattern as YouTubeChapterNotes's
 *  storage.ts. */
let queue: Promise<unknown> = Promise.resolve();
function mutate<T>(run: () => Promise<T>): Promise<T> {
  const next = queue.then(run);
  queue = next.catch(() => undefined);
  return next;
}

export async function readAll(): Promise<UploadRecord[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ITEM_PREFIX))
    .map(([, value]) => value as UploadRecord)
    .filter(item => item && item.videoId)
    .sort((a, b) => b.archivedAt - a.archivedAt);
}

export async function readOne(videoId: string): Promise<UploadRecord | null> {
  const key = itemKey(videoId);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as UploadRecord | undefined) ?? null;
}

/**
 * Archives (or re-archives) one video. Looks up any existing record for the
 * same video id first so a second archive updates that record in place
 * rather than creating a duplicate (PRD §7) — see parse.ts#buildRecord.
 */
export function addOrUpdateRecord(scraped: ScrapedVideo, channelKey: string, now: number = Date.now()): Promise<UploadRecord> {
  return mutate(async () => {
    const existing = await readOne(scraped.videoId);
    const record = buildRecord(scraped, existing, channelKey, now);
    try {
      await chrome.storage.local.set({ [itemKey(record.videoId)]: record });
    } catch {
      throw new Error('Storage is full. Export your archive, then remove a few entries to free up room, and try again.');
    }
    return record;
  });
}

/** Called once the background worker confirms the thumbnail image actually
 *  saved to disk (PRD §7 — a missing thumbnail retries rather than blocking
 *  the metadata entry). */
export function markThumbnailSavedFor(videoId: string, at: number = Date.now()): Promise<UploadRecord | null> {
  return mutate(async () => {
    const existing = await readOne(videoId);
    if (!existing) return null;
    const next = markThumbnailSaved(existing, at);
    await chrome.storage.local.set({ [itemKey(videoId)]: next });
    return next;
  });
}

export function deleteRecord(videoId: string): Promise<void> {
  return mutate(async () => {
    await chrome.storage.local.remove(itemKey(videoId));
  });
}

export async function searchRecords(query: string): Promise<UploadRecord[]> {
  const all = await readAll();
  return all.filter(record => matchesRecordSearch(record, query));
}

/* ── Whole-library operations ────────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'youtube-upload-archiver',
    version: 1,
    exportedAt: new Date().toISOString(),
    items: await readAll(),
  };
}

export async function exportCsvText(): Promise<string> {
  return toCsv(await readAll());
}

export async function exportMarkdownText(): Promise<string> {
  return toMarkdown(await readAll());
}

export function clearAllData(): Promise<void> {
  return mutate(async () => {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter(key => key.startsWith(ITEM_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
  });
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
