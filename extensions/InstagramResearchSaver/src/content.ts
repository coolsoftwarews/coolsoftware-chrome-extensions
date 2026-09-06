/**
 * Runs on instagram.com. Three jobs:
 *   1. offer a "+ Save to Research" action on grid tiles (on hover) and on the
 *      open post/Reel detail view (permalink page or dialog)
 *   2. scrape whatever Instagram has rendered, capture it, and persist it —
 *      save first, note second, per PRD §11's explicit decision
 *   3. confirm the save inline, with an optional note and collection picker,
 *      without navigating away from the post (PRD §7: < 200 ms, no navigation)
 *
 * All UI lives inside one shadow root marked `data-irs-ui`, and nothing here
 * ever mutates Instagram's own DOM — every button is a floating overlay
 * positioned from `getBoundingClientRect()`, never inserted into the page's
 * React tree, which would risk crashing Instagram's own re-renders. Nothing
 * here makes a network request — see PRIVACY.md.
 */

import { buildCapture, postIdFromUrl } from './capture';
import { track } from './metrics';
import { captureThumbnail, handleFromLocation, isPostUrl, scrapePost } from './scrape';
import { readCollections, readPost, savePost } from './storage';
import { Collection, RawCapture, SavedPost } from './types';

/* ── Shadow UI shell ─────────────────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute('data-irs-ui', '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .pill {
    position: fixed;
    display: none;
    align-items: center;
    gap: 4px;
    background: #0a84ff;
    color: #fff;
    border: none;
    border-radius: 999px;
    padding: 6px 12px;
    font: 600 12px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 2px 10px rgba(0,0,0,.35);
    z-index: 2147483647;
  }
  .pill--show { display: flex; }
  .pill:hover { background: #0071e3; }
  .fab {
    position: fixed;
    right: 24px;
    bottom: 24px;
    display: none;
    background: #0a84ff;
    color: #fff;
    border: none;
    border-radius: 999px;
    padding: 12px 18px;
    font: 600 13px/1 -apple-system, "Segoe UI", Roboto, sans-serif;
    cursor: pointer;
    box-shadow: 0 6px 20px rgba(0,0,0,.4);
    z-index: 2147483647;
  }
  .fab--show { display: block; }
  .fab:hover { background: #0071e3; }
  .card {
    position: fixed;
    display: none;
    box-sizing: border-box;
    width: 260px;
    background: #ffffff;
    color: #0f0f0f;
    border: 1px solid rgba(0,0,0,.14);
    border-radius: 12px;
    box-shadow: 0 8px 28px rgba(0,0,0,.28);
    padding: 12px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .card--show { display: block; }
  .card__title { margin: 0 0 8px; font-weight: 700; }
  .card__title--error { color: #b3261e; }
  .card select, .card textarea {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid rgba(0,0,0,.18);
    border-radius: 6px;
    padding: 6px 8px;
    font: inherit;
    margin-bottom: 8px;
    color: #0f0f0f;
    background: #fff;
  }
  .card textarea { resize: vertical; min-height: 46px; }
  .card__row { display: flex; gap: 6px; justify-content: flex-end; }
  .card__btn {
    border: none;
    background: none;
    cursor: pointer;
    border-radius: 6px;
    padding: 5px 10px;
    font: 600 12px/1 inherit;
    color: #0a84ff;
  }
  .card__btn:hover { background: rgba(10,132,255,.1); }
  @media (prefers-reduced-motion: no-preference) {
    .pill, .fab, .card { transition: opacity .12s ease; }
  }
`;

/* ── Grid hover pill ─────────────────────────────────────────────────── */

let pill: HTMLButtonElement | null = null;
let hoveredAnchor: HTMLAnchorElement | null = null;

function ensurePill(): HTMLButtonElement {
  if (pill) return pill;
  pill = document.createElement('button');
  pill.type = 'button';
  pill.className = 'pill';
  pill.textContent = '+ Save to Research';
  pill.addEventListener('mousedown', e => e.preventDefault());
  pill.addEventListener('click', () => {
    if (hoveredAnchor) void handleGridSave(hoveredAnchor);
  });
  ui().appendChild(pill);
  return pill;
}

