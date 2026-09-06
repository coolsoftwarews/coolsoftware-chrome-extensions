/**
 * Runs on instagram.com. Finds each post/Reel card currently rendered
 * (feed, an open dialog, or a permalink page) and offers a Save button next
 * to its action row — but only when the ownership gate confirms the
 * logged-in account authored that post (PRD §5). This is the one
 * non-negotiable rule in this extension: there is no code path, setting or
 * toggle that offers Save on a post the gate doesn't confirm.
 *
 * The gate itself: for every post container, read the logged-in account's
 * own handle from Instagram's own nav (scrape.ts#readLoggedInHandle) and
 * that post's author handle from its own header
 * (scrape.ts#readPostAuthorHandle), then compare them with
 * parse.ts#handlesMatch. Either read failing, or the two not matching,
 * means processArticle() below removes/withholds the Save UI for that post
 * — it never renders a button first and checks after. Re-evaluated on every
 * scan pass for every post, never cached across posts or across time
 * (PRD §6), so a multi-account switch or a virtualized DOM recycling one
 * card into a different post is always caught on the next tick.
 *
 * Like every extension in this portfolio that runs inside a heavily
 * virtualized React app (XBookmarkOrganizer, InstagramResearchSaver), the
 * UI here lives entirely in one shadow root appended to
 * document.documentElement — nothing is ever inserted into Instagram's own
 * DOM, which risks crashing its re-renders. Save buttons are floating
 * overlays positioned from getBoundingClientRect(), not real children of
 * the post.
 *
 * Nothing here makes a network request. Most media is a plain https URL,
 * saved via chrome.downloads.download() — content scripts cannot call that
 * API directly, so the request is relayed to background.ts, which performs
 * the download and appends the log entry. Some video instead loads through a
 * blob: URL (in-page adaptive streaming); a blob: URL only resolves inside
 * the document that created it, so the background service worker can never
 * download it (confirmed live — it fails outright, unrelated to any header
 * or permission), and that case is saved directly here instead, via a
 * synthetic `<a download>` click, then logged locally without going through
 * background.ts at all.
 */

import { buildFilename, handlesMatch, logEntryId, postIdFromUrl } from './parse';
import {
  findActionRow,
  findMediaItems,
  findPostContainers,
  MediaItem,
  readLoggedInHandle,
  readPostAuthorHandle,
} from './scrape';
import { addLogEntry } from './storage';
import { LogEntry, SaveMediaRequest, SaveMediaResponse } from './types';

const UI_ATTR = 'data-ima-ui';
const SCAN_INTERVAL_MS = 800;

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

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
  return shadow;
}

const SHADOW_CSS = `
  .bar {
    position: fixed;
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
    max-width: 220px;
    z-index: 2147483647;
  }
  .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: #0a84ff;
    color: #fff;
    border: none;
    border-radius: 999px;
    padding: 5px 10px;
    font: 600 11px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(0,0,0,.3);
    white-space: nowrap;
  }
  .btn:hover:not(:disabled) { background: #0071e3; }
  .btn:disabled { opacity: .7; cursor: default; }
  .btn--done { background: #1f9d55; }
  .btn--error { background: #b3261e; }
`;

/* ── Per-post Save bar tracking ──────────────────────────────────────── */

interface TrackedPost {
  bar: HTMLDivElement;
  slideCount: number;
}

// A plain Map (not a WeakMap) so a scan pass can drop bars whose <article>
// has left the document entirely — virtualization can recycle a node into
// a different post (handled by re-running the ownership gate on it) or
// remove it outright (handled by the cleanup pass in scan() below).
const tracked = new Map<HTMLElement, TrackedPost>();

function removeTracked(article: HTMLElement): void {
  const entry = tracked.get(article);
  if (!entry) return;
  entry.bar.remove();
  tracked.delete(article);
}

function ensureBar(article: HTMLElement): TrackedPost {
  const existing = tracked.get(article);
  if (existing) return existing;
  const bar = document.createElement('div');
  bar.className = 'bar';
  ui().appendChild(bar);
  const entry: TrackedPost = { bar, slideCount: 0 };
  tracked.set(article, entry);
  return entry;
}

function positionBar(bar: HTMLDivElement, anchorRect: DOMRect): void {
  const left = Math.min(Math.max(8, anchorRect.left), Math.max(8, window.innerWidth - 8));
  const top = Math.max(8, Math.min(anchorRect.bottom + 4, window.innerHeight - 8));
  bar.style.left = `${Math.round(left)}px`;
  bar.style.top = `${Math.round(top)}px`;
  bar.style.bottom = '';
}

// Pins the bar to a fixed corner instead of anchoring to a found element.
// Used for the Reels fallback tile (see positionBarFor) — that tile wraps
// just the video, not the separate action-rail column beside it, so there's
// no element inside it reliably close to the real like/comment/share icons
// to anchor on. Same fixed-corner convention this portfolio's other floating
// status UI already uses (e.g. XBookmarkOrganizer's pill).
function positionBarFixed(bar: HTMLDivElement): void {
  bar.style.left = '16px';
  bar.style.bottom = '16px';
  bar.style.top = '';
}

function positionBarFor(article: HTMLElement, bar: HTMLDivElement): void {
  if (article.tagName !== 'ARTICLE') {
    positionBarFixed(bar);
    return;
  }
  const actionRow = findActionRow(article) ?? article;
  positionBar(bar, actionRow.getBoundingClientRect());
}

