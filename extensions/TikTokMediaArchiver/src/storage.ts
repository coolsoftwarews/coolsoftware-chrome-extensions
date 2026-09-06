/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD-45 §6). This file only ever
 * stores the log entry (post URL, date, saved filename) described in PRD-45
 * §4 — never the media itself. Same "Saver-lite" shape as
 * XBookmarkOrganizer's storage.ts: chrome.storage-backed reads/writes at the
 * top, pure CSV/JSON export formatting at the bottom so scripts/selftest.mjs
 * can check the export formats headlessly without touching chrome.* at all.
 */

import { LogEntry } from './types';

const LOG_PREFIX = 'tma:log:';

function logKey(id: string): string {
  return LOG_PREFIX + id;
}

/* ── Reads / writes ──────────────────────────────────────────────────── */

/** Adds or updates the log entry for a saved post — keyed by post id, so
 *  re-saving the same post updates its entry rather than duplicating it. */
export async function addLogEntry(entry: LogEntry): Promise<void> {
  await chrome.storage.local.set({ [logKey(entry.id)]: entry });
}

export async function readAllLogEntries(): Promise<LogEntry[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(LOG_PREFIX))
    .map(([, value]) => value as LogEntry)
    .filter(entry => entry && entry.id && entry.filename)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function clearAllLogEntries(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(LOG_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/* ── Export (pure — no chrome.* calls, tested headlessly) ───────────────── */

export const CSV_HEADER = ['Post URL', 'Handle', 'Post ID', 'Filename', 'Saved date'];

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

/** A row per saved-video log entry (PRD-45 §4: "Export CSV/JSON"). */
export function toCsv(entries: LogEntry[]): string {
  const rows = [CSV_HEADER.map(csvCell).join(',')];
  for (const entry of entries) {
    rows.push(
      [entry.postUrl, entry.handle, entry.postId, entry.filename, new Date(entry.savedAt).toISOString()]
        .map(v => csvCell(String(v)))
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export interface LogBackup {
  format: 'tiktok-media-archiver';
  version: 1;
  exportedAt: string;
  entries: LogEntry[];
}

export function toJson(entries: LogEntry[]): string {
  const backup: LogBackup = {
    format: 'tiktok-media-archiver',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  return JSON.stringify(backup, null, 2);
}

export function buildExportFilename(kind: 'csv' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `tiktok-media-archiver-log-${stamp}.${kind}`;
}
