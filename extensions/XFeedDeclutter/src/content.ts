/**
 * Content-script entry point. Runs on every x.com / twitter.com page. Its
 * only job is to apply the five toggles to whatever X has already rendered
 * — no scraping, no extraction, no per-post record of any kind (PRD §5).
 * State is per-tab and in memory only; the only things that ever reach
 * chrome.storage.local are the toggle values themselves and the small
 * local counters in storage.ts.
 */

import { shouldForceFollowingTab, shouldHideNode } from './rules';
import {
  activeTabLabel,
  findFocusChromeNodes,
  findFollowingTab,
  findSidebarModules,
  findVanityCountNodes,
  isPromotedPost,
  POST_SELECTOR,
} from './selectors';
import { onTogglesChanged, readToggles, trackSessionStart } from './storage';
import { DEFAULT_TOGGLES, ToggleState } from './types';

const HIDDEN_CLASS = 'xfd-hidden';
const FOCUS_CLASS = 'xfd-focus-mode';

let toggles: ToggleState = { ...DEFAULT_TOGGLES };
let observer: MutationObserver | null = null;
let scheduled = false;

/**
 * One pass over the current DOM. Every hide decision goes through
 * shouldHideNode so the popup, this function and scripts/selftest.mjs can
 * never disagree about what a toggle does. Nothing here removes a node —
 * only classList add/remove — so a wrong selector in selectors.ts can, at
 * worst, leave something visible that should have been hidden. It can
 * never break the page.
 */
function apply(): void {
  applyPosts();
  applySidebarModules();
  applyFocusChrome();
  applyFocusColumn();
  applyFollowingDefault();
}

function applyPosts(): void {
  const posts = document.querySelectorAll<HTMLElement>(POST_SELECTOR);
  for (const post of Array.from(posts)) {
    const isAd = isPromotedPost(post);
    post.classList.toggle(HIDDEN_CLASS, isAd && shouldHideNode({ kind: 'ad-post' }, toggles));

    // classList.toggle (not .add) means flipping hideVanityCounts back off
    // restores counts on already-visited posts too, not just newly-scanned
    // ones — every pass re-evaluates every currently-rendered post.
    for (const node of findVanityCountNodes(post)) {
      (node as HTMLElement).classList.toggle(HIDDEN_CLASS, shouldHideNode({ kind: 'vanity-count' }, toggles));
    }
  }
}

function applySidebarModules(): void {
  for (const module of findSidebarModules()) {
    (module as HTMLElement).classList.toggle(HIDDEN_CLASS, shouldHideNode({ kind: 'sidebar-suggestion-module' }, toggles));
  }
}

function applyFocusChrome(): void {
  for (const node of findFocusChromeNodes()) {
    (node as HTMLElement).classList.toggle(HIDDEN_CLASS, shouldHideNode({ kind: 'focus-chrome' }, toggles));
  }
}

function applyFocusColumn(): void {
  document.documentElement.classList.toggle(FOCUS_CLASS, toggles.focusMode);
}

/**
 * Clicks X's own Following tab control when the toggle calls for it. This
 * is a plain UI navigation — the same thing a click on that tab always
 * does — not a write against the platform: no API call, no change to the
 * user's account or data. Never fires when the current tab can't be
 * confidently read (rules.ts returns false rather than guessing), and never
 * fires anywhere except the home timeline.
 */
function applyFollowingDefault(): void {
  const label = activeTabLabel();
  if (!shouldForceFollowingTab(toggles, location.pathname, label)) return;
  const tab = findFollowingTab();
  tab?.click();
}

function scheduleApply(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try {
      apply();
    } catch {
      // A layout change under us should mean "this pass did less than it
      // could", never a broken timeline (PRD §5/§6) — swallow and let the
      // next mutation/navigation pass try again.
    }
  });
}

function observeTimeline(): void {
  observer?.disconnect();
  observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, { childList: true, subtree: true });
}

/** X is a client-rendered SPA; polling the URL is the most portable way to
 * notice an in-app navigation without depending on an undocumented event. */
function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    scheduleApply();
  }, 700);
}

async function init(): Promise<void> {
  toggles = await readToggles();
  onTogglesChanged(next => {
    toggles = next;
    scheduleApply();
  });
  void trackSessionStart();
  observeTimeline();
  watchNavigation();
  scheduleApply();
}

void init();
