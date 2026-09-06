/**
 * Service worker. Deliberately thin — it turns the toolbar icon and the
 * keyboard shortcuts into a message to the content script, keeps the side
 * panel disabled on pages notes can't live on, and shows the one-screen
 * welcome page on install.
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection.
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

async function createNoteOnTab(tabId: number): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'SN_CREATE_NOTE' });
  } catch {
    // No content script here — chrome://, the Web Store, a tab open since
    // before install. Do nothing rather than error (PRD §7 edge case).
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
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

// The toolbar action's whole job is "drop a note here" — not opening the
// panel. The panel is reached through Chrome's own side-panel picker, or the
// open-notes-panel shortcut below.
chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void createNoteOnTab(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === 'create-note') {
    void createNoteOnTab(tab.id);
  } else if (command === 'open-notes-panel') {
    void openPanel(tab.id, tab.windowId);
  }
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
