/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6/§9), which puts two
 * obligations on this file: never lose a stash, and always let the user take
 * their data out. Same "Saver" shape as WebHighlighter's storage.ts.
 *
 * The actual merge logic (matching stashes and tabs by id) is pure and lives
 * in stash.ts as `mergeBackup` — this file only does the chrome.storage IO
 * around it.
 */

import { mergeBackup, parseBackup, sortStashesByRecency } from './stash';
import { Backup, DEFAULT_OPTIONS, Options, Stash } from './types';

const STASH_PREFIX = 'uts:stash:';
const OPTIONS_KEY = 'uts:options';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function stashKey(id: string): string {
  return STASH_PREFIX + id;
}

export async function readAllStashes(): Promise<Stash[]> {
  const all = await chrome.storage.local.get(null);
  const stashes = Object.entries(all)
    .filter(([key]) => key.startsWith(STASH_PREFIX))
    .map(([, value]) => value as Stash)
    .filter(stash => stash && Array.isArray(stash.tabs) && typeof stash.name === 'string');
  return sortStashesByRecency(stashes);
}

export async function writeStash(stash: Stash): Promise<void> {
  await chrome.storage.local.set({ [stashKey(stash.id)]: stash });
}

export async function deleteStash(id: string): Promise<void> {
  await chrome.storage.local.remove(stashKey(id));
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'universal-tab-stash',
    version: 1,
    exportedAt: new Date().toISOString(),
    stashes: await readAllStashes(),
  };
}

export interface ImportResult {
  stashes: number;
  tabs: number;
}

/** Merges a backup file into local storage. Restoring the same file twice is
 *  a no-op the second time — see stash.ts's mergeBackup for the matching rule. */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = parseBackup(raw);
  const existing = await readAllStashes();
  const { merged, stats } = mergeBackup(existing, backup);

  await chrome.storage.local.set(
    Object.fromEntries(merged.map(stash => [stashKey(stash.id), stash]))
  );

  return { stashes: stats.stashes, tabs: stats.tabs };
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(STASH_PREFIX));
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

export async function readOptions(): Promise<Options> {
  const stored = await chrome.storage.local.get(OPTIONS_KEY);
  return { ...DEFAULT_OPTIONS, ...((stored?.[OPTIONS_KEY] as Partial<Options>) ?? {}) };
}

export async function writeOptions(options: Options): Promise<void> {
  await chrome.storage.local.set({ [OPTIONS_KEY]: options });
}
