/**
 * `chrome.storage.local` is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD-39 §6). Only two things are
 * ever stored: reading preferences (font/theme/width) and local usage
 * counters. No page content, no highlights, no URLs beyond nothing at all.
 *
 * Still ships export/import/clear-all, per the portfolio's own hard
 * constraint ("everything the user creates is theirs") — proportionate to
 * how little this product actually stores, but not skipped just because the
 * payload is small.
 */

import { DEFAULT_PREFERENCES, ReaderPreferences } from './types';

const PREFS_KEY = 'urm:preferences';

export async function readPreferences(): Promise<ReaderPreferences> {
  try {
    const stored = await chrome.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFERENCES, ...((stored?.[PREFS_KEY] as Partial<ReaderPreferences>) ?? {}) };
  } catch {
    return { ...DEFAULT_PREFERENCES };
  }
}

export async function writePreferences(prefs: ReaderPreferences): Promise<void> {
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  } catch {
    /* preferences are a nicety, never break the reader over a write failure */
  }
}

export interface Backup {
  format: 'universal-reader-mode';
  version: 1;
  exportedAt: string;
  preferences: ReaderPreferences;
  metrics: unknown;
}

export async function exportBackup(metrics: unknown): Promise<Backup> {
  return {
    format: 'universal-reader-mode',
    version: 1,
    exportedAt: new Date().toISOString(),
    preferences: await readPreferences(),
    metrics,
  };
}

export async function importBackup(raw: unknown): Promise<void> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'universal-reader-mode') {
    throw new Error('That file is not a Universal Reader Mode backup.');
  }
  if (backup.preferences) await writePreferences({ ...DEFAULT_PREFERENCES, ...backup.preferences });
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.clear();
}
