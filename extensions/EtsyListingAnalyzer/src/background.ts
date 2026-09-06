/**
 * Service worker, deliberately thin. Two jobs only:
 *   1. Toggle the in-page panel when the toolbar icon is clicked.
 *   2. Perform downloads — content scripts cannot call chrome.downloads
 *      directly, so the overlay (src/content.ts) asks this worker to do it.
 *
 * No fetch, no XMLHttpRequest, no alarms, no polling. Nothing here runs
 * unless the user clicked the icon or an export button (PRD's "foreground
 * only" constraint).
 */

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void chrome.tabs.sendMessage(tab.id, { type: 'ELA_TOGGLE_PANEL' }).catch(() => undefined);
});

interface DownloadRequest {
  type: 'ELA_DOWNLOAD';
  filename: string;
  content: string;
  mimeType: string;
}

chrome.runtime.onMessage.addListener((message: DownloadRequest, _sender, sendResponse) => {
  if (message?.type !== 'ELA_DOWNLOAD') return false;

  const url = `data:${message.mimeType};charset=utf-8,${encodeURIComponent(message.content)}`;
  chrome.downloads
    .download({ url, filename: message.filename, saveAs: false })
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true; // keep the message channel open for the async response
});
