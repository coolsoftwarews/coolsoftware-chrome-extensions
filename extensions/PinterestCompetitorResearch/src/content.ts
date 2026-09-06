/**
 * Runs on Pinterest pages. Two jobs:
 *   1. Inject a "+ Save to research" control on every pin tile in a grid, and
 *      a floating one on a pin's detail page.
 *   2. On click, scrape what's rendered right now and persist a capture card
 *      straight to chrome.storage.local — no messaging round-trip needed,
 *      since (unlike WebHighlighter) this product's data isn't page-scoped.
 *
 * No network requests, no write actions against Pinterest — this only reads
 * what's already in the DOM (PRD §6/§7).
 *
 * Pinterest's markup is undocumented and changes without notice, so scraping
 * is layered: <meta> tags (stable, present on every pin detail page) first,
 * then DOM heuristics, and every field degrades to an empty string rather
 * than throwing. This file is the DOM-bound half that needs a real browser to
 * verify — see README's manual test checklist, same split as WebHighlighter's
 * anchor.ts / extract.ts.
 */

import { buildCapture, defaultCollections, pinIdFromUrl } from './capture';
import { track } from './metrics';
import { readCollections, savePin } from './storage';
import { captureThumbnail } from './thumbnail';
import { CapturedFrom, RawCapture } from './types';

const BTN_CLASS = 'pcr-save-btn';
const BTN_DONE_CLASS = 'pcr-save-btn--saved';
const BTN_FLOAT_CLASS = 'pcr-save-btn--floating';
const TILE_CLASS = 'pcr-tile';
const PROCESSED_ATTR = 'data-pcr-processed';
const STYLE_ID = 'pcr-styles';
const SAVE_LABEL = '+ Save to research';

/* ── One-time page styles ───────────────────────────────────────────────
 * Scoped by a distinctive class prefix rather than shadow DOM: the grid
 * button has to be positioned relative to a Pinterest-owned tile element, and
 * a shadow host can't do that without also reparenting Pinterest's own node.
 * !important guards against the host page's own rules leaking in. */

