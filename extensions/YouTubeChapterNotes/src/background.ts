/**
 * Service worker. Two small jobs, neither of which needs a network request:
 *
 *   1. tell Chrome a toolbar click should open the side panel (a Saver-style
 *      standing view, not a per-page one — content.ts and panel.ts both talk
 *      to chrome.storage.local directly, so there is nothing else to relay)
 *   2. relay the Alt+Shift+N shortcut to the active tab's content script —
 *      chrome.commands only fires here, never inside a content script, so
 *      this is the one message this file ever sends. chrome.tabs.query with
 *      {active, currentWindow} and chrome.tabs.sendMessage both work without
 *      the "tabs" permission (this extension only holds host_permissions for
 *      youtube.com, no "tabs"/"activeTab"/"scripting" — see PRIVACY.md).
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-note-capture') return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'YCN_OPEN_CAPTURE' });
  } catch {
    /* no content script on this tab (not YouTube, or not loaded yet) — nothing to do */
  }
});
