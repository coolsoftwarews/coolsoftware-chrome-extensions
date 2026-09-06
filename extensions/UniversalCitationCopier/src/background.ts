/**
 * Service worker. Its only job is the keyboard-shortcut "quick copy" path:
 * re-read the active tab's metadata, format it in whatever the user last
 * used, and write it to the clipboard — no popup involved. The popup handles
 * its own extraction and clipboard writes independently (it has a document,
 * so it needs none of this).
 *
 * No fetch, no XMLHttpRequest, anywhere in this file or anything it imports.
 */

import { collectRawMeta } from './extract';
import { deriveMetadata, formatCitation, isSupportedPageUrl } from './citation';
import { getLastUsedFormat } from './storage';

const QUICK_COPY_COMMAND = 'quick-copy';
const OFFSCREEN_URL = 'offscreen.html';

const BADGE_OK = { text: '✓', color: '#1a7f37' }; // check mark, green
const BADGE_ERR = { text: '!', color: '#b3261e' }; // red
const BADGE_CLEAR_MS = 1500;

async function ensureOffscreenDocument(): Promise<void> {
  try {
    await chrome.offscreen.createDocument({
      url: OFFSCREEN_URL,
      reasons: [chrome.offscreen.Reason.CLIPBOARD],
      justification: 'Write the copied citation to the clipboard from the keyboard-shortcut path.',
    });
  } catch (err) {
    // Chrome throws when a document already exists — the common case after
    // the first quick-copy of the session, not a real failure.
    const message = err instanceof Error ? err.message : String(err);
    if (!message.includes('single offscreen')) throw err;
  }
}

async function writeToClipboard(text: string): Promise<void> {
  await ensureOffscreenDocument();
  const response = await chrome.runtime.sendMessage({ target: 'offscreen', action: 'COPY', text });
  if (!response?.ok) throw new Error(response?.error ?? 'Clipboard write failed.');
}

async function flashBadge(tabId: number, badge: { text: string; color: string }): Promise<void> {
  await chrome.action.setBadgeBackgroundColor({ color: badge.color });
  await chrome.action.setBadgeText({ text: badge.text, tabId });
  setTimeout(() => {
    void chrome.action.setBadgeText({ text: '', tabId });
  }, BADGE_CLEAR_MS);
}

async function quickCopy(tab: chrome.tabs.Tab | undefined): Promise<void> {
  if (!tab?.id) return;
  const tabId = tab.id;

  if (!isSupportedPageUrl(tab.url)) {
    await flashBadge(tabId, BADGE_ERR);
    return;
  }

  try {
    const [{ result: raw } = { result: undefined }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: collectRawMeta,
    });
    if (!raw) throw new Error('Could not read this page.');

    const meta = deriveMetadata(raw);
    const formatId = await getLastUsedFormat();
    const text = formatCitation(formatId, meta);

    await writeToClipboard(text);
    await flashBadge(tabId, BADGE_OK);
  } catch {
    await flashBadge(tabId, BADGE_ERR);
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== QUICK_COPY_COMMAND) return;
  void quickCopy(tab);
});
