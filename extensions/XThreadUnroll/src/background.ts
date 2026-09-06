/**
 * Service worker. Deliberately thin — keeps the side panel enabled only on
 * x.com/twitter.com tabs, and opens it when the content script asks (a
 * content script has no chrome.sidePanel access of its own, so "Unroll"
 * clicks relay the open request here). Performs no fetches; there is no
 * code path in this extension that opens a network connection.
 */

import { isXUrl } from './parse';
import { ContentToBackground } from './types';

const PANEL_PATH = 'panel.html';

async function syncPanelForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: isXUrl(url) });
  } catch {
    /* tab closed mid-flight */
  }
}

async function openPanel(tabId: number, windowId?: number): Promise<void> {
  try {
    await chrome.sidePanel.open(windowId ? { windowId } : { tabId });
  } catch {
    // open() needs a live user gesture; if we lost it, at least leave the
    // panel enabled so the next toolbar click (or Unroll click) works.
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void openPanel(tab.id, tab.windowId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-reader-panel' || !tab?.id) return;
  void openPanel(tab.id, tab.windowId);
});

// Relay for "Unroll" clicks inside the page: the click is the user gesture,
// and this listener runs synchronously off of it, which is what
// chrome.sidePanel.open() needs.
chrome.runtime.onMessage.addListener((message: unknown, sender) => {
  const msg = message as Partial<ContentToBackground> | undefined;
  if (msg?.type === 'XTU_OPEN_PANEL' && sender.tab?.id !== undefined) {
    void openPanel(sender.tab.id, sender.tab.windowId);
  }
  return false;
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
