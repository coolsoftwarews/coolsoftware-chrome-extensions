/**
 * Service worker. Content scripts cannot call chrome.downloads directly, so
 * this is the one hop an export makes: content script → background →
 * chrome.downloads.download. It performs no fetch of its own — the content
 * already came from the page the user is looking at (README "Hard
 * constraints": foreground only, downloads not uploads).
 */

import { ExportFileRequest, ExportFileResponse } from './types';

function toDataUrl(content: string, mimeType: string): string {
  // btoa is UTF-16-limited; encodeURIComponent → escape round-trip gets us a
  // clean byte string first so non-ASCII captions/hashtags survive export.
  const bytes = unescape(encodeURIComponent(content));
  return `data:${mimeType};charset=utf-8;base64,${btoa(bytes)}`;
}

chrome.runtime.onMessage.addListener((message: ExportFileRequest, _sender, sendResponse) => {
  if (message?.type !== 'TCO_EXPORT_FILE') return false;

  try {
    const url = toDataUrl(message.content, message.mimeType);
    chrome.downloads.download({ url, filename: message.filename, saveAs: false }, () => {
      const response: ExportFileResponse = chrome.runtime.lastError
        ? { ok: false, error: chrome.runtime.lastError.message }
        : { ok: true };
      sendResponse(response);
    });
  } catch (error) {
    const response: ExportFileResponse = { ok: false, error: error instanceof Error ? error.message : 'unknown' };
    sendResponse(response);
  }

  return true; // keep the message channel open for the async sendResponse above
});