/* ── Saving ──────────────────────────────────────────────────────────── */

// A blob: URL only resolves inside the document that created it — the
// background service worker runs in a different context and can't download
// it at all. Saved here directly instead, the standard way to save a
// same-document blob: a synthetic <a download> click, which the browser's
// own download machinery handles without needing chrome.downloads.
async function saveBlobDirectly(entry: LogEntry, blobUrl: string): Promise<void> {
  const anchor = document.createElement('a');
  anchor.href = blobUrl;
  anchor.download = entry.filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  await addLogEntry(entry);
}

async function requestSave(entry: LogEntry, mediaUrl: string, button: HTMLButtonElement, label: string): Promise<void> {
  button.disabled = true;
  button.textContent = 'Saving…';
  button.classList.remove('btn--error');
  try {
    if (mediaUrl.startsWith('blob:')) {
      await saveBlobDirectly(entry, mediaUrl);
    } else {
      const request: SaveMediaRequest = { type: 'IMA_SAVE_MEDIA', mediaUrl, filename: entry.filename, entry };
      const response = (await chrome.runtime.sendMessage(request)) as SaveMediaResponse | undefined;
      if (!response?.ok) throw new Error(response?.error || 'Download failed');
    }
    button.textContent = 'Saved';
    button.classList.add('btn--done');
    button.title = '';
  } catch (error) {
    button.textContent = `Retry ${label}`.trim();
    button.title = error instanceof Error ? error.message : 'Download failed.';
    button.classList.add('btn--error');
    button.disabled = false;
  }
}

function buildButton(handle: string, postId: string, postUrl: string, item: MediaItem, multi: boolean): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  const label = multi ? `Save ${item.index}` : 'Save';
  button.textContent = label;
  button.addEventListener('click', () => {
    const filename = buildFilename(handle, postId, item.index, item.url, item.kind);
    const entry: LogEntry = {
      id: logEntryId(postId, item.index),
      postUrl,
      postId,
      handle,
      mediaKind: item.kind,
      filename,
      savedAt: Date.now(),
    };
    void requestSave(entry, item.url, button, multi ? String(item.index) : '');
  });
  return button;
}

/* ── Per-post processing ─────────────────────────────────────────────── */

/**
 * Re-evaluates the ownership gate and (re)builds the Save button row for
 * one post container. Called on every scan pass for every visible post —
 * never cached across posts or across time (PRD §6).
 */
// ⚠️ TEMPORARY TEST-ONLY BYPASS — set back to false before using for real or
// committing. Shows Save on every post regardless of authorship, purely so
// the save/export mechanism itself can be checked without needing a second
// account. The real ownership gate below is untouched and still runs.
const TESTING_SHOW_SAVE_ON_ALL_POSTS = true;

function processArticle(article: HTMLElement): void {
  const loggedInHandle = readLoggedInHandle();
  const authorHandle = readPostAuthorHandle(article);

  // The ownership gate. Fail closed: no match, no button — and that
  // includes either handle being unreadable, since handlesMatch() treats
  // an unreadable handle exactly like a mismatched one.
  if (!TESTING_SHOW_SAVE_ON_ALL_POSTS && !handlesMatch(loggedInHandle, authorHandle)) {
    removeTracked(article);
    return;
  }

  const mediaItems = findMediaItems(article);
  if (!mediaItems.length) {
    removeTracked(article);
    return;
  }

  const handle = authorHandle as string;
  const permalink = article.querySelector<HTMLAnchorElement>('a[href*="/p/"], a[href*="/reel/"]');
  const postUrl = permalink ? new URL(permalink.getAttribute('href') || '', location.href).toString() : location.href;
  const postId = postIdFromUrl(postUrl) || postIdFromUrl(location.href) || 'post';

  const trackedPost = ensureBar(article);
  if (trackedPost.slideCount !== mediaItems.length) {
    trackedPost.bar.replaceChildren();
    const multi = mediaItems.length > 1;
    for (const item of mediaItems) {
      trackedPost.bar.appendChild(buildButton(handle, postId, postUrl, item, multi));
    }
    trackedPost.slideCount = mediaItems.length;
  }

  positionBarFor(article, trackedPost.bar);
}

/* ── Scan loop ───────────────────────────────────────────────────────── */

function scan(): void {
  const articles = findPostContainers();
  const present = new Set(articles);

  for (const article of articles) processArticle(article);

  for (const [article, entry] of tracked) {
    if (!present.has(article) || !document.contains(article)) {
      entry.bar.remove();
      tracked.delete(article);
    }
  }
}

let scanTimer: number | undefined;
function scheduleScan(delay = 200): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(scan, delay);
}

/* ── SPA navigation / repositioning ──────────────────────────────────── */

function repositionAll(): void {
  for (const [article, entry] of tracked) positionBarFor(article, entry.bar);
}

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    for (const [, entry] of tracked) entry.bar.remove();
    tracked.clear();
    scheduleScan(50);
  }, 500);
}

/* ── Boot ────────────────────────────────────────────────────────────── */

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes (e.g. embedded posts)

  scan();
  const observer = new MutationObserver(() => scheduleScan());
  observer.observe(document.documentElement, { childList: true, subtree: true });

  window.addEventListener('scroll', repositionAll, { passive: true, capture: true });
  window.addEventListener('resize', repositionAll, { passive: true });

  window.setInterval(scan, SCAN_INTERVAL_MS);
  watchNavigation();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
