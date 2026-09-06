/**
 * chrome.storage.local is the whole backend. No account, no server — the
 * data kept here is deliberately tiny: the last sort order and time-budget
 * value the user picked, as a convenience default for the next playlist
 * (PRD §4). No playlist contents are ever persisted beyond the current tab
 * session (the content script's live scan, which never touches storage).
 *
 * Still ships export/import/clear-all, per this portfolio's hard constraint
 * that everything a product stores must be exportable and erasable, even
 * when — as here — that's a handful of preference fields.
 */

import { DEFAULT_PREFS, Prefs } from './types';

const PREFS_KEY = 'pls:prefs';
const METRICS_KEY = 'pls:metrics';

export async function readPrefs(): Promise<Prefs> {
  const stored = await chrome.storage.local.get(PREFS_KEY);
  return { ...DEFAULT_PREFS, ...((stored?.[PREFS_KEY] as Partial<Prefs>) ?? {}) };
}

export async function writePrefs(prefs: Prefs): Promise<void> {
  await chrome.storage.local.set({ [PREFS_KEY]: prefs });
}

export interface Backup {
  format: 'youtube-playlist-sorter';
  version: 1;
  exportedAt: string;
  prefs: Prefs;
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'youtube-playlist-sorter',
    version: 1,
    exportedAt: new Date().toISOString(),
    prefs: await readPrefs(),
  };
}

export async function importBackup(raw: unknown): Promise<void> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'youtube-playlist-sorter' || !backup.prefs) {
    throw new Error('That file is not a Playlist Sorter backup.');
  }
  await writePrefs({ ...DEFAULT_PREFS, ...backup.prefs });
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove([PREFS_KEY, METRICS_KEY]);
}

export { METRICS_KEY };
