/**
 * chrome.storage.local is the whole backend — there is no server, no
 * account and no network call anywhere in this extension beyond the
 * download itself (PRD §6). Unlike this portfolio's "Saver" pattern
 * (XBookmarkOrganizer, XConversationSaver), there is no library of saved
 * *content* here — only a flat log of what's been archived (post URL, date,
 * media type, filename), per PRD §4. The CSV/JSON string-building itself is
 * pure and lives in parse.ts so it can be tested headlessly; this file is
 * just the async chrome.storage.local plumbing around it.
 */

import { buildExportFilename, buildLogCsv, buildLogJson } from './parse';
import { ExportFormat, LogEntry } from './types';

const LOG_PREFIX = 'xma:log:';

function logKey(id: string): string {
  return LOG_PREFIX + id;
}

export async function addLogEntry(entry: LogEntry): Promise<void> {
  await chrome.storage.local.set({ [logKey(entry.id)]: entry });
}

export async function readAllLogEntries(): Promise<LogEntry[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(LOG_PREFIX))
    .map(([, value]) => value as LogEntry)
    .filter(entry => entry && entry.id && entry.filename)
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(LOG_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export interface ExportResult {
  filename: string;
  content: string;
  mimeType: string;
}

/** Builds the exported file's name/content/mime type; the caller (popup.ts,
 *  an extension page and therefore able to call chrome.downloads directly)
 *  turns that into an actual download. */
export async function buildExport(format: ExportFormat): Promise<ExportResult> {
  const entries = await readAllLogEntries();
  const filename = buildExportFilename(format);
  if (format === 'csv') {
    return { filename, content: buildLogCsv(entries), mimeType: 'text/csv' };
  }
  return { filename, content: buildLogJson(entries), mimeType: 'application/json' };
}
