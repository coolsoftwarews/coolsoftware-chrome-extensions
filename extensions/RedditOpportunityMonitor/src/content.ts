/**
 * Runs on reddit.com. Its whole job:
 *   1. read posts already rendered in the feed the user is scrolling
 *   2. run each one through the local rules engine
 *   3. paint a small, non-shifting chip on a match and save it locally
 *   4. answer the panel's questions about this tab
 *
 * It never writes to the page beyond that chip, never votes, comments,
 * follows or posts anything, and never fetches anything — read-only,
 * foreground-only, exactly what the PRD promises (§5: "only what Reddit
 * renders in the user's tab as they browse"). Comment threads are not read —
 * V1 is posts only (PRD §7) — and nothing here reacts to NSFW/quarantine
 * warnings beyond scanning whatever text is actually rendered.
 */

import {
  detectFrontend,
  extractPost,
  findPosts,
  RawPost,
  subredditFromPath,
} from './extract';
import { allIntentPhrases, evaluatePost, formatReasonChip, ScannedPostStat, summarizeSubreddit } from './rules';
import { track } from './metrics';
import { readRules, upsertOpportunity } from './storage';
import {
  MAX_CAPTURES_PER_SESSION,
  Opportunity,
  PanelToContent,
  Rule,
  TabStatus,
} from './types';

const BADGE_ATTR = 'data-rom-badge';
const SCANNED_ATTR = 'data-rom-scanned';
const UI_ATTR = 'data-rom-ui';

/** Bound on the in-memory stats kept for the "subreddit read" summary — this
 * is a live, this-session number (PRD §4: "from what's loaded"), not a
 * database, so a hard cap keeps memory flat on a long scrolling session. */
const MAX_SCANNED_STATS = 1500;

const frontend = detectFrontend(location.hostname);

let rules: Rule[] = [];
let sessionCaptured = 0;
let sessionCapped = false;
let capToastShown = false;
const scannedStats: ScannedPostStat[] = [];

async function loadRules(): Promise<void> {
  rules = await readRules();
}

/* ── Chip UI (shadow DOM per chip — no CSS leaks either direction) ──────── */

const CHIP_CSS = `
  .chip {
    display: inline-flex;
    align-items: center;
    max-width: 100%;
    padding: 2px 8px;
    margin-left: 6px;
    border-radius: 999px;
    background: #fff4cc;
    color: #4a3200;
    border: 1px solid #e0b400;
    font: 600 11px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    vertical-align: middle;
  }
`;

/**
 * Inserted inline right after the title, at first render — never on top of
 * content the user has already seen, so nothing already on screen moves
 * (PRD §6: "no layout shift"). A `<span>` with its own shadow root keeps the
 * host page's CSS from reaching in either direction.
 */
function paintChip(anchor: Element, chipText: string, tooltip: string): void {
  if (anchor.hasAttribute(BADGE_ATTR)) return;
  anchor.setAttribute(BADGE_ATTR, '');

  const host = document.createElement('span');
  host.style.cssText = 'all:initial;';
  anchor.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CHIP_CSS;
  const chip = document.createElement('span');
  chip.className = 'chip';
  chip.textContent = chipText;
  chip.title = tooltip;
  shadow.append(style, chip);
}

/** Where to hang the chip: right after the title text, in whichever
 * front-end's markup is live. Falls back to the post container itself so a
 * chip is never silently dropped. */
function titleAnchorFor(frontendName: 'old' | 'new', el: HTMLElement): Element {
  if (frontendName === 'old') {
    return el.querySelector('p.title') || el;
  }
  return (
    el.querySelector('[slot="title"]') ||
    el.querySelector('a[slot="full-post-link"]') ||
    el
  );
}

let toastHost: HTMLDivElement | null = null;

function showToast(message: string): void {
  if (!toastHost) {
    toastHost = document.createElement('div');
    toastHost.setAttribute(UI_ATTR, '');
    toastHost.style.cssText =
      'all:initial;position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:2147483647;';
    document.documentElement.appendChild(toastHost);
    const shadow = toastHost.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = `
      .toast {
        background: #0f0f0f; color: #fff; padding: 8px 14px; border-radius: 999px;
        font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; opacity: .95;
      }
    `;
    const el = document.createElement('div');
    el.className = 'toast';
    el.id = 'rom-toast-text';
    shadow.append(style, el);
  }
  const text = toastHost.shadowRoot?.getElementById('rom-toast-text');
  if (text) text.textContent = message;
}

