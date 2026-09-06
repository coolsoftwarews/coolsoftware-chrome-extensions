/**
 * chrome.storage.local is the whole backend — no server, no account
 * (PRD §6/§8). This log records only what was saved (post URL, handle,
 * media type, filename, date), never the media itself, so it stays far
 * under quota. Same one-key-per-item shape as WebHighlighter's and
 * XBookmarkOrganizer's storage.ts (the "Saver" pattern in
 * docs/extensions/README.md), minus an import path — PRD §10 explicitly
 * defers that until a real user asks for it.
 */

import { LogEntry } from './types';

const ENTRY_PREFIX = 'ima:entry:';

function entryKey(id: string): string {
  return ENTRY_PREFIX + id;
}

export async function addLogEntry(entry: LogEntry): Promise<void> {
  await chrome.storage.local.set({ [entryKey(entry.id)]: entry });
}

export async function readAllEntries(): Promise<LogEntry[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(ENTRY_PREFIX))
    .map(([, value]) => value as LogEntry)
    .filter(entry => entry && entry.id && entry.postUrl)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export async function clearAllEntries(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(ENTRY_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}
