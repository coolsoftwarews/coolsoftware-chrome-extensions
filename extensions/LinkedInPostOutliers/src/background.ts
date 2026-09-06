/**
 * Service worker. The only job here is chrome.downloads — content scripts
 * cannot call that API directly, so the content script sends the file's
 * text and the worker turns it into a download. A data: URL is used rather
 * than a blob: URL so this works the same across every Chrome version this
 * extension supports, with no object-URL lifecycle to manage.
 *
 * There is no other code path here. No fetch, no alarms, no polling — see
 * PRIVACY.md.
 */

import { DownloadRequest, DownloadResponse } from './types';

function toDataUrl(content: string, mimeType: string): string {
  return `data:${mimeType},${encodeURIComponent(content)}`;
}

chrome.runtime.onMessage.addListener((message: DownloadRequest, _sender, sendResponse) => {
  if (message?.type !== 'LPO_DOWNLOAD') return false;

  chrome.downloads.download(
    { url: toDataUrl(message.content, message.mimeType), filename: message.filename, saveAs: false },
    downloadId => {
      const error = chrome.runtime.lastError;
      const response: DownloadResponse =
        error || downloadId === undefined ? { ok: false, error: error?.message || 'download failed' } : { ok: true };
      sendResponse(response);
    }
  );

  // Keeps the message channel open for the async sendResponse above.
  return true;
});
