/**
 * Service worker. Deliberately thin: it performs the one privileged action
 * content scripts cannot do themselves — chrome.downloads.download() — and
 * appends a log entry once the download has actually started. There is no
 * other message type this listens for, no fetch anywhere in this file, and
 * no code path that downloads anything without a click on a Save button
 * that content.ts's ownership gate already approved (PRD §5). See
 * PRIVACY.md.
 */

import { addLogEntry } from './storage';
import { SaveMediaRequest, SaveMediaResponse } from './types';

chrome.runtime.onMessage.addListener((message: SaveMediaRequest, _sender, sendResponse) => {
  if (message?.type !== 'IMA_SAVE_MEDIA') return false;

  void (async () => {
    try {
      // Instagram's CDN hotlink-protects some media edges/shards, rejecting a
      // request with no Referer as a plain network failure rather than a
      // readable HTTP error — but chrome.downloads.download()'s `headers`
      // option refuses to set Referer at all ("Unsafe request header name",
      // confirmed live): it's on the same forbidden-header list ordinary
      // page-level network calls enforce. There is no way to attach it from
      // here; when a media edge enforces this, the failure is a real dead
      // end for this API, not something this extension can route around.
      const downloadId = await chrome.downloads.download({
        url: message.mediaUrl,
        filename: message.filename,
        saveAs: false,
        conflictAction: 'uniquify',
      });
      if (!downloadId) throw new Error('Download did not start.');
      await addLogEntry(message.entry);
      const response: SaveMediaResponse = { ok: true };
      sendResponse(response);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Download failed.';
      console.error('[Instagram Media Archiver] download failed:', errorMessage, message.mediaUrl);
      const response: SaveMediaResponse = { ok: false, error: errorMessage };
      sendResponse(response);
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
