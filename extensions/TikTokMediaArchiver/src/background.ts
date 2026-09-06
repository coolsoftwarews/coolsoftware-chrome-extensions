/**
 * Service worker. Deliberately thin — it does exactly two things:
 *
 *   1. Relays the one privileged action content.ts cannot perform itself:
 *      writing a file to disk via chrome.downloads.download(). Content
 *      scripts have no access to chrome.downloads, so both the saved-video
 *      write and the log's CSV/JSON export pass through here.
 *   2. Forwards a toolbar-icon click or the Alt+Shift+S command to the
 *      active tab's content script, which toggles the on-page saved-videos
 *      log (there is no separate popup or side-panel page in this
 *      extension).
 *
 * It performs no fetches of its own and reaches no host but the download
 * target itself — see PRIVACY.md. It never decides whether a post can be
 * saved; that decision (the ownership gate, PRD-45 §5) is made entirely in
 * content.ts before a download is ever requested.
 */

import { BackgroundToContent, BackgroundToContentResult, ContentToBackground } from './types';

/** Encodes arbitrary UTF-8 text (post URLs, handles) as a base64 data: URL,
 *  chunked through String.fromCharCode so a large export never blows the
 *  call stack. `escape`/`unescape` aren't reliably available in a service
 *  worker's global scope, so this goes through TextEncoder instead. */
function toDataUrl(text: string, mime: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

async function handleDownload(url: string, filename: string): Promise<BackgroundToContentResult> {
  try {
    const downloadId = await chrome.downloads.download({ url, filename, saveAs: false });
    return { ok: true, downloadId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Download failed.' };
  }
}

async function handleExport(text: string, filename: string, mime: string): Promise<BackgroundToContentResult> {
  try {
    const downloadId = await chrome.downloads.download({ url: toDataUrl(text, mime), filename, saveAs: false });
    return { ok: true, downloadId };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : 'Export failed.' };
  }
}

chrome.runtime.onMessage.addListener((message: ContentToBackground, _sender, sendResponse) => {
  if (message.type === 'TMA_DOWNLOAD') {
    void handleDownload(message.url, message.filename).then(sendResponse);
    return true; // keep the message channel open for the async response
  }
  if (message.type === 'TMA_EXPORT') {
    void handleExport(message.text, message.filename, message.mime).then(sendResponse);
    return true;
  }
  return undefined;
});

async function toggleLogOnActiveTab(tabId: number): Promise<void> {
  const toggle: BackgroundToContent = { type: 'TMA_TOGGLE_LOG' };
  try {
    await chrome.tabs.sendMessage(tabId, toggle);
  } catch {
    // No content script on this tab (not a tiktok.com page) — nothing to toggle.
  }
}

chrome.action.onClicked.addListener(tab => {
  if (tab.id !== undefined) void toggleLogOnActiveTab(tab.id);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-saved-log' && tab?.id !== undefined) void toggleLogOnActiveTab(tab.id);
});
