/**
 * Service worker. Deliberately thin — it opens the side panel and shows the
 * one-screen welcome page on install. It performs no fetches, no polling, no
 * `alarms`. There is no code path in this extension that opens a network
 * connection, and nothing here runs without a user gesture behind it (PRD §5).
 */

const PANEL_PATH = 'panel.html';

chrome.runtime.onInstalled.addListener(details => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-tab-stash-panel' || !tab?.id) return;
  void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined);
});
