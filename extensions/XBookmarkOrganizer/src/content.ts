/**
 * Runs only on X's own Bookmarks page (see manifest `content_scripts.matches`
 * in scripts/build.mjs — narrower than the extension's host_permissions,
 * which cover the whole site so the side panel can be used for search
 * anywhere on X). Two jobs:
 *   1. passively index whatever bookmarks are rendered as the user scrolls
 *      (PRD §4/§5 — "paginated as they scroll, since that's all a read-only
 *      extension can see")
 *   2. run a bounded auto-scroll pass on request from the panel's "Re-index"
 *      button (PRD §4/§10 — user-triggered, foreground only, never a
 *      background crawl)
 *
 * X is a heavily virtualized React app: list cells get recycled as the user
 * scrolls, and any DOM node an extension inserts *inside* a React-owned
 * subtree can be wiped on the next re-render. Exactly like XConversationSaver
 * and WebHighlighter, this file never writes into X's own tree — the only UI
 * here is a small floating status pill in a shadow root appended to
 * `document.documentElement`.
 *
 * Nothing here makes a network request — see PRIVACY.md.
 */

import { beginIndexingSession, indexBookmarks, readCollections } from './storage';
import { track } from './metrics';
import { extractVisibleBookmarks, isBookmarksTabActive } from './scrape';
import { ContentToPanel, PanelToContent } from './types';

const UI_ATTR = 'data-xbo-ui';
const MAX_AUTOSCROLL_SCREENS = 24; // a generous but bounded ceiling — never unbounded (PRD §6/§10)

let defaultCollectionId = 'read-later';
let sessionAt = 0;
let indexedCount = 0;

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;
let pillEl: HTMLDivElement | null = null;

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

  pillEl = document.createElement('div');
  pillEl.className = 'pill';
  pillEl.setAttribute('role', 'status');
  pillEl.setAttribute('aria-live', 'polite');
  shadow.appendChild(pillEl);

  return shadow;
}

const SHADOW_CSS = `
  .pill {
    position: fixed;
    right: 16px;
    bottom: 16px;
    background: #15202b;
    color: #fff;
    padding: 8px 14px;
    border-radius: 999px;
    font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    box-shadow: 0 4px 16px rgba(0,0,0,.28);
    opacity: 0;
    transform: translateY(6px);
    transition: opacity .18s ease, transform .18s ease;
    pointer-events: none;
  }
  .pill--on { opacity: .96; transform: translateY(0); }
  @media (prefers-reduced-motion: reduce) { .pill { transition: none; } }
`;

let pillTimer: number | undefined;
function showPill(message: string, sticky = false): void {
  ui();
  if (!pillEl) return;
  pillEl.textContent = message;
  pillEl.classList.add('pill--on');
  window.clearTimeout(pillTimer);
  if (!sticky) pillTimer = window.setTimeout(() => pillEl?.classList.remove('pill--on'), 2200);
}

/* ── Indexing ────────────────────────────────────────────────────────── */

// The old dedicated URL has no tab switcher — it's unambiguous. X later
// folded Bookmarks into /i/history alongside Likes on one shared path, so
// there only the DOM (isBookmarksTabActive) can say which tab is showing.
function onBookmarksPage(): boolean {
  if (/^\/i\/bookmarks(\/|$)/.test(location.pathname)) return true;
  return isBookmarksTabActive();
}

async function indexVisible(): Promise<void> {
  if (!onBookmarksPage()) return;
  const posts = extractVisibleBookmarks(document);
  if (!posts.length) return;
  try {
    const { newCount, updatedCount } = await indexBookmarks(posts, defaultCollectionId, sessionAt);
    if (newCount) {
      indexedCount += newCount;
      void track('bookmark_indexed');
      showPill(`Indexed ${indexedCount} bookmark${indexedCount === 1 ? '' : 's'} so far`);
    }
    if (updatedCount) void track('bookmark_updated');
  } catch (error) {
    showPill(error instanceof Error ? error.message : 'Could not save — storage may be full.', true);
  }
}

let scanTimer: number | undefined;
function scheduleScan(delay = 350): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void indexVisible(), delay);
}

/* ── Bounded auto-scroll (panel-triggered "Re-index") ───────────────── */

let reindexing = false;

async function runAutoScroll(screens: number): Promise<{ scrolled: number; wrongTab?: boolean }> {
  if (reindexing) return { scrolled: 0 };
  if (!onBookmarksPage()) {
    showPill('Switch to the Bookmarks tab first', true);
    return { scrolled: 0, wrongTab: true };
  }
  reindexing = true;
  const bounded = Math.max(1, Math.min(screens, MAX_AUTOSCROLL_SCREENS));
  void track('reindex_started');
  showPill('Re-indexing… scrolling your bookmarks', true);

  let scrolled = 0;
  try {
    for (let i = 0; i < bounded; i++) {
      window.scrollBy({ top: window.innerHeight * 0.9, behavior: 'auto' });
      scrolled++;
      // Give X's virtualization time to render the next batch before reading it.
      await new Promise(resolve => window.setTimeout(resolve, 700));
      await indexVisible();
    }
  } finally {
    reindexing = false;
    void track('reindex_completed');
    showPill(`Indexed ${indexedCount} bookmark${indexedCount === 1 ? '' : 's'} so far`);
  }
  return { scrolled };
}

function notifyPanel(message: ContentToPanel): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message: PanelToContent) => {
  if (message?.type !== 'XBO_START_REINDEX') return;
  void runAutoScroll(message.screens).then(({ scrolled, wrongTab }) =>
    notifyPanel({ type: 'XBO_REINDEX_DONE', scrolled, wrongTab }),
  );
});

/* ── Boot ────────────────────────────────────────────────────────────── */

async function refreshDefaultCollection(): Promise<void> {
  try {
    const collections = await readCollections();
    defaultCollectionId = collections[0]?.id ?? 'read-later';
  } catch {
    /* keep the fallback */
  }
}

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  void (async () => {
    await refreshDefaultCollection();
    sessionAt = await beginIndexingSession();
    await indexVisible();
  })();

  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', () => scheduleScan(500), { passive: true });

  // Virtualized content can settle after the mutation burst ends; a light
  // interval keeps the index honest without polling the network or X's API —
  // this only ever runs while the Bookmarks tab is open (foreground only).
  window.setInterval(() => void indexVisible(), 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
