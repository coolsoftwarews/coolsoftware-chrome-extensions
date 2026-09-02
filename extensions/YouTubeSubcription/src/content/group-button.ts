/**
 * The persistent "add to group" button, injected next to Subscribe.
 *
 * The subscribe-time popover only exists for the two seconds after you click
 * Subscribe. That covers new channels and nothing else — for the channels you
 * subscribed to a year ago there has to be a standing affordance, in the place
 * you are already looking when you think about a channel.
 *
 * It doubles as a status readout: the label says which groups the channel is
 * already in, so "is this filed?" is answerable at a glance.
 */

import { markChannelSeen, onStoreChanged, readStore, upsertChannel } from '../storage';
import { PageChannel, resolveChannel, toChannel } from './channel-context';
import { showGroupPicker } from './group-picker';
import { StoreShape } from '../types';
import { log, warn } from './debug';
import { isChannelContextPage } from '../selectors';
import { isAlive, onTeardown, teardown } from './lifecycle';

const BUTTON_ID = 'ysg-add-btn';

const SUBSCRIBE_SELECTOR = [
  'ytd-subscribe-button-renderer',
  'yt-subscribe-button-view-model',
  '#subscribe-button',
].join(',');

/**
 * The actions row itself — the container YouTube lays its header controls out
 * in — for each layout we know about.
 *
 * Anchoring to the *container* rather than to the subscribe button is the
 * lesson from PocketTube, which targets exactly these:
 *
 *   [page-subtype="channels"][role="main"] #page-header yt-flexible-actions-view-model
 *   [role="main"] #channel-header-container #buttons.style-scope.ytd-c4-tabbed-header-renderer
 *
 * Appending to the row gives one fixed position — last control in the row — on
 * every channel. Inserting *next to Subscribe* cannot, because the row's
 * contents vary per channel (Join and Community appear only sometimes), so the
 * button lands in a different visual slot each time. That is the jumping.
 */
const ACTION_ROW_SCOPES = [
  'ytd-browse[page-subtype="channels"] #page-header yt-flexible-actions-view-model',
  '#channel-header-container #buttons.ytd-c4-tabbed-header-renderer',
  'ytd-c4-tabbed-header-renderer #buttons',
  'ytd-watch-metadata #owner', // watch page
  '#owner',
];

/**
 * Fallback scopes, used only when no known actions row is present: find the
 * subscribe button inside something that plausibly represents this page.
 */
const OWNER_SCOPES = [
  '#owner',
  'ytd-video-owner-renderer',
  'yt-page-header-renderer',
  '#page-header',
  'ytd-c4-tabbed-header-renderer',
  '#channel-header',
  '#meta',
];

/**
 * Blocks that contain *other* channels' subscribe buttons. A watch page has
 * dozens; attaching to one of those would file the wrong channel.
 */
const FOREIGN_SCOPES = [
  'ytd-comment-thread-renderer',
  'ytd-comment-renderer',
  '#related',
  'ytd-compact-video-renderer',
  'ytd-rich-item-renderer',
  'ytd-video-renderer',
  'ytd-channel-renderer',
  'ytd-popup-container',
  'tp-yt-paper-dialog',
];

let store: StoreShape | null = null;
let onOpenManager: (() => void) | null = null;
let retryTimers: number[] = [];
/** Cached reference so the observer's fast path is one property read. */
let mounted: HTMLButtonElement | null = null;
/** The last channel marked as seen, so one visit is not written repeatedly. */
let lastSeenMarked: string | null = null;

export function initGroupButton(openManager: () => void): void {
  onOpenManager = openManager;
  onStoreChanged((next) => {
    store = next;
    mountGroupButton();
  });
  void readStore().then((s) => {
    store = s;
    mountGroupButton();
  });
  keepMounted();
  onTeardown(forget);
}

/**
 * Put the button back whenever YouTube throws it away.
 *
 * The bounded retry schedule alone is not enough: YouTube hydrates the header
 * late on some channels and re-renders it during a session, both of which
 * happen after the last retry has fired, leaving no button at all.
 *
 * This does watch the whole document — there is no smaller root that survives
 * YouTube's re-rendering — but the cost is bounded by the callback, not by the
 * mutation rate: while the button is attached, every wake-up is a single
 * `isConnected` check on a cached reference and nothing else. Real work only
 * happens when the button is actually gone, which is a handful of times per
 * session.
 */
