/**
 * chrome.storage.local is the whole backend. This product doesn't build a
 * library of scraped content — every export is a one-shot file — so the only
 * thing worth persisting is the user's format preference. Still exposed with
 * an explicit clear, per the portfolio's "everything the user creates is
 * theirs" rule (docs/extensions/README.md).
 */

import { ExportFormat } from './types';

const PREFS_KEY = 'uts:prefs';

export interface Prefs {
  lastFormat: ExportFormat;
}

const DEFAULT_PREFS: Prefs = { lastFormat: 'csv' };

export async function readPrefs(): Promise<Prefs> {
  try {
    const stored = await chrome.storage.local.get(PREFS_KEY);
    return { ...DEFAULT_PREFS, ...((stored?.[PREFS_KEY] as Partial<Prefs>) ?? {}) };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function writePrefs(prefs: Prefs): Promise<void> {
  try {
    await chrome.storage.local.set({ [PREFS_KEY]: prefs });
  } catch {
    /* best-effort; never block an export over a preference write */
  }
}

export async function clearPrefs(): Promise<void> {
  try {
    await chrome.storage.local.remove(PREFS_KEY);
  } catch {
    /* ignore */
  }
}
