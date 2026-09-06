/**
 * Service worker. Deliberately thin — it opens the side panel on toolbar
 * click and relays the content script's "open the tracker" request (content
 * scripts cannot call chrome.sidePanel directly). It performs no fetches:
 * there is no code path in this extension that opens a network connection.
 */

const PANEL_PATH = 'panel.html';

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
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
  if (message?.type === 'LJT_OPEN_PANEL' && sender.tab?.id !== undefined) {
    void openPanel(sender.tab.id, sender.tab.windowId);
  }
  return false;
});
