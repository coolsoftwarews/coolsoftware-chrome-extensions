/**
 * Service worker.
 *
 * Almost nothing lives here by design — state changes fan out through
 * `chrome.storage.onChanged`, so no context needs to ask another for data. Its
 * one job is opening the side panel, which only the extension's own contexts
 * are allowed to do.
 */

/** Clicking the toolbar icon opens the panel rather than a popup. */
chrome.runtime.onInstalled.addListener((details) => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // First run lands on the guide. It used to land on the manager, which on a
  // fresh install is an empty list and teaches nothing.
  if (details.reason === 'install') void chrome.runtime.openOptionsPage();
});

// setPanelBehavior is not persisted across browser restarts in every version,
// so re-assert it on startup too. Setting it twice is harmless.
chrome.runtime.onStartup.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
  if ((message as { type?: string } | null)?.type !== 'ysg:open-panel') return false;

  // `sidePanel.open()` must run in response to a user gesture. The gesture here
  // is a click in the page, which the content script forwards. The caller is
  // told whether it worked so it can report a failure rather than appear to do
  // nothing.
  const windowId = sender.tab?.windowId;
  if (windowId === undefined) {
    sendResponse({ opened: false });
    return false;
  }

  chrome.sidePanel
    .open({ windowId })
    .then(() => sendResponse({ opened: true }))
    .catch(() => sendResponse({ opened: false }));

  return true; // keep the message channel open for the async response
});
