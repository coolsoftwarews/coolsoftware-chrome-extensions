/**
 * Service worker: side panel lifecycle, and forwarding the two keyboard
 * commands to the content script of whichever tab fired them. No fetches —
 * this extension makes no network requests anywhere.
 */

const PANEL_PATH = 'panel.html';

/**
 * The panel is enabled everywhere and says for itself when it can't work.
 *
 * Disabling it per-tab off YouTube makes Chrome *close* the panel, and
 * getting back to YouTube can only re-enable it — reopening then needs a
 * user gesture a tab switch doesn't have. So the panel stays enabled
 * globally, and its own gate screen explains itself off-YouTube instead.
 */
async function enablePanel(): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ path: PANEL_PATH, enabled: true });
  } catch {
    /* nothing useful to do if the panel cannot be configured */
  }
}

async function openPanel(tabId: number, windowId?: number): Promise<void> {
  try {
    await chrome.sidePanel.open(windowId ? { windowId } : { tabId });
  } catch {
    await enablePanel();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void enablePanel();
});

chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void enablePanel();
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void openPanel(tab.id, tab.windowId);
});

// Alt+Shift+I / Alt+Shift+O: forwarded to the content script that owns the
// player and the in-memory pending-mark state. The background worker holds
// neither — it is purely a relay here.
chrome.commands.onCommand.addListener((command, tab) => {
  if (!tab?.id) return;
  if (command === 'mark-in') void chrome.tabs.sendMessage(tab.id, { type: 'YHM_MARK_IN' }).catch(() => undefined);
  if (command === 'mark-out') void chrome.tabs.sendMessage(tab.id, { type: 'YHM_MARK_OUT' }).catch(() => undefined);
});

// Relay broadcasts from content.ts to whichever panel(s) are listening.
// chrome.runtime.sendMessage from a content script already reaches every
// extension page (including the panel) directly; this listener exists only
// so an unread message never surfaces as an "Unchecked runtime.lastError".
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (
    message?.type === 'YHM_NAVIGATED' ||
    message?.type === 'YHM_PENDING_CHANGED' ||
    message?.type === 'YHM_CLIP_ADDED' ||
    message?.type === 'YHM_PENDING_DISCARDED'
  ) {
    sendResponse({ ok: true });
    return false;
  }
  return false;
});
