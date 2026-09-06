/**
 * The only reason this extension has a background worker at all: chrome.
 * downloads is not available inside a content script (portfolio build
 * memory's standing gotcha), and the export panel lives in the page as a
 * shadow-DOM overlay, not a popup/side panel that could call it directly.
 * canvas.toDataURL() already hands content.ts a data: URL, so this relay is
 * a single, tiny pass-through - no Blob/base64 handling needed on either
 * side.
 */

import { DownloadMessage, DownloadResponse } from './types';

chrome.runtime.onMessage.addListener((message: DownloadMessage, _sender, sendResponse: (r: DownloadResponse) => void) => {
  if (message?.type !== 'XCE_DOWNLOAD') return undefined;

  chrome.downloads.download({ url: message.dataUrl, filename: message.filename, saveAs: false }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'download failed' });
      return;
    }
    sendResponse({ ok: true });
  });

  return true; // keep the message channel open for the async sendResponse
});
