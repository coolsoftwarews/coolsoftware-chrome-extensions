/**
 * Service worker. Deliberately does almost nothing: the side panel is a
 * standing library of saved quotes, not a per-page view (unlike a highlighter
 * whose panel shows *this page's* marks), so there is no per-tab enable/
 * disable to manage and no messaging to relay — content.ts and panel.ts each
 * talk to chrome.storage.local directly. The one thing that must happen once,
 * on install, is telling Chrome that a toolbar click should open the side
 * panel rather than do nothing.
 *
 * This performs no fetches. There is no code path in this extension that
 * opens a network connection.
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});
