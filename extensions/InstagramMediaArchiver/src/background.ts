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
      const response: SaveMediaResponse = {
        ok: false,
        error: error instanceof Error ? error.message : 'Download failed.',
      };
      sendResponse(response);
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
