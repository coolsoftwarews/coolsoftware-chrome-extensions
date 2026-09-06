/**
 * Runs on x.com/twitter.com. Two jobs:
 *   1. show a "+ Save · + Save thread" control next to every post (PRD §4)
 *   2. capture on click and write straight to chrome.storage.local
 *
 * X is a heavily virtualized React app: list cells get recycled as the user
 * scrolls, and any DOM node an extension inserts *inside* a React-owned
 * subtree can be wiped on the next re-render. So this file never inserts
 * anything into X's own tree. Instead, exactly like WebHighlighter's
 * selection popover, one shadow root is appended to `document.documentElement`
 * and every "+ Save" control is an absolutely-positioned badge floating over
 * its tweet, repositioned from `getBoundingClientRect()`. A save reads the
 * live DOM at the moment of the click, so a recycled node is a non-issue —
 * whatever is on screen when the user clicks is what gets captured (PRD §6).
 *
 * Nothing here makes a network request — see PRIVACY.md.
 */

import { buildItem } from './capture';
import { track } from './metrics';
import { collectThread, extractPost, findTweetArticles } from './scrape';
import { readCollections, saveItem } from './storage';
import { CapturedPost, ContentToPanel, ItemKind } from './types';

const UI_ATTR = 'data-xcs-ui';

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

  const toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  shadow.appendChild(toastEl);

  return shadow;
}

const SHADOW_CSS = `
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .badge {
    position: fixed;
    display: flex;
    gap: 4px;
    background: #ffffff;
    border: 1px solid rgba(0,0,0,.14);
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0,0,0,.16);
    padding: 3px;
    pointer-events: auto;
    font: 12px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  .badge button {
    border: none;
    background: #f4f4f5;
    color: #0f1419;
    border-radius: 999px;
    padding: 4px 9px;
    cursor: pointer;
    font: inherit;
    font-weight: 600;
    white-space: nowrap;
  }
  .badge button:hover { background: #e6e8ea; }
  .badge button:focus-visible { outline: 2px solid #6b4eff; outline-offset: 1px; }
  .badge button[data-kind="thread"] { background: #efeaff; color: #3d2b8c; }
  .badge button[data-kind="thread"]:hover { background: #e2d9ff; }
  .badge--saved button[data-kind="post"] { background: #dcf5e6; color: #0c6b34; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #0f1419; color: #fff; padding: 8px 14px; border-radius: 999px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    opacity: 0; transition: opacity .18s ease; pointer-events: none;
  }
  .toast--on { opacity: .95; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

let toastTimer: number | undefined;
function toast(message: string): void {
  ui();
  const el = shadow!.querySelector<HTMLDivElement>('.toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el.classList.remove('toast--on'), 1800);
}

/* ── Badges ──────────────────────────────────────────────────────────── */

interface Badge {
  article: HTMLElement;
  el: HTMLDivElement;
}

const badges = new Map<HTMLElement, Badge>();
let defaultCollectionId = 'reference';

function makeBadge(article: HTMLElement): Badge {
  const el = document.createElement('div');
  el.className = 'badge';

  const save = document.createElement('button');
  save.type = 'button';
  save.dataset.kind = 'post';
  save.textContent = '+ Save';
  save.setAttribute('aria-label', 'Save this post to X Conversation Saver');
  save.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleSave(article, 'single', el);
  });

  const saveThread = document.createElement('button');
  saveThread.type = 'button';
  saveThread.dataset.kind = 'thread';
  saveThread.textContent = '+ Save thread';
  saveThread.setAttribute('aria-label', 'Save this whole visible thread to X Conversation Saver');
  saveThread.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleSave(article, 'thread', el);
  });

  el.append(save, saveThread);
  badgeLayer!.appendChild(el);
  return { article, el };
}

/** Adds/removes badges for whatever tweets are currently in the DOM, and
 *  repositions the ones that remain. Cheap even on a busy timeline — at most
 *  a few dozen articles are ever mounted at once thanks to virtualization. */
function syncBadges(): void {
  ui();
  const present = new Set(findTweetArticles(document));

  for (const article of present) {
    if (!badges.has(article)) badges.set(article, makeBadge(article));
  }
  for (const [article, badge] of badges) {
    if (!present.has(article) || !document.contains(article)) {
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
    el.style.display = 'flex';
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
  window.clearTimeout(syncTimer);
  syncTimer = window.setTimeout(syncBadges, delay);
}

/* ── Saving ──────────────────────────────────────────────────────────── */

function notifyPanel(id: string, kind: ItemKind): void {
  const message: ContentToPanel = { type: 'XCS_ITEM_SAVED', id, kind };
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

async function handleSave(article: Element, mode: 'single' | 'thread', badgeEl: HTMLDivElement): Promise<void> {
  const buttons = badgeEl.querySelectorAll('button');
  buttons.forEach(b => (b.disabled = true));

  try {
    let posts: CapturedPost[];
    let truncated = false;

    if (mode === 'single') {
      const post = extractPost(article);
      if (!post) {
        toast('Could not read this post — try again once it has fully loaded.');
        return;
      }
      posts = [post];
    } else {
      const { articles, truncated: t } = collectThread(article);
      truncated = t;
      posts = articles.map(a => extractPost(a)).filter((p): p is CapturedPost => p !== null);
      if (!posts.length) {
        toast('Could not read this thread — try again once it has fully loaded.');
        return;
      }
    }

    const item = await saveItem(posts[0].id, existing => buildItem(posts, existing, defaultCollectionId, truncated));

    badgeEl.classList.add('badge--saved');
    if (item.kind === 'post') {
      toast('Saved');
      void track('post_saved');
    } else if (item.kind === 'thread') {
      toast(`Saved thread — ${item.posts.length} post${item.posts.length === 1 ? '' : 's'} captured${truncated ? ' (more replies were available)' : ''}`);
      void track('thread_saved');
    } else {
      toast(`Saved conversation — ${item.posts.length} posts, ${item.authors.length} people${truncated ? ' (more replies were available)' : ''}`);
      void track('conversation_saved');
    }
    notifyPanel(item.id, item.kind);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not save this post.');
  } finally {
    buttons.forEach(b => (b.disabled = false));
  }
}

/* ── Boot ────────────────────────────────────────────────────────────── */

async function refreshDefaultCollection(): Promise<void> {
  try {
    const collections = await readCollections();
    defaultCollectionId = collections[0]?.id ?? 'reference';
  } catch {
    /* keep the fallback */
  }
}

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  void refreshDefaultCollection();
  syncBadges();

  const observer = new MutationObserver(() => scheduleSync(300));
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // Virtualized content can settle after the mutation burst ends; a light
  // interval keeps badges honest without polling the network or X's API.
  window.setInterval(syncBadges, 2000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
