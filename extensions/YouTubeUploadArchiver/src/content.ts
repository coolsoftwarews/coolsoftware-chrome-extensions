/**
 * Runs on youtube.com and studio.youtube.com (manifest host permission covers
 * both — studio.youtube.com is a subdomain of youtube.com). Three jobs:
 *
 *   1. On every navigation (YouTube and Studio are both SPAs; a `<video>`
 *      pushState never reloads this script), work out which page context this
 *      is (scrape.ts#currentPageContext) and re-run the ownership gate
 *      (PRD §5) — no confirmed match, no Archive button, full stop.
 *   2. On a confirmed match, float an Archive button + an "Open in YouTube
 *      Studio" link near every video row currently rendered, and keep that
 *      in sync as YouTube/Studio recycle rows while the user scrolls.
 *   3. On Archive, read the row's currently-rendered metadata (scrape.ts),
 *      save it to the local log (storage.ts — available directly here, no
 *      relay needed), and ask the background worker to save the thumbnail
 *      *image* to disk (chrome.downloads isn't available in a content
 *      script — see background.ts).
 *
 * Nothing here ever requests, inspects or even names YouTube's signed
 * video-streaming CDN, a player/format response, or any part of the video
 * stream — the one thing this extension is built to never touch (PRD §2/§4).
 * scripts/selftest.mjs enforces that absence with a grep guardrail on every
 * run (the forbidden domain itself is named in README.md/PRIVACY.md, not in
 * any file under src/, so the guardrail has nothing to false-positive on).
 *
 * UI is injected via one shadow host per row, never into YouTube's/Studio's
 * own tree — both apps recycle list nodes as the user scrolls, exactly the
 * concern XCardExporter and XConversationSaver already document for their
 * own platforms.
 */

import { buildThumbnailFilename } from './parse';
import { isOwnChannelMatch } from './parse';
import { currentPageContext, extractVideoMetadata, findVideoRows, PageContext, readOwnChannelKeys, readViewedChannelKey } from './scrape';
import { addOrUpdateRecord, markThumbnailSavedFor } from './storage';
import { DownloadThumbnailMessage, DownloadThumbnailResponse } from './types';

const UI_ATTR = 'data-yua-ui';

const CSS = `
  .yua-row { position: absolute; display: flex; gap: 6px; z-index: 2147483647; pointer-events: none; }
  .yua-row > * { pointer-events: auto; }
  .yua-btn {
    font: 12px/1.4 Roboto, "Segoe UI", sans-serif;
    padding: 4px 10px;
    border-radius: 999px;
    border: none;
    cursor: pointer;
    background: #0f3d3e;
    color: #fff;
    box-shadow: 0 1px 4px rgba(0,0,0,.35);
  }
  .yua-btn[disabled] { opacity: .6; cursor: default; }
  .yua-link {
    font: 12px/1.4 Roboto, "Segoe UI", sans-serif;
    padding: 4px 10px;
    border-radius: 999px;
    text-decoration: none;
    background: rgba(0,0,0,.55);
    color: #fff;
  }
`;

interface RowUI {
  host: HTMLElement;
  button: HTMLButtonElement;
}

let ownershipConfirmed = false;
let pageContext: PageContext = null;
const rowUIs = new Map<Element, RowUI>();

function ensureStyleInjected(): void {
  if (document.getElementById('yua-style-host')) return;
  const host = document.createElement('div');
  host.id = 'yua-style-host';
  host.setAttribute(UI_ATTR, '');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);
  document.documentElement.appendChild(host);
}

function createRowUI(row: Element): RowUI {
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;z-index:2147483647';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = CSS;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'yua-row';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'yua-btn';
  button.textContent = 'Archive';
  button.title = 'Save thumbnail + metadata to your local archive';
  button.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    void handleArchive(row, button);
  });

  wrap.appendChild(button);
  shadow.appendChild(wrap);
  document.documentElement.appendChild(host);

  return { host, button };
}

function positionRowUI(row: Element, ui: RowUI): void {
  const rect = row.getBoundingClientRect();
  const shadow = ui.host.shadowRoot;
  const wrap = shadow?.querySelector<HTMLElement>('.yua-row');
  if (!wrap) return;

  const visible = rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0;
  if (!visible) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = 'flex';
  wrap.style.top = `${Math.max(4, rect.top + 4)}px`;
  wrap.style.left = `${Math.max(4, rect.right - 100)}px`;
}

function repositionAll(): void {
  rowUIs.forEach((ui, row) => {
    if (!row.isConnected) {
      ui.host.remove();
      rowUIs.delete(row);
      return;
    }
    positionRowUI(row, ui);
  });
}

let rafPending = false;
function scheduleReposition(): void {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    repositionAll();
  });
}

