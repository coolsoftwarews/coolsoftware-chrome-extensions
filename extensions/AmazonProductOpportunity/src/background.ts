/**
 * Service worker. Deliberately thin, and exists for one reason: the overlay
 * lives entirely on the Amazon page (a content script), and content scripts
 * cannot call chrome.downloads — only extension pages can. This is the only
 * place that API is used for the in-page "Export" button (the popup calls it
 * directly for the watchlist, since it is its own extension page).
 *
 * No fetch, no XMLHttpRequest, no sendBeacon — nothing here opens a network
 * connection. See PRIVACY.md.
 */

interface DownloadMessage {
  type: 'APO_DOWNLOAD';
  filename: string;
  content: string;
  mimeType: string;
}

function isDownloadMessage(message: unknown): message is DownloadMessage {
  return Boolean(message) && (message as { type?: string }).type === 'APO_DOWNLOAD';
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!isDownloadMessage(message)) return false;

  const url = `data:${message.mimeType};charset=utf-8,${encodeURIComponent(message.content)}`;
  chrome.downloads.download({ url, filename: message.filename, saveAs: false }, () => {
    const error = chrome.runtime.lastError;
    sendResponse({ ok: !error, error: error?.message });
  });
  return true; // keep the message channel open for the async sendResponse
});
