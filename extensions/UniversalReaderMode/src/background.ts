/**
 * Service worker. Deliberately thin, and deliberately the only place that
 * injects the content script — there is no declarative `content_scripts`
 * entry in the manifest, so nothing from this extension runs on a page until
 * the user clicks the toolbar icon or presses the shortcut (PRD-39 §6's
 * "foreground only" principle, taken one step further than most extensions
 * in this portfolio: not even a passive listener runs until invoked).
 *
 * Re-invoking on a page that already has the overlay open closes it —
 * `content.ts`'s own top-level code handles that toggle by checking for its
 * own host element, so this file doesn't need to track per-tab state at all.
 *
 * Performs no fetches. There is no code path in this extension that opens a
 * network connection.
 */

import { BackgroundResponse, ContentToBackground } from './types';
import { isSupportedUrl } from './url';

async function injectReader(tabId: number, url: string | undefined): Promise<void> {
  if (!isSupportedUrl(url)) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch {
    /* the tab may have navigated away, or be a page scripting can't reach */
  }
}

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined) return;
  void injectReader(tab.id, tab.url);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-reader-mode' || !tab?.id) return;
  void injectReader(tab.id, tab.url);
});

chrome.runtime.onMessage.addListener((message: ContentToBackground, _sender, sendResponse: (response: BackgroundResponse) => void) => {
  if (message?.type !== 'URM_DOWNLOAD') return undefined;

  chrome.downloads.download({ url: message.dataUrl, filename: message.filename }, downloadId => {
    if (chrome.runtime.lastError || downloadId === undefined) {
      sendResponse({ ok: false, error: chrome.runtime.lastError?.message ?? 'download failed' });
    } else {
      sendResponse({ ok: true });
    }
  });

  return true; // keep the message channel open for the async sendResponse
});