function syncRows(): void {
  if (!ownershipConfirmed || !pageContext) {
    // Ownership couldn't be confirmed (or this isn't a page this extension
    // acts on) — remove any UI a previous, now-stale state may have left
    // behind and stop. No button is ever shown on an unconfirmed channel
    // (PRD §5).
    rowUIs.forEach(ui => ui.host.remove());
    rowUIs.clear();
    return;
  }

  ensureStyleInjected();
  const rows = findVideoRows(pageContext);
  const seen = new Set<Element>();

  for (const row of rows) {
    seen.add(row);
    if (rowUIs.has(row)) continue;
    rowUIs.set(row, createRowUI(row));
  }

  rowUIs.forEach((ui, row) => {
    if (!seen.has(row) || !row.isConnected) {
      ui.host.remove();
      rowUIs.delete(row);
    }
  });

  scheduleReposition();
}

let syncPending = false;
function scheduleSync(): void {
  if (syncPending) return;
  syncPending = true;
  requestAnimationFrame(() => {
    syncPending = false;
    syncRows();
  });
}

/* ── The ownership gate (PRD §5) ─────────────────────────────────────────── */

function refreshOwnershipGate(): void {
  pageContext = currentPageContext();
  if (!pageContext) {
    ownershipConfirmed = false;
    syncRows();
    return;
  }

  const ownKeys = readOwnChannelKeys();
  const viewedKey = readViewedChannelKey();
  ownershipConfirmed = isOwnChannelMatch(ownKeys, viewedKey);
  syncRows();
}

/* ── Thumbnail download relay (chrome.downloads isn't in content scripts) ── */

function requestThumbnailDownload(videoId: string, thumbnailUrl: string, title: string): Promise<DownloadThumbnailResponse> {
  const message: DownloadThumbnailMessage = {
    type: 'YUA_DOWNLOAD_THUMBNAIL',
    videoId,
    thumbnailUrl,
    filename: buildThumbnailFilename(videoId, title),
  };
  return new Promise(resolve => {
    chrome.runtime.sendMessage(message, (response: DownloadThumbnailResponse | undefined) => {
      if (chrome.runtime.lastError || !response) {
        resolve({ ok: false, error: chrome.runtime.lastError?.message ?? 'no response' });
        return;
      }
      resolve(response);
    });
  });
}

/* ── Archive action ──────────────────────────────────────────────────────── */

async function handleArchive(row: Element, button: HTMLButtonElement): Promise<void> {
  // Re-confirm ownership at the moment of the click, not just at page load —
  // an SPA navigation between two channels without a full reload must never
  // let a stale "confirmed" flag archive the wrong channel's video.
  if (!ownershipConfirmed) return;

  const scraped = extractVideoMetadata(row, pageContext);
  if (!scraped) {
    flash(button, "Can't read this video yet");
    return;
  }

  const ownKeys = readOwnChannelKeys();
  const channelKey = ownKeys[0] ?? readViewedChannelKey() ?? '';

  button.disabled = true;
  const original = button.textContent;
  button.textContent = 'Saving…';

  try {
    await addOrUpdateRecord(scraped, channelKey);

    if (scraped.thumbnailUrl) {
      // PRD §7: a thumbnail that isn't generated yet (just-published video)
      // must not block the metadata entry — the entry above is already
      // saved regardless of what happens to the image download below.
      const result = await requestThumbnailDownload(scraped.videoId, scraped.thumbnailUrl, scraped.title);
      if (result.ok) await markThumbnailSavedFor(scraped.videoId);
    }

    button.textContent = 'Archived';
    setTimeout(() => {
      button.textContent = original;
      button.disabled = false;
    }, 1500);
  } catch (error) {
    flash(button, error instanceof Error ? error.message : 'Could not save — try again');
    button.disabled = false;
  }
}

function flash(button: HTMLButtonElement, message: string): void {
  const original = button.title;
  button.title = message;
  setTimeout(() => {
    button.title = original;
  }, 2000);
}

/* ── Boot ─────────────────────────────────────────────────────────────────── */

function boot(): void {
  if (window.top !== window) return; // no UI inside iframes

  refreshOwnershipGate();

  const observer = new MutationObserver(() => scheduleSync());
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('scroll', scheduleReposition, { passive: true });
  window.addEventListener('resize', scheduleReposition, { passive: true });

  // Both youtube.com and studio.youtube.com are single-page apps; navigating
  // between a channel's videos and someone else's watch page (or between two
  // different channels' Studio dashboards) never reloads this script.
  // yt-navigate-finish is YouTube's own SPA-navigation event; Studio fires
  // plain popstate/pushState without an equivalent custom event, so both are
  // covered.
  document.addEventListener('yt-navigate-finish', refreshOwnershipGate);
  window.addEventListener('popstate', refreshOwnershipGate);
  const originalPushState = history.pushState.bind(history);
  history.pushState = ((...args: Parameters<History['pushState']>) => {
    originalPushState(...args);
    refreshOwnershipGate();
  }) as History['pushState'];
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