function keepMounted(): void {
  let scheduled = 0;

  new MutationObserver(() => {
    if (mounted?.isConnected) return; // the common case, O(1)
    if (scheduled) return;
    scheduled = self.setTimeout(() => {
      scheduled = 0;
      mountGroupButton();
    }, 300);
  }).observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Look for the subscribe button on a bounded, decaying schedule.
 *
 * YouTube hydrates the owner block well after `yt-navigate-finish` fires, so a
 * single attempt misses. The earlier version watched the whole document for
 * mutations, which on YouTube means being woken thousands of times per minute
 * for a button that only appears once per navigation — this costs a handful of
 * `querySelector` calls per page instead, and stops as soon as it succeeds.
 */
export function scheduleMount(): void {
  for (const timer of retryTimers) clearTimeout(timer);
  retryTimers = [];

  if (mountGroupButton()) return;

  for (const delay of [100, 300, 700, 1500, 3000, 6000]) {
    retryTimers.push(
      self.setTimeout(() => {
        if (mountGroupButton()) {
          for (const timer of retryTimers) clearTimeout(timer);
          retryTimers = [];
        }
      }, delay),
    );
  }
}

/**
 * Idempotent: ensures our button sits beside the subscribe button and its
 * label is current. Returns whether the button is now mounted.
 */
export function mountGroupButton(): boolean {
  // An orphaned content script must not keep a live-looking button on the
  // page: clicking it would throw rather than do anything.
  if (!isAlive()) {
    teardown();
    return false;
  }

  // The feed renders a subscribe button per shelf, none of which represents
  // "the channel on this page" — there isn't one. Without this guard the
  // fallback scan latches onto a shelf's button and fails to resolve it, over
  // and over, on every mutation.
  if (!isChannelContextPage()) {
    forget();
    return false;
  }

  const anchor = findSubscribeButton();
  if (!anchor) {
    // Mid-render, most likely. Leave whatever is on screen alone rather than
    // yanking the button out and putting it back — that flicker is what "then
    // it shows, then it doesn't" looked like.
    log('no subscribe button found on', location.pathname);
    return mounted?.isConnected ?? false;
  }

  const channel = resolveChannel(anchor, lookupByHandle);
  if (!channel) {
    warn('found subscribe button but could not resolve a channel ID', anchor);
    return mounted?.isConnected ?? false;
  }

  let btn = document.getElementById(BUTTON_ID) as HTMLButtonElement | null;
  if (!btn) {
    btn = document.createElement('button');
    btn.id = BUTTON_ID;
    btn.type = 'button';
    btn.className = 'ysg-add-btn';
    log('mounting button for', channel.name, channel.id);
  }

  // Re-place only when the destination changed or we were detached. Appending
  // to a row we are already the last child of would be a no-op anyway, but it
  // still costs a DOM move on every store change.
  const row = findActionRow();
  if (anchor !== lastAnchor || !btn.isConnected || (row && btn.parentElement !== row)) {
    attach(row, anchor, btn);
    lastAnchor = anchor;
  }

  // Being on a channel's page, or watching one of its videos, is what "I have
  // looked at this" means — so its new-upload dot goes out here rather than
  // when a group containing it happens to be opened.
  if (channel.id !== lastSeenMarked) {
    lastSeenMarked = channel.id;
    void markChannelSeen(channel.id);
  }

  btn.textContent = labelFor(channel.id);
  btn.title = `${channel.name} — choose which of your groups this channel belongs to`;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    void openPicker(channel, btn!);
  };
  mounted = btn;
  return true;
}

/**
 * The cached subscription list is the most reliable handle → ID map we have:
 * it came from YouTube's own subscription page, and the channel on screen is
 * one the user is (almost always) subscribed to.
 */
function lookupByHandle(handle: string): string | null {
  const wanted = handle.toLowerCase();
  return store?.channels.find((c) => c.handle?.toLowerCase() === wanted)?.id ?? null;
}

/**
 * Forget where the button was, without removing it.
 *
 * Called on navigation: YouTube reuses the subscribe button element between
 * channels, so "same anchor, don't re-place" would keep the button wherever
 * the *previous* channel's header put it, even though the row around it has
 * been rebuilt with a different set of controls (Join, Community…).
 */
