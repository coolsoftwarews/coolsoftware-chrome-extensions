/**
 * chrome.storage.local is the whole backend (no server, no account — see
 * PRIVACY.md). Owns settings, the daily-totals report, the session-timer
 * cursor, local usage counters, and the export/import/clear-all backup
 * format every extension in this portfolio ships.
 */
import { mergeSettings } from './settings';
import type { DailyTotals, Settings } from './types';

const SETTINGS_KEY = 'ft:settings';
const TOTALS_KEY = 'ft:totals';
const CURSOR_KEY = 'ft:cursor';
const METRICS_KEY = 'ft:metrics';

const QUOTA_BYTES = 10 * 1024 * 1024; // chrome.storage.local's default cap
const WARN_RATIO = 0.8;

/* ── Settings ────────────────────────────────────────────────────────── */

export async function readSettings(): Promise<Settings> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  return mergeSettings(stored[SETTINGS_KEY] as Partial<Settings> | undefined);
}

export async function writeSettings(settings: Settings): Promise<void> {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}

/* ── Daily totals (the report) ──────────────────────────────────────── */

export async function readTotals(): Promise<DailyTotals> {
  const stored = await chrome.storage.local.get(TOTALS_KEY);
  const value = stored[TOTALS_KEY];
  return value && typeof value === 'object' ? (value as DailyTotals) : {};
}

export async function writeTotals(totals: DailyTotals): Promise<void> {
  await chrome.storage.local.set({ [TOTALS_KEY]: totals });
}

/* ── Session-timer cursor (background.ts is the only writer) ───────── */

export async function readCursor(): Promise<number | null> {
  const stored = await chrome.storage.local.get(CURSOR_KEY);
  const value = stored[CURSOR_KEY];
  return typeof value === 'number' ? value : null;
}

export async function writeCursor(lastTickAt: number): Promise<void> {
  await chrome.storage.local.set({ [CURSOR_KEY]: lastTickAt });
}

/* ── Local-only usage counters ──────────────────────────────────────── */

export async function bumpMetric(key: string, by: number = 1): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(METRICS_KEY);
    const counters = (stored[METRICS_KEY] ?? {}) as Record<string, number>;
    counters[key] = (counters[key] ?? 0) + by;
    await chrome.storage.local.set({ [METRICS_KEY]: counters });
  } catch {
    // Counters are best-effort; must never break a feature over them.
  }
}

export async function readMetrics(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(METRICS_KEY);
  return (stored[METRICS_KEY] ?? {}) as Record<string, number>;
}

export async function clearMetrics(): Promise<void> {
  await chrome.storage.local.remove(METRICS_KEY);
}

/* ── Whole-library operations: export all / import / clear all ────── */

export interface Backup {
  format: 'youtube-focus-timer';
  version: 1;
  exportedAt: string;
  settings: Settings;
  totals: DailyTotals;
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'youtube-focus-timer',
    version: 1,
    exportedAt: new Date().toISOString(),
    settings: await readSettings(),
    totals: await readTotals(),
  };
}

export async function importBackup(raw: unknown): Promise<{ days: number }> {
  const backup = raw as Partial<Backup>;
  if (backup?.format !== 'youtube-focus-timer' || !backup.totals || typeof backup.totals !== 'object') {
    throw new Error('That file is not a YouTube Focus Timer backup.');
  }

  const settings = mergeSettings(backup.settings);
  await writeSettings(settings);

  const existing = await readTotals();
  const merged: DailyTotals = { ...existing };
  let days = 0;
  for (const [key, ms] of Object.entries(backup.totals)) {
    if (typeof ms !== 'number' || ms < 0) continue;
    // Imported figures win on a matching day, same "incoming backup wins on
    // a matching id" rule the rest of the portfolio's Saver-pattern imports
    // use — this is a restore, not a merge-the-smaller-number heuristic.
    merged[key] = ms;
    days += 1;
  }
  await writeTotals(merged);
  return { days };
}

export async function clearAllData(): Promise<void> {
  await chrome.storage.local.remove([SETTINGS_KEY, TOTALS_KEY, CURSOR_KEY]);
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
