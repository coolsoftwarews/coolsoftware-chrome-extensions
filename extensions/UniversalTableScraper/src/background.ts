/**
 * Service worker. Deliberately thin — its only job is `chrome.downloads`,
 * which content scripts cannot call directly (a gotcha this portfolio has
 * hit before — see AmazonProductOpportunity's build notes). Everything else
 * (picking, parsing, previewing) happens in the content script's on-page
 * overlay, and the popup is just the entry point that starts picking mode.
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection.
 */

import { ContentToBackground } from './types';

chrome.runtime.onInstalled.addListener(details => {
  if (details.reason === 'install') {
    void chrome.tabs.create({ url: chrome.runtime.getURL('welcome.html') });
  }
});

chrome.runtime.onMessage.addListener((message: ContentToBackground, _sender, sendResponse) => {
  if (message?.type !== 'UTS_DOWNLOAD') return false;

  chrome.downloads
    .download({ url: message.dataUrl, filename: message.filename, saveAs: false })
    .then(() => sendResponse({ ok: true }))
    .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));

  return true; // keep the message channel open for the async response
});
