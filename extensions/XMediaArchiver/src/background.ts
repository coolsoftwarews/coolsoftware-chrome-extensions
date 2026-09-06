/**
 * Service worker. The only reason this extension has one at all:
 * chrome.downloads is not available inside a content script (the standing
 * gotcha every downloading extension in this portfolio works around the
 * same way — see XCardExporter's/TikTokCreatorOutliers's background.ts).
 * This file performs no fetch of its own — `message.url` is the remote
 * media URL the page already rendered (an X/pbs.twimg.com/video.twimg.com
 * address), and chrome.downloads.download hands that straight to Chrome's
 * own download manager. There is no code path in this extension that opens
 * a network connection of its own (see PRIVACY.md).
 */

import { DownloadMediaMessage, DownloadMediaResponse } from './types';

chrome.runtime.onMessage.addListener((message: DownloadMediaMessage, _sender, sendResponse: (r: DownloadMediaResponse) => void) => {
  if (message?.type !== 'XMA_DOWNLOAD_MEDIA') return undefined;

  chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: false }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'download failed' });
      return;
    }
    sendResponse({ ok: true });
  });

  return true; // keep the message channel open for the async sendResponse above
});
