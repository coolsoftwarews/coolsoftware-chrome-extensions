/**
 * Runs on x.com/twitter.com. Its whole job:
 *   1. read post text already rendered in the timeline, search results or a
 *      profile the user is looking at
 *   2. run it through the local matching engine
 *   3. collapse a match to a one-line placeholder — never delete it, never
 *      hide it silently — and count the hit, locally
 *   4. answer the panel's questions about this tab
 *
 * It never writes to the page beyond that placeholder, never clicks
 * anything on the user's behalf, and never fetches anything — read-only,
 * foreground-only, exactly what the PRD promises (§5: "it reads only the
 * text X has already rendered... in the tab the user is actively looking
 * at").
 */

import { extractPost, findPostArticles, hasReadableContent } from './extract';
import { formatPlaceholder, isRuleTooBroad, matchPost } from './rules';
import { track } from './metrics';
import { mutateRules, readRules } from './storage';
import { PanelToContent, Rule, RuleMatch, TabStatus } from './types';

const HIDDEN_ATTR = 'data-xkm-hidden';
const SCANNED_ATTR = 'data-xkm-scanned';
const UI_ATTR = 'data-xkm-ui';
const STYLE_ID = 'xkm-hide-style';

let rules: Rule[] = [];
let sessionScanned = 0;
let sessionHiddenCount = 0;

/** Session-only, in-memory (PRD §7: the too-broad warning is a session
 *  signal, not a persisted daily breakdown per rule). */
const sessionHitsByRule = new Map<string, number>();
const warnedRuleIds = new Set<string>();

async function loadRules(): Promise<void> {
  rules = await readRules();
}

/* ── Hiding: an attribute + one injected stylesheet, never moving or
 * removing X's own DOM nodes (React owns article's children; this only adds
 * an attribute and appends one new sibling, both of which React tolerates —
 * removing/reparenting its children risks a reconciliation error on the
 * next re-render). ─────────────────────────────────────────────────────── */

function ensureHideStylesheet(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    article[${HIDDEN_ATTR}] > *:not([${UI_ATTR}]) { display: none !important; }
  `;
  document.documentElement.appendChild(style);
}

const PLACEHOLDER_CSS = `
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px;
    border-bottom: 1px solid rgba(120,120,120,.25);
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #71767b;
  }
  .text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    flex: 0 0 auto;
    border: 1px solid rgba(120,120,120,.4);
    background: transparent;
    color: inherit;
    border-radius: 999px;
    padding: 4px 10px;
    font: inherit;
    cursor: pointer;
  }
  button:hover {
    background: rgba(120,120,120,.15);
  }
`;

function paintPlaceholder(article: HTMLElement, match: RuleMatch): void {
  ensureHideStylesheet();
  article.setAttribute(HIDDEN_ATTR, '');

  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;display:block;';
  article.appendChild(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = PLACEHOLDER_CSS;

  const row = document.createElement('div');
  row.className = 'row';

  const text = document.createElement('span');
  text.className = 'text';
  text.textContent = formatPlaceholder(match);

  const showBtn = document.createElement('button');
  showBtn.type = 'button';
  showBtn.textContent = 'Show anyway';
  showBtn.addEventListener('click', () => {
    article.removeAttribute(HIDDEN_ATTR);
    host.remove();
    void track('post_shown_anyway');
  });

  row.append(text, showBtn);
  shadow.append(style, row);
}

/* ── Session-only toast for a rule that looks too broad (PRD §7) ────────── */

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
        max-width: min(420px, 80vw);
        background: #0f0f0f; color: #fff; padding: 10px 16px; border-radius: 12px;
        font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; opacity: .95;
      }
    `;
    const el = document.createElement('div');
    el.className = 'toast';
    el.id = 'xkm-toast-text';
    shadow.append(style, el);
  }
  const text = toastHost.shadowRoot?.getElementById('xkm-toast-text');
  if (text) text.textContent = message;
}

/* ── Scanning ─────────────────────────────────────────────────────────── */

async function evaluateArticle(article: HTMLElement): Promise<void> {
  const post = extractPost(article);
  if (!hasReadableContent(post)) return;

  sessionScanned++;
  const match = matchPost(post, rules);
  if (!match) return;

  paintPlaceholder(article, match);
  sessionHiddenCount++;
  void track('post_hidden');

  const nextHits = (sessionHitsByRule.get(match.ruleId) ?? 0) + 1;
  sessionHitsByRule.set(match.ruleId, nextHits);

  // Persist the all-time hit count on the rule itself (PRD §4/§5).
  void mutateRules(list => {
    const rule = list.find(r => r.id === match.ruleId);
    if (rule) rule.hitCount += 1;
  });

  if (!warnedRuleIds.has(match.ruleId) && isRuleTooBroad(nextHits, sessionScanned)) {
    warnedRuleIds.add(match.ruleId);
    showToast(`"${match.label}" has hidden ${nextHits} of the last ${sessionScanned} posts you scrolled past — check that rule?`);
    void track('rule_flagged_broad');
    void chrome.runtime
      .sendMessage({ type: 'XKM_RULE_FLAGGED_BROAD', ruleId: match.ruleId, label: match.label, hits: nextHits, scanned: sessionScanned })
      .catch(() => undefined);
  }

  void chrome.runtime.sendMessage({ type: 'XKM_POST_HIDDEN' }).catch(() => undefined);
}

let scanning = false;

async function scan(): Promise<void> {
  if (scanning || !rules.length) return;
  scanning = true;
  try {
    const articles = findPostArticles().filter(el => !el.hasAttribute(SCANNED_ATTR));
    for (const article of articles) {
      article.setAttribute(SCANNED_ATTR, '');
      try {
        await evaluateArticle(article);
      } catch {
        /* one hostile post must not stop the rest of the feed */
      }
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

/* ── Lazy-loaded feed + SPA navigation + virtualization recycling ───────── */

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0);
  if (relevant) scheduleScan(250);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    scheduleScan(300);
  }, 700);
}

/* ── Messaging ────────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'XKM_GET_TAB_STATUS': {
      const status: TabStatus = { onX: true, sessionScanned, sessionHiddenCount };
      sendResponse(status);
      return false;
    }
    case 'XKM_RULES_CHANGED':
      void loadRules().then(() => {
        // Rules changed — re-evaluate everything currently on screen, not
        // just what loads next, so toggling a rule feels immediate. Every
        // previously-hidden post is unhidden first so a rule that was
        // disabled/deleted actually reveals its matches again, then the
        // whole visible set is rescanned from scratch.
        for (const el of Array.from(document.querySelectorAll(`[${SCANNED_ATTR}]`))) {
          el.removeAttribute(SCANNED_ATTR);
        }
        for (const el of Array.from(document.querySelectorAll(`[${HIDDEN_ATTR}]`))) {
          el.removeAttribute(HIDDEN_ATTR);
          el.querySelector(`[${UI_ATTR}]`)?.remove();
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
