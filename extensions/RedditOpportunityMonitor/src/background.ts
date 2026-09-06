/**
 * Service worker. Deliberately thin — its only job is opening the
 * opportunity panel as a dedicated tab when the toolbar icon is clicked.
 *
 * There is no `sidePanel` permission here (PRD §6's permission list is
 * exactly `activeTab`, `storage`, `downloads` + the Reddit host — nothing
 * broader), so the panel is a normal extension page opened in a tab and
 * refocused on subsequent clicks rather than duplicated. It performs no
 * fetches; there is no code path in this extension that opens a network
 * connection.
 */

const PANEL_PATH = 'panel.html';

async function openOrFocusPanel(): Promise<void> {
  const panelUrl = chrome.runtime.getURL(PANEL_PATH);
  // Extension pages are always fully visible to their own extension
  // regardless of the "tabs" permission, so this needs nothing extra.
  const [existing] = await chrome.tabs.query({ url: `${panelUrl}*` });
  if (existing?.id !== undefined) {
    await chrome.tabs.update(existing.id, { active: true });
    if (existing.windowId !== undefined) await chrome.windows.update(existing.windowId, { focused: true });
    return;
  }
  await chrome.tabs.create({ url: panelUrl });
}

chrome.action.onClicked.addListener(() => {
  void openOrFocusPanel();
});

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    void openOrFocusPanel();
  }
});
