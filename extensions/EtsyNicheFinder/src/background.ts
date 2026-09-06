/**
 * Service worker. Deliberately the thinnest file in the extension: content
 * scripts have no access to chrome.downloads, so its only job is turning an
 * export string built in the content script into a saved file. It performs
 * no fetches — there is no code path in this extension that opens a network
 * connection.
 */

import { ContentToBackground } from './types';

function toDataUrl(content: string, mime: string): string {
  // Service workers don't have URL.createObjectURL reliably across Chrome
  // versions; a data: URL needs no Blob and works the same everywhere.
  return `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
}

chrome.runtime.onMessage.addListener((message: ContentToBackground, _sender, sendResponse) => {
  if (message?.type !== 'ENF_DOWNLOAD') return false;

  chrome.downloads
    .download({ url: toDataUrl(message.content, message.mime), filename: message.filename, saveAs: false })
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }));

  return true; // keep the message channel open for the async response
});
