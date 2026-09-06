/**
 * Service worker. Deliberately thin: its only job is to badge the toolbar
 * icon with how many reviews have been read so far on the current tab, which
 * is the "state it" half of PRD §5's "analyse what's loaded, and state it —
 * scroll or open more pages to include them". No fetches, no alarms, no
 * polling — it only reacts to messages the content script already sent.
 */

import { ContentToBackground } from './types';

chrome.runtime.onMessage.addListener((message: ContentToBackground, sender) => {
  if (message?.type !== 'ARI_PAGE_ANALYZED' || sender.tab?.id === undefined) return;

  const tabId = sender.tab.id;
  const text = message.totalAccumulated > 0 ? String(Math.min(message.totalAccumulated, 999)) : '';
  void chrome.action.setBadgeText({ tabId, text }).catch(() => undefined);
  void chrome.action.setBadgeBackgroundColor({ tabId, color: '#0f7a6c' }).catch(() => undefined);
  if (message.hasMorePages) {
    void chrome.action.setTitle({ tabId, title: `Amazon Review Intelligence — ${message.totalAccumulated} read, more available` }).catch(() => undefined);
  } else {
    void chrome.action.setTitle({ tabId, title: 'Amazon Review Intelligence' }).catch(() => undefined);
  }
});
