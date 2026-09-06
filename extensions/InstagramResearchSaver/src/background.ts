/**
 * Service worker. Deliberately thin — it seeds the four starter collections on
 * install, opens the side panel on toolbar click, and relays the content
 * script's "open the library" request (content scripts cannot call
 * chrome.sidePanel directly). It performs no fetches: there is no code path in
 * this extension that opens a network connection.
 */

import { readCollections } from './storage';

const PANEL_PATH = 'panel.html';

chrome.runtime.onInstalled.addListener(details => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  if (details.reason === 'install') {
    void readCollections(); // seeds Hooks / Competitors / Ad Ideas / Reel Ideas
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

async function openPanel(tabId: number, windowId?: number): Promise<void> {
  try {
    await chrome.sidePanel.open(windowId ? { windowId } : { tabId });
  } catch {
    // open() needs a user gesture; if this call lost it, at least leave the
    // panel enabled so the next toolbar click works.
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: true }).catch(() => undefined);
  }
}

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void openPanel(tab.id, tab.windowId);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === 'IRS_OPEN_PANEL' && sender.tab?.id !== undefined) {
    void openPanel(sender.tab.id, sender.tab.windowId);
  }
  return false;
});
