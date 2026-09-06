/**
 * Boots on every TikTok page (manifest host permission: `*://*.tiktok.com/*`).
 * Two jobs, matched to PRD-45 §4:
 *
 *   1. Render a "Save (original)" button next to every post the ownership
 *      gate (PRD-45 §5) confirms the logged-in account authored — never any
 *      other post, no toggle, no exception. See isOwnPost() below; that
 *      function, and only that function, decides whether a button exists
 *      for a given tile.
 *   2. A small on-page log of what's been saved, toggled by the toolbar icon
 *      or Alt+Shift+S, with Export CSV / Export JSON / Clear all — there is
 *      no separate popup or side-panel page, so this lives in the same
 *      shadow root as the Save buttons (keeps the permission list in
 *      scripts/build.mjs narrow: no extra extension page to grant a host to).
 *
 * TikTok's feed is a heavily virtualized, infinite-scroll React-style app:
 * tiles get recycled as the user scrolls, and any DOM node an extension
 * inserts *inside* TikTok's own tree can be wiped on the next re-render or
 * simply never get read back reliably. So — exactly like XConversationSaver's
 * and WebHighlighter's content.ts — this file never inserts anything into
 * TikTok's own tree. One shadow root is appended to
 * `document.documentElement`, and every Save button and the log panel are
 * absolutely-positioned elements floating over the page, repositioned from
 * `getBoundingClientRect()`. The ownership gate and the video-source read
 * both happen at the moment of interaction (render pass / click), so a
 * recycled tile is a non-issue — whatever is on screen right now is what
 * gets evaluated (PRD-45 §6: "re-evaluated per post render").
 *
 * Nothing here writes to TikTok itself (read-only, PRD-45 §4: "no account
 * action") and nothing here makes a network request — see PRIVACY.md. The
 * one privileged action, actually writing the downloaded file, is relayed to
 * background.ts because content scripts cannot call chrome.downloads
 * directly.
 */

import { handlesMatch, buildFilename, isUsableMediaUrl, normalizeHandle } from './parse';
import { findPostTiles, readOwnHandle, readPostAuthorHandle, waitForVideoSourceUrl, PostTile } from './scrape';
import { addLogEntry, buildExportFilename, clearAllLogEntries, readAllLogEntries, toCsv, toJson } from './storage';
import { BackgroundToContent, ContentToBackground, BackgroundToContentResult, LogEntry } from './types';

const UI_ATTR = 'data-tma-ui';

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;
let badgeLayer: HTMLDivElement | null = null;
let drawerEl: HTMLDivElement | null = null;
let toastEl: HTMLDivElement | null = null;

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

  drawerEl = document.createElement('div');
  drawerEl.className = 'drawer';
  drawerEl.hidden = true;
  shadow.appendChild(drawerEl);

  toastEl = document.createElement('div');
  toastEl.className = 'toast';
  toastEl.setAttribute('role', 'status');
  toastEl.setAttribute('aria-live', 'polite');
  shadow.appendChild(toastEl);

  return shadow;
}

const SHADOW_CSS = `
  .layer { position: fixed; inset: 0; pointer-events: none; }
  .save-btn {
    position: fixed;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #fe2c55;
    color: #fff;
    border: none;
    border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0,0,0,.28);
    padding: 6px 12px;
    pointer-events: auto;
    font: 600 12px/1.3 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    white-space: nowrap;
  }
  .save-btn:hover { background: #e0264a; }
  .save-btn:disabled { opacity: .6; cursor: default; }
  .save-btn[data-saved="true"] { background: #16130f; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #0f0f0f; color: #fff; padding: 8px 14px; border-radius: 999px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    opacity: 0; transition: opacity .18s ease; pointer-events: none;
    max-width: 320px; text-align: center;
  }
  .toast--on { opacity: .95; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
  .drawer {
    position: fixed; top: 16px; right: 16px; width: 340px; max-height: 70vh;
    background: #fff; color: #0f0f0f; border-radius: 12px;
    box-shadow: 0 10px 30px rgba(0,0,0,.3);
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    pointer-events: auto;
    display: flex; flex-direction: column;
    overflow: hidden;
  }
  .drawer-header { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid rgba(0,0,0,.08); font-weight: 700; }
  .drawer-header button { border: none; background: transparent; font: inherit; cursor: pointer; color: #666; }
  .drawer-list { overflow-y: auto; padding: 8px 14px; flex: 1; }
  .drawer-item { padding: 8px 0; border-bottom: 1px solid rgba(0,0,0,.06); }
  .drawer-item a { color: #fe2c55; text-decoration: none; word-break: break-all; }
  .drawer-empty { color: #888; padding: 16px 0; text-align: center; }
  .drawer-actions { display: flex; gap: 8px; padding: 10px 14px; border-top: 1px solid rgba(0,0,0,.08); }
  .drawer-actions button {
    flex: 1; border: 1px solid rgba(0,0,0,.14); background: #f4f4f5; border-radius: 8px;
    padding: 6px 8px; font: inherit; cursor: pointer;
  }
  .drawer-actions button:hover { background: #e6e8ea; }
`;

