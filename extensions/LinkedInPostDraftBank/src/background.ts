/**
 * Service worker. Deliberately thin — it opens the side panel and enables it
 * only on linkedin.com tabs. Exports happen from the panel itself, which has
 * direct access to chrome.downloads (no content-script relay needed here,
 * since nothing in content.ts ever triggers a download). Performs no
 * fetches — there is no code path in this extension that opens a network
 * connection.
 */

const PANEL_PATH = 'panel.html';

function isLinkedInUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return /(^|\.)linkedin\.com$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

async function syncPanelForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: isLinkedInUrl(url) });
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

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
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
