/**
 * chrome.storage.local holds exactly one thing this product persists across
 * sessions: the last-used export format (PRD-25 §4). There is no saved
 * library here — a thread being read lives only in the content script's and
 * panel's memory for the current session (see types.ts's ContentToPanel/
 * PanelToContent messages) and is never written to storage. That is a
 * deliberate, narrower posture than every other "Saver" extension in this
 * portfolio: this product's own PRD explicitly keeps bookmarking out of
 * scope (that's XConversationSaver, PRD-13), so nothing here should look
 * like a growing library.
 */

import { DEFAULT_OPTIONS, Options } from './types';

const OPTIONS_KEY = 'xtu:options';

export async function readOptions(): Promise<Options> {
  try {
    const stored = await chrome.storage.local.get(OPTIONS_KEY);
    const value = stored?.[OPTIONS_KEY] as Partial<Options> | undefined;
    return { ...DEFAULT_OPTIONS, ...value };
  } catch {
    return { ...DEFAULT_OPTIONS };
  }
}

export async function writeOptions(options: Options): Promise<void> {
  try {
    await chrome.storage.local.set({ [OPTIONS_KEY]: options });
  } catch {
    /* a lost preference write is never worth breaking export over */
  }
}
