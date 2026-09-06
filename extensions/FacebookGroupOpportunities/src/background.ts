/**
 * Service worker. Deliberately thin — it opens the side panel, keeps it
 * disabled on tabs that aren't facebook.com, and shows the one-screen welcome
 * page on install (rule authoring is the whole onboarding, PRD §10, so the
 * first thing a new user sees has to teach the two-part rule and point at the
 * starter packs).
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection.
 */

import { isFacebookUrl } from './facebook-url';

const PANEL_PATH = 'panel.html';

async function syncPanelForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: isFacebookUrl(url) });
  } catch {
    /* tab closed mid-flight */
  }
}

async function openPanel(tabId: number, windowId?: number): Promise<void> {
  try {
    await chrome.sidePanel.open(windowId ? { windowId } : { tabId });
  } catch {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  }
}

chrome.runtime.onInstalled.addListener(details => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void openPanel(tab.id, tab.windowId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'loading' || changeInfo.url) {
    void syncPanelForTab(tabId, changeInfo.url ?? tab.url);
  }
});

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    await syncPanelForTab(tabId, tab.url);
  } catch {
    /* ignore */
  }
});
