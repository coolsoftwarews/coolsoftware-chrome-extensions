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

const DOWNLOAD_OUTCOME_TIMEOUT_MS = 30_000;

// chrome.downloads.download()'s own callback only confirms the download was
// *queued* — it fires the instant Chrome accepts the request, before it
// knows whether the transfer will actually succeed. Reporting that back as
// "ok" was a real bug here: a download that later fails (hotlink rejection,
// a dropped connection, whatever "Network issue" in the Chrome downloads UI
// turns out to mean) still showed as "Saved" in the page's Save button,
// because nothing here was listening for what happens next. This waits for
// the download to genuinely finish (or be interrupted) via
// chrome.downloads.onChanged, and returns Chrome's real interrupt reason
// (e.g. "SERVER_FORBIDDEN", "NETWORK_FAILED") instead of guessing at one.
function awaitDownloadOutcome(downloadId: number): Promise<DownloadMediaResponse> {
  return new Promise(resolve => {
    let settled = false;

    function finish(response: DownloadMediaResponse): void {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      resolve(response);
    }

    function onChanged(delta: chrome.downloads.DownloadDelta): void {
      if (delta.id !== downloadId) return;
      if (delta.state?.current === 'complete') finish({ ok: true });
      else if (delta.state?.current === 'interrupted') {
        finish({ ok: false, error: delta.error?.current ?? 'interrupted' });
      }
    }
    chrome.downloads.onChanged.addListener(onChanged);

    // Covers the rare case where a small/fast download already finished
    // before the listener above was attached.
    chrome.downloads.search({ id: downloadId }, ([item]) => {
      if (!item) return;
      if (item.state === 'complete') finish({ ok: true });
      else if (item.state === 'interrupted') finish({ ok: false, error: item.error ?? 'interrupted' });
    });

    const timer = setTimeout(
      () => finish({ ok: false, error: 'Timed out waiting for the download to finish.' }),
      DOWNLOAD_OUTCOME_TIMEOUT_MS
    );
  });
}

chrome.runtime.onMessage.addListener((message: DownloadMediaMessage, _sender, sendResponse: (r: DownloadMediaResponse) => void) => {
  if (message?.type !== 'XMA_DOWNLOAD_MEDIA') return undefined;

  chrome.downloads.download({ url: message.url, filename: message.filename, saveAs: false }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'download failed to start' });
      return;
    }
    void awaitDownloadOutcome(downloadId).then(sendResponse);
  });

  return true; // keep the message channel open for the async sendResponse above
});