let toastTimer: number | undefined;
function toast(message: string): void {
  ui();
  if (!toastEl) return;
  toastEl.textContent = message;
  toastEl.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('toast--on'), 2200);
}

/* ── Save buttons ────────────────────────────────────────────────────── */

interface Badge {
  postTile: PostTile;
  el: HTMLButtonElement;
}

const badges = new Map<HTMLElement, Badge>();

function makeBadge(postTile: PostTile): Badge {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'save-btn';
  el.textContent = 'Save (original)';
  el.setAttribute('aria-label', 'Save this video in original quality');
  el.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleSave(postTile, el);
  });

  badgeLayer!.appendChild(el);
  return { postTile, el };
}

/**
 * The ownership gate (PRD-45 §5), evaluated fresh for every tile on every
 * render pass — never cached across renders, so a multi-account switch
 * mid-session (§7) is re-checked correctly rather than trusting a stale
 * result. Returns false — no button — whenever either handle can't be
 * confidently read. This function is the only place a Save button's
 * existence is decided; nothing else in this file, or anywhere in the
 * extension, can show one.
 */
function isOwnPost(postTile: PostTile): boolean {
  const ownHandle = readOwnHandle(document);
  if (!ownHandle) return false; // no confirmed logged-in handle at all → fail closed

  const authorHandle = readPostAuthorHandle(postTile.tile);
  if (!authorHandle) return false; // author unreadable → fail closed

  return handlesMatch(ownHandle, authorHandle);
}

/** Adds/removes Save buttons for whatever post tiles are currently in the
 *  DOM, re-evaluating the ownership gate for each one, and repositions the
 *  ones that remain. */
function syncBadges(): void {
  ui();
  const tiles = findPostTiles();
  const present = new Map(tiles.map(pt => [pt.tile, pt] as const));

  for (const [tileEl, postTile] of present) {
    const shouldShow = isOwnPost(postTile);
    const existing = badges.get(tileEl);

    if (shouldShow && !existing) {
      badges.set(tileEl, makeBadge(postTile));
    } else if (!shouldShow && existing) {
      existing.el.remove();
      badges.delete(tileEl);
    } else if (shouldShow && existing) {
      existing.postTile = postTile; // keep the anchor/url fresh across re-renders
    }
  }

  for (const [tileEl, badge] of badges) {
    if (!present.has(tileEl) || !document.contains(tileEl)) {
      badge.el.remove();
      badges.delete(tileEl);
    }
  }

  repositionBadges();
}

