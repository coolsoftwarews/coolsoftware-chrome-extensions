/**
 * Content script entry point.
 *
 * YouTube is a single-page app: the document loads once and every subsequent
 * "page" is a client-side swap announced by `yt-navigate-finish`. So all setup
 * is idempotent and re-runs on every navigation, and the feed machinery tears
 * down the moment we leave /feed/subscriptions.
 *
 * What this script owns is only what has to live *in* the page: filtering the
 * feed, the "add to group" button beside Subscribe, the subscribe-time picker,
 * and the insights overlay. Group switching and management belong to the side
 * panel — a panel beside the page beats controls injected into it, and injected
 * controls are the part that breaks every time YouTube reshuffles its DOM.
 *
 * The overlay is the exception that proves the rule: it is not a control, it is
 * a picture that needs more width than a 380px panel has. So the panel keeps
 * the filters and asks us to draw.
 */

import { readAccountFromDocument } from '../account';
import { NotSignedInError, fetchSubscribedChannels } from '../subscriptions';
import { SCRAPE_MESSAGE, ScrapeResponse } from '../messages';
import { onStoreChanged, readStore, setActiveAccount } from '../storage';
import { isSubscriptionsFeed } from '../selectors';
import { StoreShape } from '../types';
import { reset, setActive, setIndex, startObserving, stopObserving } from './feed-filter';
import { openManager } from './open-manager';
import { closePicker } from './group-picker';
import { watchSubscribes } from './subscribe-watcher';
import { initGroupButton, resetPlacement, scheduleMount } from './group-button';
import { banner, log, note } from './debug';
import { closeInsights, openInsights } from './insights-modal';
import { isAlive, onTeardown, teardown } from './lifecycle';

let store: StoreShape | null = null;
let mounted = false;

/**
 * Tell every other surface which YouTube account this page belongs to.
 *
 * The side panel has no page of its own, so it cannot work this out — left to
 * itself it reads whichever account it last scraped. On a second account that
 * meant showing the first account's groups and then, on the next refresh,
 * pruning them against the second account's subscription list, which empties
 * them. So the page that knows says so, and it says so before anything reads
 * the store.
 */
let claimedAccountId: string | null = null;
let reportedNoAccount = false;

async function claimAccount(): Promise<void> {
  // Switching account is a full document load, so once this document has named
  // itself the answer cannot change — and the scan is over every inline script
  // on a YouTube page, which is not something to repeat on every navigation.
  if (claimedAccountId) return;

  const account = readAccountFromDocument();
  // Signed out, or a page shape we do not recognise. Leave the active account
  // exactly as it is: a wrong guess splits one account's groups across two
  // stores, which looks the same as losing them.
  if (!account) {
    if (!reportedNoAccount) {
      reportedNoAccount = true;
      note('this page did not say which account it is — groups left on the current account');
    }
    return;
  }

  claimedAccountId = account.id;
  note(
    `account ${account.id}`,
    `(authuser=${account.sessionIndex ?? '-'}, pageId=${account.pageId ?? '-'})`,
  );
  await setActiveAccount(account);
  // Whatever we cached belongs to the account we just stopped being.
  store = null;
}

async function ensureStore(): Promise<StoreShape> {
  await claimAccount();
  if (!store) store = await readStore();
  return store;
}

async function sync(): Promise<void> {
  if (!isAlive()) return teardown();

  const current = await ensureStore();

  if (!isSubscriptionsFeed()) {
    if (mounted) unmountFeed();
    return;
  }

  mounted = true;
  setIndex(current);
  setActive(current);
  startObserving();
}

function unmountFeed(): void {
  mounted = false;
  stopObserving();
  reset();
}

onStoreChanged((next) => {
  store = next;
  void sync();
});

// The feed container mounts after `yt-navigate-finish` fires, so retry on a
// short decaying schedule rather than assuming the DOM is ready.
function syncWithRetries(): void {
  void sync();
  for (const delay of [150, 400, 1000, 2500]) {
    setTimeout(() => {
      if (isSubscriptionsFeed()) void sync();
    }, delay);
  }
}

function onNavigate(): void {
  log('navigate →', location.pathname);
  closePicker();
  resetPlacement();
  syncWithRetries();
  scheduleMount();
}

document.addEventListener('yt-navigate-finish', onNavigate);
window.addEventListener('popstate', onNavigate);

/**
 * The side panel asking us to draw the insights overlay.
 *
 * The panel cannot render it — it has neither the width nor the page. It sends
 * the request here, via the service worker, which is also what picks or opens a
 * YouTube tab when the panel is open somewhere else entirely.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const type = (message as { type?: string } | null)?.type;
  if (type !== 'ysg:show-insights') return false;
  if (!isAlive()) {
    teardown();
    sendResponse({ shown: false });
    return false;
  }
  openInsights();
  sendResponse({ shown: true });
  return false;
});

/**
 * The side panel asking this tab to read its own subscription list.
 *
 * The panel cannot read it: a fetch from an extension page is answered for the
 * Google account's default channel, never the brand channel a tab may be using,
 * and no combination of `authuser` or `X-Goog-PageId` changes that. Here the
 * request is same-origin and carries the page's own session, so the answer is
 * this tab's account — which is the account the user is looking at.
 */
chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if ((message as { type?: string } | null)?.type !== SCRAPE_MESSAGE) return false;

  void (async () => {
    let response: ScrapeResponse;
    try {
      const scrape = await fetchSubscribedChannels();
      response = {
        ok: true,
        channels: scrape.channels,
        // The fetched page states its own identity; the document is the
        // fallback for a layout that does not.
        account: scrape.account ?? readAccountFromDocument(),
      };
    } catch (err) {
      response = {
        ok: false,
        signedOut: err instanceof NotSignedInError,
        message: err instanceof Error ? err.message : 'Could not read your subscriptions.',
      };
    }
    sendResponse(response);
  })();

  return true; // the response is asynchronous
});

// Leaving the page as we found it is the whole point of teardown.
onTeardown(() => {
  document.removeEventListener('yt-navigate-finish', onNavigate);
  window.removeEventListener('popstate', onNavigate);
  closePicker();
  closeInsights();
  unmountFeed();
});

banner();
void claimAccount();
watchSubscribes(() => void openManager());
initGroupButton(() => void openManager());
syncWithRetries();
scheduleMount();
