/**
 * Service worker. Deliberately thin: opens the side panel and keeps it
 * enabled only on playlist-shaped YouTube URLs, so clicking the toolbar icon
 * elsewhere doesn't show an empty panel. No fetches, no network code — there
 * is no code path in this extension that opens a network connection.
 */

const PANEL_PATH = 'panel.html';

function looksLikePlaylistUrl(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return (
      (u.hostname === 'www.youtube.com' || u.hostname === 'youtube.com' || u.hostname === 'm.youtube.com') &&
      u.pathname === '/playlist' &&
      u.searchParams.has('list')
    );
  } catch {
    return false;
  }
}

async function syncPanelForTab(tabId: number, url: string | undefined): Promise<void> {
  try {
    await chrome.sidePanel.setOptions({ tabId, path: PANEL_PATH, enabled: looksLikePlaylistUrl(url) });
  } catch {
    /* tab closed mid-flight */
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
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
