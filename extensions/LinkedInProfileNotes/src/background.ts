/**
 * Service worker. The panel shows data that already lives in
 * chrome.storage.local, not a specific tab's contents, so unlike a per-page
 * tool there is nothing here to enable or disable per tab — the panel works
 * the same everywhere. All this does is make the toolbar icon open it.
 *
 * No fetches, no alarms, no polling. Nothing here opens a network connection.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});
