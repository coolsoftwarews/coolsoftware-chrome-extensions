/**
 * Service worker. The content script cannot call chrome.downloads directly,
 * so this is the one relay: it takes a filename and a data: URL the content
 * script already built and hands it to the downloads API. It performs no
 * fetches of its own — there is no code path in this extension that opens a
 * network connection.
 */

import { ExportRequest, ExportResponse } from './types';

chrome.runtime.onMessage.addListener((message: ExportRequest, _sender, sendResponse) => {
  if (message?.type !== 'XVF_EXPORT') return false;

  chrome.downloads
    .download({ url: message.dataUrl, filename: message.filename, saveAs: false })
    .then(() => sendResponse({ ok: true } satisfies ExportResponse))
    .catch((error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'download failed' } satisfies ExportResponse)
    );

  return true; // keep the message channel open for the async sendResponse above
});