function repositionBadges(): void {
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;
  for (const { postTile, el } of badges.values()) {
    const rect = postTile.tile.getBoundingClientRect();
    const visible = rect.bottom > 0 && rect.top < viewportH && rect.right > 0 && rect.left < viewportW;
    if (!visible) {
      el.style.display = 'none';
      continue;
    }
    el.style.display = 'inline-flex';
    const top = Math.max(4, rect.bottom - 44);
    const left = Math.min(Math.max(4, rect.right - el.offsetWidth - 12), viewportW - el.offsetWidth - 4);
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

function requestDownload(url: string, filename: string): Promise<BackgroundToContentResult> {
  const message: ContentToBackground = { type: 'TMA_DOWNLOAD', url, filename };
  return chrome.runtime.sendMessage(message);
}

function requestExport(text: string, filename: string, mime: 'text/csv' | 'application/json'): Promise<BackgroundToContentResult> {
  const message: ContentToBackground = { type: 'TMA_EXPORT', text, filename, mime };
  return chrome.runtime.sendMessage(message);
}

async function handleSave(postTile: PostTile, buttonEl: HTMLButtonElement): Promise<void> {
  // Re-run the gate at the moment of the click, not just at render time — a
  // recycled/re-authored tile between render and click must not save.
  if (!isOwnPost(postTile)) {
    toast("Can't save — this post isn't yours.");
    return;
  }

  const authorHandle = readPostAuthorHandle(postTile.tile);
  buttonEl.disabled = true;
  const originalText = buttonEl.textContent;
  buttonEl.textContent = 'Finding source…';

  try {
    const sourceUrl = await waitForVideoSourceUrl(postTile.tile, isUsableMediaUrl);
    if (!sourceUrl) {
      toast("Couldn't find the original video source — try again once playback has started.");
      return;
    }

    const filename = buildFilename(authorHandle, postTile.postId);
    buttonEl.textContent = 'Saving…';
    const result = await requestDownload(sourceUrl, filename);

    if (!result.ok) {
      toast(`Could not save: ${result.error}`);
      return;
    }

    const entry: LogEntry = {
      id: postTile.postId,
      postUrl: postTile.postUrl,
      handle: normalizeHandle(authorHandle) ?? (authorHandle ?? ''),
      postId: postTile.postId,
      filename,
      savedAt: Date.now(),
    };
    await addLogEntry(entry);
    void refreshDrawerIfOpen();

    buttonEl.textContent = 'Saved';
    buttonEl.dataset.saved = 'true';
    toast(`Saved ${filename}`);
  } catch (error) {
    toast(error instanceof Error ? error.message : 'Could not save this video.');
  } finally {
    buttonEl.disabled = false;
    if (buttonEl.dataset.saved !== 'true') buttonEl.textContent = originalText;
  }
}

/* ── Log drawer ──────────────────────────────────────────────────────── */

let drawerOpen = false;

function formatDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

async function renderDrawer(): Promise<void> {
  ui();
  if (!drawerEl) return;

  const entries = await readAllLogEntries();

  drawerEl.innerHTML = '';

  const header = document.createElement('div');
  header.className = 'drawer-header';
  const title = document.createElement('span');
  title.textContent = `Saved videos (${entries.length})`;
  const closeBtn = document.createElement('button');
  closeBtn.type = 'button';
  closeBtn.textContent = '✕';
  closeBtn.setAttribute('aria-label', 'Close saved-videos log');
  closeBtn.addEventListener('click', () => toggleDrawer(false));
  header.append(title, closeBtn);

  const list = document.createElement('div');
  list.className = 'drawer-list';
  if (!entries.length) {
    const empty = document.createElement('div');
    empty.className = 'drawer-empty';
    empty.textContent = 'Nothing saved yet.';
    list.appendChild(empty);
  } else {
    for (const entry of entries) {
      const item = document.createElement('div');
      item.className = 'drawer-item';
      const link = document.createElement('a');
      link.href = entry.postUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = entry.filename;
      const meta = document.createElement('div');
      meta.textContent = `@${entry.handle} · ${formatDate(entry.savedAt)}`;
      item.append(link, meta);
      list.appendChild(item);
    }
  }

  const actions = document.createElement('div');
  actions.className = 'drawer-actions';

  const exportCsvBtn = document.createElement('button');
  exportCsvBtn.type = 'button';
  exportCsvBtn.textContent = 'Export CSV';
  exportCsvBtn.addEventListener('click', () => void exportLog('csv'));

  const exportJsonBtn = document.createElement('button');
  exportJsonBtn.type = 'button';
  exportJsonBtn.textContent = 'Export JSON';
  exportJsonBtn.addEventListener('click', () => void exportLog('json'));

  const clearBtn = document.createElement('button');
  clearBtn.type = 'button';
  clearBtn.textContent = 'Clear all';
  clearBtn.addEventListener('click', () => void clearLog());

  actions.append(exportCsvBtn, exportJsonBtn, clearBtn);

  drawerEl.append(header, list, actions);
}

async function refreshDrawerIfOpen(): Promise<void> {
  if (drawerOpen) await renderDrawer();
}

function toggleDrawer(next?: boolean): void {
  ui();
  drawerOpen = next ?? !drawerOpen;
  if (drawerEl) drawerEl.hidden = !drawerOpen;
  if (drawerOpen) void renderDrawer();
}

async function exportLog(format: 'csv' | 'json'): Promise<void> {
  const entries = await readAllLogEntries();
  const text = format === 'csv' ? toCsv(entries) : toJson(entries);
  const mime: 'text/csv' | 'application/json' = format === 'csv' ? 'text/csv' : 'application/json';
  const result = await requestExport(text, buildExportFilename(format), mime);
  toast(result.ok ? 'Exported' : `Could not export: ${result.error}`);
}

async function clearLog(): Promise<void> {
  await clearAllLogEntries();
  await renderDrawer();
  toast('Log cleared');
}

chrome.runtime.onMessage.addListener((message: BackgroundToContent) => {
  if (message?.type === 'TMA_TOGGLE_LOG') toggleDrawer();
});

/* ── DOM churn: rescan on mutation + a light interval, throttled ───────── */

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(mutation =>
    Array.from(mutation.addedNodes).some(node => {
      if (node.nodeType === Node.TEXT_NODE) return true;
      const el = node as HTMLElement;
      return el.nodeType === Node.ELEMENT_NODE && !el.hasAttribute?.(UI_ATTR);
    })
  );
  if (relevant) scheduleSync(300);
});

let lastPath = location.pathname + location.search;

function watchNavigation(): void {
  window.setInterval(() => {
    const next = location.pathname + location.search;
    if (next === lastPath) return;
    lastPath = next;
    scheduleSync(200);
  }, 700);
}

/* ── Boot ────────────────────────────────────────────────────────────── */

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  syncBadges();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchNavigation();

  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // A slow second pass: TikTok's own byline/nav sometimes finishes hydrating
  // after first paint, so one retry catches a gate that read null too early.
  window.setTimeout(() => void syncBadges(), 1500);

  // Periodically re-evaluate the gate (multi-account switch mid-session,
  // PRD-45 §7) and drop badges for recycled tiles.
  window.setInterval(() => {
    void syncBadges();
  }, 4000);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}

export const __internal = { isOwnPost, syncBadges };
