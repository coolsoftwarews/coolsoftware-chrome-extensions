/**
 * Reading the subscription list from inside a YouTube tab.
 *
 * The panel used to fetch `/feed/channels` itself. That works right up until
 * the browser holds more than one YouTube identity, and then it quietly stops:
 * a fetch from an extension page is answered for the Google account's *default*
 * channel, whichever channel the tab in front of you is actually using. Asking
 * for another one does not help — `?authuser=`, `X-Goog-AuthUser` and
 * `X-Goog-PageId` were all tried, and a brand channel's page id was ignored
 * outright. Selecting a channel is something the page's own cookie context
 * does, and an extension page is not in it.
 *
 * The tab is. So the tab does the reading, and the panel asks it to.
 *
 * Runs from extension pages only (side panel, options) — a content script may
 * not touch `chrome.tabs`.
 */

import { AccountIdentity } from './account';
import { SCRAPE_MESSAGE, ScrapeResponse } from './messages';
import { NotSignedInError, SubscriptionScrapeError } from './subscriptions';
import { Channel } from './types';

const YOUTUBE_MATCH = '*://*.youtube.com/*';

export interface TabScrape {
  channels: Channel[];
  account: AccountIdentity | null;
  /** The tab we got it from, for the diagnostic line. */
  tabId: number;
}

/**
 * Ask an open YouTube tab for its subscription list.
 *
 * @param wantedAccountId The account the panel is showing. Every YouTube tab
 * is asked until one answers *as that account*, because two tabs can be signed
 * in as two different channels and only one of them holds the right answer.
 * @returns null when no tab could answer at all — the caller then falls back to
 * fetching directly, which is still right for the single-account case.
 */
export async function scrapeInTab(wantedAccountId: string | null): Promise<TabScrape | null> {
  const tabs = await ordered();
  let other: TabScrape | null = null;
  let failure: Error | null = null;

  for (const tab of tabs) {
    if (tab.id === undefined) continue;

    const response = await ask(tab.id);
    if (!response) continue;

    if (!response.ok) {
      // Remembered, not thrown: another tab may yet be signed in and able to
      // answer, and one signed-out tab should not decide the whole attempt.
      failure ??= response.signedOut
        ? new NotSignedInError(response.message)
        : new SubscriptionScrapeError(response.message);
      continue;
    }

    const scrape: TabScrape = {
      channels: response.channels,
      account: response.account,
      tabId: tab.id,
    };
    if (!wantedAccountId || response.account?.id === wantedAccountId) return scrape;

    // A real answer, for the wrong identity. Kept as a last resort so the
    // caller's account check can reject it and say so, rather than this
    // returning null and the direct fetch quietly repeating the same mistake.
    other ??= scrape;
  }

  if (other) return other;
  if (failure) throw failure;
  return null;
}

/**
 * YouTube tabs, most-likely-to-be-the-right-one first.
 *
 * The tab you were just looking at is the one whose account you mean; a tab in
 * another window is a guess. Same ordering the insights overlay uses.
 */
async function ordered(): Promise<chrome.tabs.Tab[]> {
  const tabs = await chrome.tabs.query({ url: YOUTUBE_MATCH });
  if (tabs.length < 2) return tabs;

  const current = await chrome.windows.getCurrent().catch(() => null);
  return [...tabs].sort((a, b) => rank(a, current?.id) - rank(b, current?.id));
}

function rank(tab: chrome.tabs.Tab, windowId: number | undefined): number {
  if (tab.windowId === windowId && tab.active) return 0;
  if (tab.windowId === windowId) return 1;
  return 2;
}

/**
 * Ask one tab, and put a content script in it if nothing answers.
 *
 * An orphaned script — one left by the previous version of the extension after
 * a reload or update — never answers and never will. That is not a rare state:
 * every user is in it after every update. Injecting is safe here precisely
 * because we only reach it when nothing replied, so there is no live script to
 * duplicate.
 */
async function ask(tabId: number): Promise<ScrapeResponse | null> {
  const first = await send(tabId);
  if (first) return first;

  try {
    await chrome.scripting.insertCSS({ target: { tabId }, files: ['content/content.css'] });
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/index.js'] });
  } catch {
    // No `scripting` permission, a restricted page, or the tab went away.
    return null;
  }

  return send(tabId);
}

async function send(tabId: number): Promise<ScrapeResponse | null> {
  try {
    const response = (await chrome.tabs.sendMessage(tabId, { type: SCRAPE_MESSAGE })) as
      | ScrapeResponse
      | undefined;
    return response ?? null;
  } catch {
    // Nothing listening in that tab.
    return null;
  }
}
