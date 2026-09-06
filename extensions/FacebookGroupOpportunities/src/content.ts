/**
 * Runs on facebook.com. Its whole job:
 *   1. read post text already rendered in a group feed the user is scrolling
 *   2. run it through the local rules engine
 *   3. paint a small, non-shifting badge on a match and save it locally
 *   4. answer the panel's questions about this tab
 *
 * It never writes to the page beyond that badge, never clicks anything, and
 * never fetches anything — read-only, foreground-only, exactly what the PRD
 * promises (§5: "it finds opportunities in what you read, not in what you
 * don't"). Scanning only runs under /groups/ — the personal feed, Marketplace
 * and Watch are out of scope on purpose.
 */

import { evaluatePost, formatReasonChip } from './rules';
import { extractPost, findPostArticles, readGroupContext } from './extract';
import { opportunityId } from './dedupe';
import { track } from './metrics';
import { readRules, upsertOpportunity } from './storage';
import { MAX_CAPTURES_PER_SESSION, Opportunity, PanelToContent, Rule, TabStatus } from './types';

const BADGE_ATTR = 'data-fgo-badge';
const SCANNED_ATTR = 'data-fgo-scanned';
const UI_ATTR = 'data-fgo-ui';

const inGroup = location.pathname.startsWith('/groups/');

let rules: Rule[] = [];
let sessionCaptured = 0;
let sessionCapped = false;
let capToastShown = false;

async function loadRules(): Promise<void> {
  rules = await readRules();
}

/* ── Badge UI (shadow DOM per badge — no CSS leaks either direction) ────── */

const BADGE_CSS = `
  .chip {
    display: inline-block;
    max-width: 280px;
    padding: 3px 8px;
    border-radius: 999px;
    background: #fff4cc;
    color: #4a3200;
    border: 1px solid #e0b400;
    font: 600 11px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 1px 4px rgba(0,0,0,.18);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    pointer-events: none;
  }
`;

function paintBadge(article: HTMLElement, chipText: string, tooltip: string): void {
  if (article.hasAttribute(BADGE_ATTR)) return;
  article.setAttribute(BADGE_ATTR, '');

  // Absolute + a positioned ancestor keeps the badge from disturbing layout at
  // all (PRD §6: "no layout shift"); it never changes the article's box size.
  if (getComputedStyle(article).position === 'static') {
    article.style.position = 'relative';
  }

  const host = document.createElement('span');
  host.style.cssText = 'all:initial;position:absolute;top:6px;right:6px;z-index:2147483000;';
  article.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = BADGE_CSS;
  const chip = document.createElement('div');
  chip.className = 'chip';
  chip.textContent = chipText;
  chip.title = tooltip;
  shadow.append(style, chip);
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
    el.id = 'fgo-toast-text';
    shadow.append(style, el);
  }
  const text = toastHost.shadowRoot?.getElementById('fgo-toast-text');
  if (text) text.textContent = message;
}

/* ── Scanning ─────────────────────────────────────────────────────────── */

async function captureMatch(article: HTMLElement, groupName: string, groupUrl: string | null): Promise<void> {
  const extracted = extractPost(article);
  if (!extracted) return;

  const hits = evaluatePost(extracted.text, rules);
  if (!hits.length) return;

  if (sessionCaptured >= MAX_CAPTURES_PER_SESSION) {
    if (!capToastShown) {
      capToastShown = true;
      showToast(`Reached this session's limit of ${MAX_CAPTURES_PER_SESSION} matched posts. Reload to continue.`);
      void track('session_cap_reached');
      void chrome.runtime.sendMessage({ type: 'FGO_SESSION_CAP_REACHED' }).catch(() => undefined);
    }
    sessionCapped = true;
    return;
  }

  const item: Opportunity = {
    id: opportunityId(groupName, extracted.author, extracted.text),
    groupName,
    groupUrl,
    author: extracted.author,
    postText: extracted.text,
    postUrl: extracted.postUrl,
    commentCount: extracted.commentCount,
    postedAt: extracted.postedAt,
    capturedAt: Date.now(),
    matches: hits,
    status: 'new',
    note: '',
  };

  const { isNew } = await upsertOpportunity(item);
  if (isNew) {
    sessionCaptured++;
    void track('post_captured');
    void chrome.runtime.sendMessage({ type: 'FGO_OPPORTUNITY_CAPTURED', id: item.id }).catch(() => undefined);
  }

  paintBadge(article, formatReasonChip(hits[0]), hits.map(formatReasonChip).join('\n'));
}

let scanning = false;

async function scan(): Promise<void> {
  if (!inGroup || scanning || sessionCapped || !rules.length) return;
  scanning = true;
  try {
    const { groupName, groupUrl } = readGroupContext();
    const articles = findPostArticles().filter(el => !el.hasAttribute(SCANNED_ATTR));
    for (const article of articles) {
      article.setAttribute(SCANNED_ATTR, '');
      try {
        await captureMatch(article, groupName, groupUrl);
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
function scheduleScan(delay = 250): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), delay);
}

/* ── Lazy-loaded feed + SPA navigation (PRD §7) ──────────────────────────── */

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0);
  if (relevant) scheduleScan(300);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    // A fresh URL under /groups/ may be a different group; re-read context and rescan.
    scheduleScan(400);
  }, 700);
}

/* ── Messaging ────────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'FGO_GET_TAB_STATUS': {
      const status: TabStatus = {
        onFacebook: true,
        onGroup: inGroup,
        groupName: inGroup ? readGroupContext().groupName : null,
        sessionCaptured,
        sessionCapped,
      };
      sendResponse(status);
      return false;
    }
    case 'FGO_RULES_CHANGED':
      void loadRules().then(() => {
        // Rules changed — re-evaluate everything currently on screen, not just
        // what loads next, so turning a rule on/off feels immediate.
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
  void loadRules().then(() => scheduleScan(200));
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchUrl();
}
