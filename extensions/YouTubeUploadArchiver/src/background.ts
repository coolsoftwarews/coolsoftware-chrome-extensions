/**
 * Service worker. The only reason this extension has one at all: chrome.
 * downloads is not available inside a content script (portfolio build
 * memory's standing gotcha), and content.ts is where the Archive button
 * lives.
 *
 * This is the one and only place in the whole extension that touches
 * chrome.downloads, and it is called with exactly one kind of URL: a static
 * thumbnail image already scraped off the page (i.ytimg.com/vi/<id>/....jpg
 * — see scrape.ts#readThumbnailUrl). There is no other message type, no
 * other download call, and no code path anywhere in this file (or this
 * extension) that builds, requests or even names YouTube's signed
 * video-streaming CDN, a player/format response, or any other part of the
 * video stream — see PRD-47 §2/§4, and scripts/selftest.mjs's grep
 * guardrail on that absence (the forbidden domain is named in
 * README.md/PRIVACY.md, not under src/).
 *
 * chrome.downloads.download() hands the URL to Chrome's own download
 * manager, which fetches it — this file's own code performs no fetch/XHR of
 * any kind.
 */

import { DownloadThumbnailMessage, DownloadThumbnailResponse } from './types';

chrome.runtime.onMessage.addListener((message: DownloadThumbnailMessage, _sender, sendResponse: (r: DownloadThumbnailResponse) => void) => {
  if (message?.type !== 'YUA_DOWNLOAD_THUMBNAIL') return undefined;

  chrome.downloads.download({ url: message.thumbnailUrl, filename: message.filename, saveAs: false }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'download failed' });
      return;
    }
    sendResponse({ ok: true });
  });

  return true; // keep the message channel open for the async sendResponse
});
