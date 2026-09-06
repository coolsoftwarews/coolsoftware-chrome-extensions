/**
 * The entire local footprint of this extension: one value, the last format
 * the user copied. That's what makes the keyboard shortcut a one-press
 * "copy in the format I always want" action instead of always defaulting to
 * Markdown.
 */

import { DEFAULT_FORMAT, isFormatId, type FormatId } from './citation';

const KEY = 'lastUsedFormat';

export async function getLastUsedFormat(): Promise<FormatId> {
  const stored = await chrome.storage.local.get(KEY);
  const value = stored[KEY];
  return isFormatId(value) ? value : DEFAULT_FORMAT;
}

export async function setLastUsedFormat(format: FormatId): Promise<void> {
  await chrome.storage.local.set({ [KEY]: format });
}