export function resetPlacement(): void {
  lastAnchor = null;
}

function forget(): void {
  document.getElementById(BUTTON_ID)?.remove();
  mounted = null;
  lastAnchor = null;
}

/**
 * The subscribe button we last placed against.
 *
 * Placement must happen once per anchor, not once per trigger. Re-running it
 * while YouTube hydrates produced a button that visibly jumped between
 * positions, because the layout it was reading was still changing underneath.
 */
let lastAnchor: Element | null = null;

/**
 * Insert the button into the horizontal row that holds Subscribe.
 *
 * Guessing at YouTube's container class names does not work — the subscribe
 * button's immediate parent is often a block or a *column* flex box, so a
 * sibling insert lands the button underneath rather than beside. Two earlier
 * attempts (plain sibling, cloning the neighbouring slot's class) both wrapped
 * for exactly that reason.
 *
 * So instead of guessing, ask the layout: climb until we find an ancestor that
 * is actually laying its children out in a row, and insert next to whichever
 * of its children contains the subscribe button. That is self-correcting
 * across layouts, because it reads the computed style rather than a class name
 * YouTube is free to rename.
 */
function attach(row: Element | null, anchor: Element, btn: HTMLElement): void {
  if (row) {
    // Last control in the row, always. One rule, one position, every channel —
    // whether or not that channel has Join and Community buttons.
    row.append(btn);
    log('appended to actions row', row.tagName, row.id || row.className || '(no id)');
    return;
  }

  // Unknown layout: sit directly after the subscribe button. Placement is then
  // only as consistent as the surrounding markup, which is why this is the
  // fallback and not the rule.
  anchor.insertAdjacentElement('afterend', btn);
  log('attached as sibling of subscribe button (no known actions row)');
}

/** The header actions container for this page, if it is one we recognise. */
function findActionRow(): Element | null {
  for (const selector of ACTION_ROW_SCOPES) {
    const row = document.querySelector(selector);
    if (row && row.querySelector(SUBSCRIBE_SELECTOR)) return row;
  }
  return null;
}

async function openPicker(channel: PageChannel, anchor: HTMLElement): Promise<void> {
  const current = store ?? (await readStore());
  if (!current.channels.some((c) => c.id === channel.id)) {
    // Subscribed since the last scrape, or never scraped at all. Either way the
    // picker needs the channel present to assign it.
    await upsertChannel(toChannel(channel));
  }
  showGroupPicker({
    channel,
    anchor,
    onOpenManager: onOpenManager ?? (() => undefined),
  });
}

function labelFor(channelId: string): string {
  const groups = store?.groups.filter((g) => g.channelIds.includes(channelId)) ?? [];
  if (groups.length === 0) return '＋ Add to group';
  if (groups.length === 1) return `✓ ${groups[0].name}`;
  return `✓ ${groups.length} groups`;
}

/**
 * The subscribe button for the channel this page is about.
 *
 * Preferred path is a known owner/header container. The fallback — first
 * subscribe button that isn't inside a comment, a recommendation or a dialog —
 * is what keeps this working when YouTube renames a header element, which is
 * the failure we actually keep hitting.
 */
export function findSubscribeButton(): Element | null {
  const row = findActionRow();
  const inRow = row?.querySelector(SUBSCRIBE_SELECTOR);
  if (inRow && isVisible(inRow)) {
    log('subscribe button via actions row');
    return inRow;
  }

  for (const scope of OWNER_SCOPES) {
    for (const container of document.querySelectorAll(scope)) {
      const button = container.querySelector(SUBSCRIBE_SELECTOR);
      if (button && isVisible(button)) {
        log('subscribe button via scope', scope);
        return button;
      }
    }
  }

  for (const button of document.querySelectorAll(SUBSCRIBE_SELECTOR)) {
    if (!isVisible(button)) continue;
    if (button.closest(FOREIGN_SCOPES.join(','))) continue;
    log('subscribe button via fallback scan');
    return button;
  }
  return null;
}

/** Skip the hidden duplicates YouTube keeps in the DOM (mini-player, etc.). */
function isVisible(el: Element): boolean {
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}