function positionPill(rect: DOMRect): void {
  const el = ensurePill();
  el.classList.add('pill--show');
  const left = Math.min(Math.max(8, rect.left + 6), window.innerWidth - 176);
  const top = Math.max(8, rect.top + 6);
  el.style.left = `${Math.round(left)}px`;
  el.style.top = `${Math.round(top)}px`;
}

function hidePill(): void {
  pill?.classList.remove('pill--show');
  hoveredAnchor = null;
}

document.addEventListener(
  'mouseover',
  event => {
    const target = event.target as HTMLElement | null;
    if (target?.closest?.('[data-irs-ui]')) return;
    const anchor = target?.closest?.('a[href]') as HTMLAnchorElement | null;
    if (!anchor || !isPostUrl(anchor.getAttribute('href'))) return;
    hoveredAnchor = anchor;
    positionPill(anchor.getBoundingClientRect());
  },
  true
);

document.addEventListener(
  'mouseout',
  event => {
    const related = event.relatedTarget as HTMLElement | null;
    if (related?.closest?.('[data-irs-ui]')) return;
    const anchor = (event.target as HTMLElement | null)?.closest?.('a[href]');
    if (anchor === hoveredAnchor) hidePill();
  },
  true
);

window.addEventListener(
  'scroll',
  () => {
    if (hoveredAnchor) positionPill(hoveredAnchor.getBoundingClientRect());
  },
  { passive: true, capture: true }
);

/* ── Detail-view floating button ─────────────────────────────────────── */

let fab: HTMLButtonElement | null = null;

function ensureFab(): HTMLButtonElement {
  if (fab) return fab;
  fab = document.createElement('button');
  fab.type = 'button';
  fab.className = 'fab';
  fab.textContent = '+ Save to Research';
  fab.addEventListener('click', () => void handleDetailSave());
  ui().appendChild(fab);
  return fab;
}

function detailRoot(): ParentNode | null {
  return (
    document.querySelector('[role="dialog"] article') ||
    document.querySelector('main article') ||
    document.querySelector('article')
  );
}

function isDetailView(): boolean {
  return isPostUrl(location.pathname) || detailRoot() !== null;
}

function syncFab(): void {
  const el = ensureFab();
  el.classList.toggle('fab--show', isDetailView());
}

/* ── Confirmation / error card ───────────────────────────────────────── */

let card: HTMLDivElement | null = null;

function buildCard(): HTMLDivElement {
  const el = document.createElement('div');
  el.className = 'card';
  ui().appendChild(el);
  return el;
}

function closeCard(): void {
  card?.classList.remove('card--show');
}

function showErrorCard(message: string, rect: DOMRect): void {
  if (!card) card = buildCard();
  card.replaceChildren();

  const title = document.createElement('p');
  title.className = 'card__title card__title--error';
  title.textContent = message;
  card.appendChild(title);

  const row = document.createElement('div');
  row.className = 'card__row';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'card__btn';
  close.textContent = 'Close';
  close.addEventListener('click', closeCard);
  row.appendChild(close);
  card.appendChild(row);

  positionCard(rect);
}

