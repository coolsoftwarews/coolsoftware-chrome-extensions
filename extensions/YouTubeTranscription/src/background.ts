/**
 * Service worker: opens the side panel, and performs the two youtube.com
 * fetches on the panel's behalf (the panel's own origin cannot read them).
 */

const PANEL_PATH = 'panel.html';

/**
 * The panel is enabled everywhere, and says for itself where it cannot work.
 *
 * It used to be enabled per tab, disabled anywhere but YouTube. That reads as
 * tidy and behaves badly: disabling the panel for the active tab makes Chrome
 * *close* it, and coming back to YouTube can only re-enable it — reopening
 * needs a user gesture, which a tab switch is not. So glancing at another tab
 * silently cost you the panel, and the only way back was the toolbar icon.
 *
 * The gate inside the panel now covers the same ground honestly: away from
 * YouTube it explains itself and offers a way there, and the panel survives
 * the trip.
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
    // open() needs a user gesture; if we lost it, at least make sure the panel
    // is enabled so the toolbar icon works on the next click.
    await enablePanel();
  }
}

chrome.runtime.onInstalled.addListener(details => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void enablePanel();

  // First run lands on the guide. Landing on the panel instead would mean
  // landing on "open a YouTube video", which teaches nothing.
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

// setPanelBehavior is not persisted across restarts in every version, so both
// are re-asserted on startup. Setting them twice is harmless.
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  void enablePanel();
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void openPanel(tab.id, tab.windowId);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'open-transcript-panel' || !tab?.id) return;
  void openPanel(tab.id, tab.windowId);
});

// No per-tab enabling: see enablePanel(). The panel follows the reader between
// tabs, and the panel itself decides what to show once it gets there.

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'YTX_FETCH_URL' && typeof message.url === 'string') {
    void (async () => {
      try {
        const url = new URL(message.url);
        // Hard boundary: this extension talks to nothing but YouTube.
        if (!/(^|\.)youtube\.com$/.test(url.hostname)) {
          sendResponse({ ok: false, error: 'Refused: non-YouTube URL.' });
          return;
        }

        const res = await fetch(url.toString(), { redirect: 'manual' });
        if (res.type === 'opaqueredirect') {
          sendResponse({ ok: false, error: 'YouTube redirected the request. Try again in a moment.' });
          return;
        }
        sendResponse({ ok: true, status: res.status, body: await res.text() });
      } catch (e: any) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true;
  }

  if (message?.type === 'YTX_OPEN_PANEL') {
    const tabId = sender.tab?.id;
    if (tabId !== undefined) {
      // Triggered by the in-page button, so we still hold the user gesture.
      void openPanel(tabId, sender.tab?.windowId);
    }
    sendResponse({ ok: true });
    return false;
  }

  return false;
});