function ensureStyles(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .${TILE_CLASS} { position: relative !important; }
    .${BTN_CLASS} {
      all: initial !important;
      position: absolute !important;
      top: 8px !important;
      left: 8px !important;
      z-index: 2147483000 !important;
      display: inline-flex !important;
      align-items: center !important;
      padding: 6px 11px !important;
      border-radius: 999px !important;
      background: rgba(20, 20, 20, 0.85) !important;
      color: #fff !important;
      font: 600 12px/1.2 -apple-system, "Segoe UI", Roboto, sans-serif !important;
      cursor: pointer !important;
      opacity: 0 !important;
      transition: opacity 0.12s ease !important;
      pointer-events: none !important;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.35) !important;
    }
    .${TILE_CLASS}:hover > .${BTN_CLASS},
    .${BTN_CLASS}:focus-visible {
      opacity: 1 !important;
      pointer-events: auto !important;
    }
    .${BTN_CLASS}.${BTN_FLOAT_CLASS} {
      opacity: 1 !important;
      pointer-events: auto !important;
      position: fixed !important;
      top: auto !important;
      left: auto !important;
      bottom: 20px !important;
      right: 20px !important;
      padding: 11px 18px !important;
      font-size: 13px !important;
    }
    .${BTN_CLASS}.${BTN_DONE_CLASS} { background: rgba(16, 124, 16, 0.92) !important; }
    .${BTN_CLASS}[aria-busy="true"] { opacity: 0.6 !important; cursor: default !important; }
    .pcr-toast {
      all: initial !important;
      position: fixed !important;
      left: 50% !important;
      bottom: 24px !important;
      transform: translateX(-50%) !important;
      z-index: 2147483647 !important;
      background: #0f0f0f !important;
      color: #fff !important;
      padding: 8px 14px !important;
      border-radius: 999px !important;
      font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif !important;
      opacity: 0 !important;
      transition: opacity 0.18s ease !important;
      pointer-events: none !important;
    }
    .pcr-toast--on { opacity: 0.95 !important; }
    @media (prefers-reduced-motion: reduce) {
      .${BTN_CLASS}, .pcr-toast { transition: none !important; }
    }
  `;
  document.head.appendChild(style);
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

function toast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'pcr-toast';
    document.body.appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('pcr-toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('pcr-toast--on'), 1800);
}

/* ── Scraping ────────────────────────────────────────────────────────── */

function metaContent(property: string): string {
  const el = document.querySelector(`meta[property="${property}"]`) || document.querySelector(`meta[name="${property}"]`);
  return el?.getAttribute('content')?.trim() ?? '';
}

function textOf(selector: string): string {
  return document.querySelector(selector)?.textContent?.trim() ?? '';
}

function isPinDetailPage(): boolean {
  return /\/pin\/[^/]+\/?$/.test(location.pathname);
}

/** The widest candidate in a srcset, or the currently-rendered src. */
function largestSrc(img: HTMLImageElement): string {
  const srcset = img.getAttribute('srcset');
  if (srcset) {
    const candidates = srcset
      .split(',')
      .map(part => part.trim().split(/\s+/))
      .filter(([url]) => Boolean(url));
    if (candidates.length) {
      candidates.sort((a, b) => (parseInt(b[1] || '0', 10) || 0) - (parseInt(a[1] || '0', 10) || 0));
      return candidates[0][0];
    }
  }
  return img.currentSrc || img.src || '';
}

type ScrapedFields = Omit<RawCapture, 'pinUrl' | 'imageDataUri' | 'imageRemoteUrl' | 'capturedFrom'>;

/** Reads whatever the pin detail page exposes — the only place a full description and destination live (PRD §6). */
function scrapeDetail(): ScrapedFields {
  const title = metaContent('og:title') || document.title.replace(/\s*[|·-].*$/, '').trim();
  const description = metaContent('og:description');

  // A visible "…more" toggle with nothing already expanded means we likely
  // only captured the collapsed text — say so rather than pass off a partial
  // description as complete (PRD §6).
  const hasCollapsedToggle = Array.from(document.querySelectorAll('button, span')).some(el =>
    /^\s*(\.{3}|…)?\s*more\s*$/i.test(el.textContent || '')
  );
  const descriptionTruncated = hasCollapsedToggle && !description;

  // Pinterest labels the outbound link with the bare domain; any http(s) link
  // that doesn't point back at pinterest.* is the destination.
  const destAnchor = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="http"]')).find(a => {
    const href = a.getAttribute('href') || '';
    return href && !/pinterest\.(com|[a-z.]+)\b/i.test(href);
  });

  return {
    titleRaw: title,
    descriptionRaw: description,
    descriptionTruncated,
    destinationDomainRaw: destAnchor?.textContent?.trim() ?? '',
    destinationUrlRaw: destAnchor?.href ?? '',
    boardNameRaw: textOf('[data-test-id="boardName"], a[href*="/board/"]'),
    creatorRaw: textOf('[data-test-id="creatorName"], [data-test-id="username"]'),
    savesRaw: textOf('[data-test-id="saveCount"], [data-test-id="PinAction-Save"] span'),
  };
}

/** Reads whatever a grid tile exposes without opening the pin — usually just an image and a title. */
function scrapeTile(img: HTMLImageElement | null): ScrapedFields {
  const title = img?.getAttribute('alt')?.trim() || img?.closest('a')?.getAttribute('aria-label')?.trim() || '';
  return {
    titleRaw: title,
    // Grid tiles essentially never expose the full description or
    // destination — that's the whole reason PRD §6 treats grid capture as
    // lossy and asks for it to be labelled rather than silently accepted.
    descriptionRaw: '',
    descriptionTruncated: true,
    destinationDomainRaw: '',
    destinationUrlRaw: '',
    boardNameRaw: '',
    creatorRaw: '',
    savesRaw: '',
  };
}

async function buildRawCapture(
  pinUrl: string,
  img: HTMLImageElement | null,
  scraped: ScrapedFields,
  capturedFrom: CapturedFrom
): Promise<RawCapture> {
  const remoteUrl = (img ? largestSrc(img) : '') || metaContent('og:image');
  let dataUri: string | null = null;
  if (img && img.complete && img.naturalWidth > 0) {
    dataUri = captureThumbnail(img);
  }
  void track(dataUri ? 'thumbnail_captured' : 'thumbnail_fallback_remote');

  return { pinUrl, imageDataUri: dataUri, imageRemoteUrl: remoteUrl, capturedFrom, ...scraped };
}

/* ── Save flow ───────────────────────────────────────────────────────── */

async function saveCurrentPin(pinUrl: string, img: HTMLImageElement | null, capturedFrom: CapturedFrom, button: HTMLElement): Promise<void> {
  if (button.getAttribute('aria-busy') === 'true') return;
  button.setAttribute('aria-busy', 'true');
  try {
    const scraped = capturedFrom === 'detail' ? scrapeDetail() : scrapeTile(img);
    const raw = await buildRawCapture(pinUrl, img, scraped, capturedFrom);
    const collections = await readCollections();
    const defaultId = collections[0]?.id ?? defaultCollections()[0].id;
    const id = pinIdFromUrl(pinUrl);

    const pin = await savePin(id, existing => buildCapture(raw, existing, defaultId));
    void track(pin.savedAt === pin.updatedAt ? 'save_created' : 'save_updated');

    const collectionName = collections.find(c => c.id === pin.collectionId)?.name ?? 'research';
    toast(`Saved to ${collectionName}`);
    button.classList.add(BTN_DONE_CLASS);
    button.textContent = 'Saved ✓';
    window.setTimeout(() => {
      button.classList.remove(BTN_DONE_CLASS);
      button.textContent = SAVE_LABEL;
    }, 1600);
  } catch (error: any) {
    toast(error?.message || 'Could not save this pin.');
  } finally {
    button.removeAttribute('aria-busy');
  }
}

/* ── Injection ───────────────────────────────────────────────────────── */

function makeButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = BTN_CLASS;
  button.textContent = SAVE_LABEL;
  button.setAttribute('aria-label', 'Save this pin to research');
  // Keep the page's own click/drag handlers on the tile from firing.
  button.addEventListener('mousedown', event => event.stopPropagation());
  return button;
}

/** Finds a reasonable ancestor to anchor the overlay to — the smallest box that still contains the whole visual card. */
function tileContainerFor(anchor: HTMLAnchorElement): HTMLElement {
  let node: HTMLElement = anchor;
  for (let i = 0; i < 3 && node.parentElement; i++) {
    const parent = node.parentElement;
    if (!parent.querySelector('img')) break;
    node = parent;
  }
  return node;
}

function injectGridButtons(root: ParentNode): void {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/pin/"]'));
  for (const anchor of anchors) {
    if (anchor.hasAttribute(PROCESSED_ATTR)) continue;
    const img = anchor.querySelector('img');
    if (!img) continue; // a text link to a pin, not a visual tile
    anchor.setAttribute(PROCESSED_ATTR, '1');

    const container = tileContainerFor(anchor);
    container.classList.add(TILE_CLASS);

    let pinUrl: string;
    try {
      pinUrl = new URL(anchor.getAttribute('href') || '', location.href).href;
    } catch {
      continue;
    }

    const button = makeButton();
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      void saveCurrentPin(pinUrl, img, 'grid', button);
    });
    container.appendChild(button);
  }
}

let floatingButton: HTMLButtonElement | null = null;

function syncDetailButton(): void {
  if (!isPinDetailPage()) {
    floatingButton?.remove();
    floatingButton = null;
    return;
  }
  if (floatingButton && document.body.contains(floatingButton)) return;

  floatingButton = makeButton();
  floatingButton.classList.add(BTN_FLOAT_CLASS);
  floatingButton.addEventListener('click', () => {
    const img =
      document.querySelector<HTMLImageElement>('[data-test-id="pin-closeup-image"] img') ||
      document.querySelector<HTMLImageElement>('[data-test-id="visual-content-container"] img') ||
      document.querySelector<HTMLImageElement>('img');
    void saveCurrentPin(location.href, img, 'detail', floatingButton!);
  });
  document.body.appendChild(floatingButton);
}

/* ── Scan loop: Pinterest is a virtualized, infinite-scroll SPA ────────── */

let scanScheduled = false;

function scheduleScan(): void {
  if (scanScheduled) return;
  scanScheduled = true;
  window.setTimeout(() => {
    scanScheduled = false;
    ensureStyles();
    injectGridButtons(document);
    syncDetailButton();
  }, 250);
}

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m => m.addedNodes.length > 0);
  if (relevant) scheduleScan();
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    scheduleScan();
  }, 700);
}

function boot(): void {
  ensureStyles();
  injectGridButtons(document);
  syncDetailButton();
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchUrl();
  window.setTimeout(scheduleScan, 1200); // catch content that settles after first paint
}

if (window.top === window) boot();
