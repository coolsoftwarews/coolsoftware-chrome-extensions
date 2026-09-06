/**
 * Service worker. Unlike WebHighlighter, the research panel shows a global
 * library rather than something scoped to the active tab's page, so there is
 * no per-tab enable/disable dance here — the panel is simply available from
 * the toolbar icon on every tab. This performs no fetches; there is no code
 * path in this extension that opens a network connection (PRD §7).
 */

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
});
