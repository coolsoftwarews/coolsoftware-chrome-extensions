/**
 * The one file that talks to the real `chrome.tabs` API. Every function here
 * is a thin wrapper: read the current window's tabs, close a set of tabs,
 * open a set of tabs. All the decisions (what to include, how to batch, what
 * counts as "too many") are made by pure functions in stash.ts and handed to
 * this file as plain data — this file never decides anything, it only acts.
 *
 * No content script, no `activeTab`, no host permissions: `tabs` is the only
 * permission this file needs (PRD §5/§6).
 */

import { OpenTab, RestorePlan } from './types';
import { toOpenTab } from './stash';

/** Every tab in the current window, in on-screen order — the "current window
 *  only" boundary from PRD §4/§5 lives here, in the query itself. */
export async function currentWindowTabs(): Promise<OpenTab[]> {
  const tabs = await chrome.tabs.query({ currentWindow: true });
  return tabs
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .map(toOpenTab);
}

/** Closes exactly the tabs the caller names, by their live chromeTabId. Never
 *  called implicitly — only after a stash has been written and the user
 *  confirmed the close (PRD §4's "clear, undoable-feeling confirmation"). */
export async function closeTabs(chromeTabIds: number[]): Promise<void> {
  const ids = chromeTabIds.filter(id => id >= 0);
  if (!ids.length) return;
  try {
    await chrome.tabs.remove(ids);
  } catch {
    /* a tab may have already been closed by the user; nothing to recover */
  }
}

/** Opens a restore plan's batches in order, pausing briefly between batches
 *  so a 50+-tab restore doesn't stall the browser (PRD §7). */
export async function restoreTabs(plan: RestorePlan, windowId?: number): Promise<void> {
  for (const batch of plan.batches) {
    await Promise.all(
      batch.map(tab =>
        chrome.tabs.create({ url: tab.url, active: false, windowId, pinned: tab.pinned }).catch(() => undefined)
      )
    );
    if (plan.batches.length > 1) await new Promise(resolve => setTimeout(resolve, 150));
  }
}

/** Opens a single stashed tab — the "one at a time" restore mode (PRD §4). */
export async function restoreSingleTab(tab: { url: string; pinned: boolean }, windowId?: number): Promise<void> {
  await chrome.tabs.create({ url: tab.url, active: true, windowId, pinned: tab.pinned });
}
