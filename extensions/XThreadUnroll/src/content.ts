/**
 * Runs on x.com/twitter.com. Two jobs:
 *   1. show an "Unroll" control on every tweet that starts a same-author
 *      reply chain (PRD-25 §4)
 *   2. on click, gather that chain — auto-scrolling the timeline in small,
 *      bounded steps so X's lazy-loaded replies get pulled into the DOM —
 *      and stream the growing result to the side panel as it goes
 *
 * Same virtualized-React posture as XConversationSaver's content.ts: never
 * insert anything into X's own tree (list cells get recycled as the user
 * scrolls, and a React re-render can wipe a child an extension appended
 * inside it). One shadow root is appended to `document.documentElement`
 * instead, and every control is an absolutely-positioned badge floating
 * over its tweet.
 *
 * Nothing here makes a network request — see PRIVACY.md.
 */

import { track } from './metrics';
import { gatherChain, isThreadRoot, findTweetArticles } from './scrape';
import { ContentToBackground, ContentToPanel, PanelToContent, ThreadSession } from './types';

const UI_ATTR = 'data-xtu-ui';
const MAX_SCROLL_STEPS = 24;
const STABLE_ROUNDS_TO_STOP = 3;
const SCROLL_PAUSE_MS = 380;

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;
let badgeLayer: HTMLDivElement | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);

  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);

  badgeLayer = document.createElement('div');
  badgeLayer.className = 'layer';
  shadow.appendChild(badgeLayer);

  return shadow;
}

const SHADOW_CSS = `
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .badge {
    position: fixed;
    pointer-events: auto;
    font: 12px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .badge button {
    display: flex;
    align-items: center;
    gap: 4px;
    border: 1px solid rgba(0,0,0,.14);
    background: #ffffff;
    color: #0f1419;
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0,0,0,.16);
    padding: 4px 10px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge button:hover:not(:disabled) { background: #f4f4f5; }
  .badge button:focus-visible { outline: 2px solid #1d7a5f; outline-offset: 1px; }
  .badge button:disabled { opacity: .7; cursor: default; }
  .badge button[data-active="true"] { background: #e3f6ef; color: #0c6b34; }
`;

interface Badge {
  article: HTMLElement;
  el: HTMLDivElement;
  button: HTMLButtonElement;
}

const badges = new Map<HTMLElement, Badge>();

function makeBadge(article: HTMLElement): Badge {
  const el = document.createElement('div');
  el.className = 'badge';

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Unroll';
  button.setAttribute('aria-label', 'Unroll this thread into a reading view');
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleUnroll(article, button);
  });

  el.appendChild(button);
  badgeLayer!.appendChild(el);
  return { article, el, button };
}

/** Adds/removes badges for whatever root tweets are currently in the DOM,
 *  and repositions the ones that remain. */
function syncBadges(): void {
  ui();
  const articles = findTweetArticles(document);
  const roots = new Set<HTMLElement>();
  for (let i = 0; i < articles.length; i++) {
    if (isThreadRoot(articles, i)) roots.add(articles[i]);
  }

  for (const article of roots) {
    if (!badges.has(article)) badges.set(article, makeBadge(article));
  }
  for (const [article, badge] of badges) {
    if (!roots.has(article) || !document.contains(article)) {
      badge.el.remove();
      badges.delete(article);
    }
  }
  repositionBadges();
}

function repositionBadges(): void {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  for (const { article, el } of badges.values()) {
    const rect = article.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < viewportH && rect.right > 0 && rect.left < viewportW;
    if (!visible) {
      el.style.display = 'none';
      continue;
    }
    el.style.display = 'block';
    const top = Math.max(4, rect.top + 6);
    const left = Math.min(Math.max(4, rect.right - el.offsetWidth - 6), viewportW - el.offsetWidth - 4);
    el.style.top = `${Math.round(top)}px`;
    el.style.left = `${Math.round(left)}px`;
  }
}

let repositionQueued = false;
function scheduleReposition(): void {
  if (repositionQueued) return;
  repositionQueued = true;
  requestAnimationFrame(() => {
    repositionQueued = false;
    repositionBadges();
  });
}

let syncTimer: number | undefined;
function scheduleSync(delay = 250): void {
  if (unrollInProgress) return; // don't fight our own auto-scroll's DOM growth
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(syncBadges, delay);
}

/* ── Unrolling ───────────────────────────────────────────────────────── */

