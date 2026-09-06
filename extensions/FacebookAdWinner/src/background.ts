/**
 * Service worker. Deliberately thin:
 *   1. relays a download request from the content script, which has no
 *      access to chrome.downloads itself (that API is extension-page only)
 *   2. keeps the toolbar badge showing how many ads are in the swipe file
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection — see PRIVACY.md.
 */

import { ContentToBackground } from './types';

async function handleDownload(message: ContentToBackground): Promise<void> {
  const url = `data:${message.mime};charset=utf-8,${encodeURIComponent(message.content)}`;
  await chrome.downloads.download({ url, filename: message.filename, saveAs: false });
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'FAW_DOWNLOAD') {
    void handleDownload(message as ContentToBackground)
      .then(() => sendResponse({ ok: true }))
      .catch((error: unknown) => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
  return false;
});

async function refreshBadge(): Promise<void> {
  try {
    const all = await chrome.storage.local.get(null);
    const count = Object.keys(all).filter(key => key.startsWith('faw:item:')).length;
    await chrome.action.setBadgeText({ text: count > 0 ? String(count) : '' });
    await chrome.action.setBadgeBackgroundColor({ color: '#ffd633' });
  } catch {
    /* badge is cosmetic; never let it break anything */
  }
}

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'local') void refreshBadge();
});

chrome.runtime.onInstalled.addListener(() => void refreshBadge());
chrome.runtime.onStartup.addListener(() => void refreshBadge());
