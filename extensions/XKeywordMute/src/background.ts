/**
 * Service worker. Deliberately thin — it greys out the toolbar icon on tabs
 * that aren't x.com/twitter.com (a cheap, permission-free hint that there's
 * nothing to do there) and shows the one-screen welcome page on install
 * (rule authoring is the whole onboarding, so the first thing a new user
 * sees teaches the placeholder shape and points at the starter packs).
 *
 * There is no `sidePanel` call here and no `chrome.downloads` call anywhere
 * in the extension — the popup (`action.default_popup`) opens itself, and
 * exports use a plain `<a download>` anchor (see popup.ts) — both choices
 * exist specifically so the manifest's permission list stays at `storage`
 * plus the two X host permissions (PRD §6), nothing more.
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection.
 */

import { isXUrl } from './x-url';

async function syncActionForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    if (isXUrl(url)) {
      await chrome.action.enable(tabId);
    } else {
      await chrome.action.disable(tabId);
    }
  } catch {
    /* tab closed mid-flight */
  }
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    void syncActionForTab(tabId, changeInfo.url ?? tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncActionForTab(tabId, tab.url);
  } catch {
    /* ignore */
  }
});