let unrollInProgress = false;
let stopRequested = false;
let currentSession: ThreadSession | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function broadcast(session: ThreadSession): void {
  currentSession = session;
  const message: ContentToPanel = { type: 'XTU_THREAD_UPDATE', session };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

function requestPanel(): void {
  const message: ContentToBackground = { type: 'XTU_OPEN_PANEL' };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function handleUnroll(origin: HTMLElement, button: HTMLButtonElement): Promise<void> {
  if (unrollInProgress) return;

  const roots = findTweetArticles(document);
  const index = roots.indexOf(origin);

  // scrape.ts's chain reader needs a handle to key off of; read the origin
  // article's own handle first (deriveHandleFallback), then use it as the
  // key for a 1-post probe so we get the origin post's parsed fields back
  // through the same extraction path everything else uses.
  const rootHandle = deriveHandleFallback(origin);
  const probe = gatherChain(origin, rootHandle, 1);
  const rootAuthor = probe.items[0]?.author ?? '';

  if (!rootHandle) {
    button.disabled = false;
    return;
  }

  unrollInProgress = true;
  stopRequested = false;
  button.disabled = true;
  button.dataset.active = 'true';
  button.textContent = 'Unrolling…';
  requestPanel();

  let session: ThreadSession = {
    key: probe.items[0]?.id || `${rootHandle}:${index}`,
    rootAuthor,
    rootHandle,
    posts: [],
    status: 'collecting',
    truncated: false,
    cappedAt200: false,
    startedAt: Date.now(),
  };
  broadcast(session);

  try {
    let stableRounds = 0;
    let lastCount = 0;

    for (let step = 0; step < MAX_SCROLL_STEPS && stableRounds < STABLE_ROUNDS_TO_STOP; step++) {
      if (stopRequested) break;

      const chain = gatherChain(origin, rootHandle, 200);
      session = {
        ...session,
        posts: chain.items,
        truncated: chain.truncated,
        cappedAt200: chain.cappedAt200,
        status: 'collecting',
      };
      broadcast(session);

      if (chain.cappedAt200 || chain.boundaryHit) break;

      const readableCount = chain.items.filter(p => !p.deleted).length;
      if (readableCount === lastCount) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastCount = readableCount;
      }

      window.scrollBy({ top: window.innerHeight * 0.85, behavior: 'auto' });
      await sleep(SCROLL_PAUSE_MS);
    }

    session = { ...session, status: session.cappedAt200 ? 'capped' : 'done' };
    broadcast(session);

    void track('thread_unrolled');
    if (session.cappedAt200) void track('thread_capped');
    if (session.truncated) void track('thread_truncated');
  } catch {
    session = { ...session, status: 'error', errorMessage: 'Could not finish reading this thread.' };
    broadcast(session);
    void track('unroll_error');
  } finally {
    unrollInProgress = false;
    button.disabled = false;
    button.textContent = 'Unrolled';
    window.setTimeout(() => {
      button.textContent = 'Unroll';
      button.dataset.active = 'false';
    }, 2000);
  }
}

/** scrape.ts's chain reader needs a handle to key off of; for the very
 *  first read we don't have one yet, so ask for a 1-post chain from the
 *  article itself, which reads its own author regardless of the handle
 *  passed in (an empty/never-matching handle just means nothing "continues"
 *  the chain on that first call, which is fine — we only want post 0). */
function deriveHandleFallback(article: HTMLElement): string {
  const nameBlock = article.querySelector('[data-testid="User-Name"] a[role="link"][href^="/"]');
  const href = nameBlock?.getAttribute('href') ?? '';
  return href.replace(/^\//, '').split(/[/?#]/)[0]?.toLowerCase() ?? '';
}

/* ── Messages from the panel ─────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  const msg = message as PanelToContent | undefined;
  if (msg?.type === 'XTU_REQUEST_STATE') {
    sendResponse(currentSession);
    return false;
  }
  if (msg?.type === 'XTU_STOP') {
    stopRequested = true;
    return false;
  }
  return false;
});

/* ── Boot ────────────────────────────────────────────────────────────── */

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  syncBadges();

  const observer = new MutationObserver(() => scheduleSync(300));
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // Virtualized content can settle after the mutation burst ends; a light
  // interval keeps badges honest without polling the network or X's API.
  window.setInterval(() => {
    if (!unrollInProgress) syncBadges();
  }, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
