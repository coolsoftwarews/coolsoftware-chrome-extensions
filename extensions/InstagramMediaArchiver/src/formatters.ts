/**
 * Export formatting for the local archive log — CSV and the JSON backup
 * shape. Pure, no DOM, no chrome.* — covered by scripts/selftest.mjs.
 *
 * Export-only: per PRD §10, this log deliberately has no import path. The
 * real artifact this product produces is the downloaded media file itself,
 * already sitting on disk — the log is a disposable convenience record of
 * what happened, not something a user is expected to restore onto a new
 * machine. That can change if a real user asks for it; until then, keep it
 * simple.
 */

import { Backup, LogEntry } from './types';

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

const CSV_HEADERS = ['Saved at', 'Handle', 'Post URL', 'Post ID', 'Media type', 'Filename'];

export function toCsv(entries: LogEntry[]): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const entry of entries) {
    rows.push(
      [
        new Date(entry.savedAt).toISOString(),
        entry.handle,
        entry.postUrl,
        entry.postId,
        entry.mediaKind,
        entry.filename,
      ]
        .map(v => csvCell(String(v)))
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

export function toBackup(entries: LogEntry[]): Backup {
  return {
    format: 'instagram-media-archiver',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function toJson(entries: LogEntry[]): string {
  return JSON.stringify(toBackup(entries), null, 2);
}

export function buildExportFilename(kind: 'csv' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `instagram-media-archiver-log-${stamp}.${kind}`;
}