function showConfirmationCard(post: SavedPost, collections: Collection[], rect: DOMRect): void {
  if (!card) card = buildCard();
  card.replaceChildren();

  const collectionName = collections.find(c => c.id === post.collectionId)?.name ?? 'your library';

  const title = document.createElement('p');
  title.className = 'card__title';
  title.textContent = `Saved to ${collectionName}`;
  card.appendChild(title);

  const select = document.createElement('select');
  select.setAttribute('aria-label', 'Move to collection');
  for (const collection of collections) {
    const option = document.createElement('option');
    option.value = collection.id;
    option.textContent = collection.name;
    option.selected = collection.id === post.collectionId;
    select.appendChild(option);
  }
  select.addEventListener('change', () => {
    void savePost(post.id, existing => ({ ...(existing ?? post), collectionId: select.value })).then(() => {
      void track('move_collection');
      title.textContent = `Saved to ${collections.find(c => c.id === select.value)?.name ?? 'your library'}`;
    });
  });
  card.appendChild(select);

  const note = document.createElement('textarea');
  note.placeholder = 'Note (optional) — why did you save this?';
  note.setAttribute('aria-label', 'Note on this saved post');
  note.value = post.note;
  note.addEventListener('blur', () => {
    if (note.value === post.note) return;
    void savePost(post.id, existing => ({ ...(existing ?? post), note: note.value })).then(() => {
      if (note.value.trim()) void track('note_saved');
    });
  });
  card.appendChild(note);

  const row = document.createElement('div');
  row.className = 'card__row';

  const library = document.createElement('button');
  library.type = 'button';
  library.className = 'card__btn';
  library.textContent = 'Open library';
  library.addEventListener('click', () => {
    void chrome.runtime.sendMessage({ type: 'IRS_OPEN_PANEL' }).catch(() => undefined);
    closeCard();
  });
  row.appendChild(library);

  const done = document.createElement('button');
  done.type = 'button';
  done.className = 'card__btn';
  done.textContent = 'Done';
  done.addEventListener('click', closeCard);
  row.appendChild(done);

  card.appendChild(row);
  positionCard(rect);
}

function positionCard(rect: DOMRect): void {
  if (!card) return;
  card.classList.add('card--show');
  const width = 260;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const top = Math.min(rect.bottom + 8, window.innerHeight - 8);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    closeCard();
    hidePill();
  }
});

/* ── Saving ──────────────────────────────────────────────────────────── */

let collectionsCache: Collection[] | null = null;

async function ensureCollections(): Promise<Collection[]> {
  if (!collectionsCache) collectionsCache = await readCollections();
  return collectionsCache;
}

async function performSave(raw: Omit<RawCapture, 'thumbnailDataUri' | 'thumbnailRemoteUrl'>, thumbnailEl: HTMLImageElement | HTMLVideoElement | null, rect: DOMRect): Promise<void> {
  void track('save_button_clicked');
  try {
    const collections = await ensureCollections();
    const defaultCollectionId = collections[0]?.id ?? 'hooks';
    const { dataUri, remoteUrl } = await captureThumbnail(thumbnailEl);
    void track(dataUri ? 'thumbnail_captured' : 'thumbnail_fallback_remote');

    const fullRaw: RawCapture = { ...raw, thumbnailDataUri: dataUri, thumbnailRemoteUrl: remoteUrl };
    const id = postIdFromUrl(fullRaw.postUrl);
    const existed = (await readPost(id)) !== null;
    const post = await savePost(id, prev => buildCapture(fullRaw, prev, defaultCollectionId));
    void track(existed ? 'save_updated' : 'save_created');
    showConfirmationCard(post, collections, rect);
  } catch (error: any) {
    showErrorCard(error?.message || 'Could not save this post — try again.', rect);
  }
}

async function handleGridSave(anchor: HTMLAnchorElement): Promise<void> {
  const href = anchor.getAttribute('href') || '';
  const postUrl = new URL(href, location.href).toString();
  const container = anchor.closest('article, li, div[role="button"]') || anchor;
  const scraped = scrapePost(container, postUrl, handleFromLocation(location.pathname));
  const rect = anchor.getBoundingClientRect();
  hidePill();
  await performSave(scraped, scraped.thumbnailEl, rect);
}

async function handleDetailSave(): Promise<void> {
  const root = detailRoot();
  if (!root) return;
  const scraped = scrapePost(root, location.href, handleFromLocation(location.pathname));
  const rect = ensureFab().getBoundingClientRect();
  await performSave(scraped, scraped.thumbnailEl, rect);
}

/* ── SPA navigation / late content ───────────────────────────────────── */

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) {
      syncFab();
      return;
    }
    last = location.href;
    closeCard();
    hidePill();
    syncFab();
  }, 500);
}

const observer = new MutationObserver(() => syncFab());

/* ── Boot ────────────────────────────────────────────────────────────── */

if (window.top === window) {
  syncFab();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchNavigation();
}