/* ── Scanning ─────────────────────────────────────────────────────────── */

function recordScanStat(post: RawPost): void {
  scannedStats.push({ subreddit: post.subreddit, score: post.score, text: `${post.title} ${post.snippet}` });
  if (scannedStats.length > MAX_SCANNED_STATS) scannedStats.splice(0, scannedStats.length - MAX_SCANNED_STATS);
}

async function processPost(el: HTMLElement): Promise<void> {
  const post = extractPost(frontend, el);
  if (!post) return;

  recordScanStat(post);

  const hits = evaluatePost(`${post.title} ${post.snippet}`, rules);
  if (!hits.length) return;

  if (sessionCaptured >= MAX_CAPTURES_PER_SESSION) {
    if (!capToastShown) {
      capToastShown = true;
      showToast(`Reached this session's limit of ${MAX_CAPTURES_PER_SESSION} matched threads. Reload to continue.`);
      void track('session_cap_reached');
      void chrome.runtime.sendMessage({ type: 'ROM_SESSION_CAP_REACHED' }).catch(() => undefined);
    }
    sessionCapped = true;
    return;
  }

  const item: Opportunity = {
    id: post.id,
    subreddit: post.subreddit,
    title: post.title,
    snippet: post.snippet,
    permalink: post.permalink,
    score: post.score,
    numComments: post.numComments,
    postedAtLabel: post.postedAtLabel,
    createdAtMs: post.createdAtMs,
    capturedAt: Date.now(),
    matches: hits,
    status: 'new',
    note: '',
    frontend,
  };

  const { isNew } = await upsertOpportunity(item);
  if (isNew) {
    sessionCaptured++;
    void track('post_captured');
    void chrome.runtime.sendMessage({ type: 'ROM_OPPORTUNITY_CAPTURED', id: item.id }).catch(() => undefined);
  }

  const chipText = `${formatReasonChip(hits[0])} · r/${post.subreddit}${
    post.numComments !== null ? ` · ${post.numComments} comments` : ''
  }`;
  const tooltip = hits.map(formatReasonChip).join('\n');
  paintChip(titleAnchorFor(frontend, el), chipText, tooltip);
}

let scanning = false;

async function scan(): Promise<void> {
  // Scanning still runs with zero rules — the subreddit-read summary (post
  // volume, median score) is useful before the user has written a single
  // rule, and is how they'll judge what to write one for.
  if (scanning) return;
  scanning = true;
  try {
    const posts = findPosts(frontend).filter(el => !el.hasAttribute(SCANNED_ATTR));
    for (const el of posts) {
      el.setAttribute(SCANNED_ATTR, '');
      try {
        await processPost(el);
      } catch {
        /* one hostile post must not stop the rest of the feed */
      }
      if (sessionCapped) break;
    }
  } finally {
    scanning = false;
  }
}

let scanTimer: number | undefined;
function scheduleScan(delay = 200): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), delay);
}

/* ── Lazy-loaded feed + SPA navigation (PRD §7) ──────────────────────────── */

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0);
  if (relevant) scheduleScan(250);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    // New Reddit is a SPA; a URL change can mean a different subreddit even
    // without a full navigation.
    scheduleScan(300);
  }, 700);
}

/* ── Messaging ────────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'ROM_GET_TAB_STATUS': {
      const subreddit = subredditFromPath(location.pathname);
      const status: TabStatus = {
        onReddit: true,
        frontend,
        subreddit,
        summary: subreddit ? summarizeSubreddit(subreddit, scannedStats, allIntentPhrases(rules)) : null,
        sessionCaptured,
        sessionCapped,
      };
      sendResponse(status);
      return false;
    }
    case 'ROM_RULES_CHANGED':
      void loadRules().then(() => {
        // Rules changed — re-evaluate everything currently on screen, not
        // just what loads next, so turning a rule on/off feels immediate.
        for (const el of Array.from(document.querySelectorAll(`[${SCANNED_ATTR}]`))) {
          el.removeAttribute(SCANNED_ATTR);
        }
        scheduleScan(50);
      });
      return false;
    default:
      return false;
  }
});

/* ── Boot ─────────────────────────────────────────────────────────────── */

if (window.top === window) {
  void loadRules().then(() => scheduleScan(150));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchUrl();
}
