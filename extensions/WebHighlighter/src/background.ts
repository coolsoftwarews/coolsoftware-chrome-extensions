/**
 * Service worker. Deliberately thin — it opens the side panel, keeps it
 * disabled on pages we cannot highlight, and shows the one-screen welcome page
 * on install (PRD §12: the first run has to teach the product by itself).
 *
 * It performs no fetches. There is no code path in this extension that opens a
 * network connection.
 */

import { isSupportedUrl } from './url';

const PANEL_PATH = 'panel.html';

async function syncPanelForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: isSupportedUrl(url) });
  } catch {
    /* tab closed mid-flight */
  }
}

async function openPanel(tabId: number, windowId?: number): Promise<void> {
  try {
    await chrome.sidePanel.open(windowId ? { windowId } : { tabId });
  } catch {
    // open() needs a user gesture; if we lost it, at least leave the panel
    // enabled so the next toolbar click works.
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

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-highlights-panel' || !tab?.id) return;
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
