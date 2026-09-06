/**
 * Service worker. The whole job is forwarding a toolbar click to the active
 * tab's content script so it can toggle the on-page product board drawer —
 * there is no chrome.sidePanel here (see drawer.ts's header comment for why),
 * so there is nothing else for a background script to own.
 *
 * It performs no fetches. There is no code path in this extension that opens
 * a network connection.
 */

import { BackgroundToContent } from './types';

function isTikTokTab(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return new URL(url).hostname.endsWith('tiktok.com');
  } catch {
    return false;
  }
}

chrome.action.onClicked.addListener(tab => {
  if (tab.id === undefined || !isTikTokTab(tab.url)) return;
  const message: BackgroundToContent = { type: 'TPS_TOGGLE_BOARD' };
  void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'toggle-product-board' || !tab?.id || !isTikTokTab(tab.url)) return;
  const message: BackgroundToContent = { type: 'TPS_TOGGLE_BOARD' };
  void chrome.tabs.sendMessage(tab.id, message).catch(() => undefined);
});
