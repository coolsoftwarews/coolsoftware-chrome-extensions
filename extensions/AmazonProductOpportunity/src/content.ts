/**
 * Runs on Amazon search/category pages only when the page actually renders
 * result cards (`hasSearchResults`) — everywhere else it does nothing, so a
 * product page, the cart or the homepage is untouched (PRD §6: "Amazon's
 * page must never break"). Five jobs:
 *
 *   1. read the rendered listings into a SearchSnapshot (src/extract.ts)
 *   2. compute the category read (src/stats.ts) and mount the summary strip
 *   3. badge each result card with its rating/reviews/price/Prime read
 *   4. apply filters client-side, and flag opportunity candidates
 *   5. own the watchlist (+Watch this search / +Watch a product) and export
 *
 * No network call exists anywhere in this file or anything it imports — the
 * legal posture PRD §5 requires is enforced in code review by scanning src/
 * for network APIs (see scripts/selftest.mjs and README.md).
 */

import { describeProductSnapshotDelta, describeSearchSnapshotDelta } from './deltas';
import { buildFilename, buildResultsCsv, buildResultsMarkdown } from './exporters';
import { buildSnapshot, findCard, findResultsAnchor, hasSearchResults } from './extract';
import { applyFilters, isEmptyFilter } from './filters';
import { track } from './metrics';
import { computeCategoryStats } from './stats';
import {
  addProductSnapshot,
  addSearchSnapshot,
  readOptions,
  readProductWatch,
  readSearchWatch,
  writeOptions,
} from './storage';
import { CategoryStats, EMPTY_FILTERS, FilterState, ListingSnapshot, SearchSnapshot } from './types';

const UI_ATTR = 'data-apo-ui';
const STYLE_ID = 'apo-inline-style';

let snapshot: SearchSnapshot | null = null;
let stats: CategoryStats | null = null;
let filters: FilterState = { ...EMPTY_FILTERS };
let stripHost: HTMLDivElement | null = null;
let shadow: ShadowRoot | null = null;
const analyzedKeys = new Set<string>();

/* ── One-time light-DOM styles for the per-card badges ─────────────────
   Prefixed "apo-" so nothing here can collide with Amazon's own "a-"/"s-"
   class names. Injected once into <head>, never inline per element. */
function injectInlineStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .apo-badge {
      display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
      margin-top: 6px; padding: 4px 8px; border-radius: 6px;
      background: rgba(20, 110, 245, 0.08); border: 1px solid rgba(20, 110, 245, 0.25);
      font: 11px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f1111;
    }
    .apo-badge__watch {
      border: none; background: none; cursor: pointer; padding: 0 2px;
      font-size: 13px; line-height: 1; color: #b8860b;
    }
    .apo-badge__watch[data-watching="true"] { color: #d4a017; }
    [${UI_ATTR}-card="dim"] { opacity: 0.35; }
    [${UI_ATTR}-card="opportunity"] .apo-badge { background: rgba(23, 145, 76, 0.12); border-color: rgba(23, 145, 76, 0.4); }
  `;
  document.head.appendChild(style);
}

/* ── Summary strip (shadow DOM, isolated from Amazon's page CSS) ──────── */

function ensureStrip(): ShadowRoot {
  if (shadow) return shadow;

  const anchor = findResultsAnchor();
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, 'strip');
  if (anchor?.parentElement) {
    anchor.parentElement.insertBefore(host, anchor);
  } else {
    document.body.insertBefore(host, document.body.firstChild);
  }
  stripHost = host;
  shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = STRIP_CSS;
  shadow.appendChild(style);
  return shadow;
}

const STRIP_CSS = `
  :host { all: initial; }
  .bar {
    display: block; box-sizing: border-box; margin: 8px 0 14px;
    padding: 10px 14px; border-radius: 10px;
    background: #f4f8ff; border: 1px solid #cfe0fb;
    font: 13px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif; color: #0f1111;
  }
  * { box-sizing: border-box; }
  .row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
  .mark { font-weight: 700; color: #0d6efd; }
  .muted { color: #565959; }
  .line { margin: 4px 0 0; }
  .actions { margin-top: 8px; }
  button {
    font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid #cfe0fb;
    background: #fff; color: #0f1111; padding: 5px 10px;
  }
  button:hover { background: #eaf1ff; }
  button.primary { background: #0d6efd; border-color: #0d6efd; color: #fff; }
  button.primary:hover { background: #0b5ed7; }
  button.small { padding: 3px 8px; font-size: 12px; }
  .panel { margin-top: 8px; padding: 8px 10px; border: 1px solid #dbe7fb; border-radius: 8px; background: #fff; display: none; }
  .panel--open { display: block; }
  .field { display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
  .field input { font: inherit; padding: 4px 6px; border: 1px solid #cfcfcf; border-radius: 5px; width: 110px; }
  .grid { display: flex; gap: 10px; flex-wrap: wrap; align-items: flex-end; }
  .status { margin-top: 6px; font-size: 12px; color: #565959; min-height: 1.4em; }
  .apply-row { margin-top: 8px; }
  .badge-note { font-size: 11px; color: #565959; }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  children: Array<Node | string> = []
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  Object.assign(node, props);
  for (const child of children) node.append(child);
  return node;
}

function fmt(value: number | null, digits = 0): string {
  return value === null ? '—' : value.toFixed(digits).replace(/\.0+$/, '');
}

function setStatus(root: ShadowRoot, message: string): void {
  const status = root.querySelector<HTMLElement>('.status');
  if (status) status.textContent = message;
}

/* ── Rendering ───────────────────────────────────────────────────────── */

async function renderStrip(): Promise<void> {
  if (!snapshot || !stats) return;
  const root = ensureStrip();
  root.querySelector('.bar')?.remove();

  const s = stats;
  const readLine = el('p', { className: 'line' }, [
    `Category read: ${s.totalListings} results · median ${fmt(s.medianReviews)} reviews · median rating ${fmt(
      s.medianRating,
      1
    )} · ${s.distinctBrands} distinct brands`,
    s.sponsoredExcluded ? el('span', { className: 'muted' }, [` (${s.sponsoredExcluded} sponsored excluded)`]) : '',
  ]);

  const proxyLine = el('p', { className: 'line muted' }, [
    `Moat: ${s.moat} · Rating ceiling: ${s.ratingCeiling.label} (${s.ratingCeiling.underThreshold} of ${s.ratingCeiling.sample} top results under ${s.ratingCeiling.threshold}) · Concentration: ${s.concentration.label}` +
      (s.concentration.topBrand
        ? ` (top: ${s.concentration.topBrand}, ${Math.round((s.concentration.topBrandShare ?? 0) * 100)}%)`
        : ''),
  ]);

  const watch = await readSearchWatch(snapshot.canonicalKey);
  const watchBtn = el('button', {
    className: 'small',
    type: 'button',
    textContent: watch ? 'Update watch' : '+ Watch this search',
  });
  watchBtn.addEventListener('click', () => void onWatchSearch(root));

  const filtersBtn = el('button', { className: 'small', type: 'button', textContent: 'Filters' });
  const exportBtn = el('button', { className: 'small', type: 'button', textContent: 'Export' });
  const filtersPanel = buildFiltersPanel(root);
  const exportPanel = buildExportPanel(root);
  filtersBtn.addEventListener('click', () => filtersPanel.classList.toggle('panel--open'));
  exportBtn.addEventListener('click', () => exportPanel.classList.toggle('panel--open'));

  const actions = el('div', { className: 'row actions' }, [watchBtn, filtersBtn, exportBtn]);

  const deltaLine = watch
    ? el('p', { className: 'line muted' }, [describeSearchDeltaLine(watch)])
    : null;

  const bar = el('div', { className: 'bar' }, [
    el('div', { className: 'row' }, [el('span', { className: 'mark' }, ['Amazon Product Opportunity'])]),
    readLine,
    proxyLine,
    ...(deltaLine ? [deltaLine] : []),
    actions,
    filtersPanel,
    exportPanel,
    el('p', { className: 'status' }, ['']),
  ]);

  root.appendChild(bar);
}

function describeSearchDeltaLine(watch: Awaited<ReturnType<typeof readSearchWatch>>): string {
  if (!watch || watch.snapshots.length < 2) return 'Watching — revisit later to see what changed.';
  const first = watch.snapshots[0];
  const latest = watch.snapshots[watch.snapshots.length - 1];
  return describeSearchSnapshotDelta(first, latest);
}

function buildFiltersPanel(root: ShadowRoot): HTMLDivElement {
  const maxReviews = el('input', { type: 'number', min: '0', placeholder: 'e.g. 200' }) as HTMLInputElement;
  const minRatingGap = el('input', { type: 'number', min: '0', max: '5', step: '0.1', placeholder: 'e.g. 4.3' }) as HTMLInputElement;
  const priceMin = el('input', { type: 'number', min: '0', placeholder: 'min' }) as HTMLInputElement;
  const priceMax = el('input', { type: 'number', min: '0', placeholder: 'max' }) as HTMLInputElement;
  const brand = el('input', { type: 'text', placeholder: 'contains…' }) as HTMLInputElement;

  maxReviews.value = filters.maxReviews === null ? '' : String(filters.maxReviews);
  minRatingGap.value = filters.minRatingGap === null ? '' : String(filters.minRatingGap);
  priceMin.value = filters.priceMin === null ? '' : String(filters.priceMin);
  priceMax.value = filters.priceMax === null ? '' : String(filters.priceMax);
  brand.value = filters.brand ?? '';

  const apply = el('button', { className: 'small primary', type: 'button', textContent: 'Apply' });
  const clear = el('button', { className: 'small', type: 'button', textContent: 'Clear' });

  apply.addEventListener('click', () => {
    filters = {
      maxReviews: maxReviews.value.trim() ? Number(maxReviews.value) : null,
      minRatingGap: minRatingGap.value.trim() ? Number(minRatingGap.value) : null,
      priceMin: priceMin.value.trim() ? Number(priceMin.value) : null,
      priceMax: priceMax.value.trim() ? Number(priceMax.value) : null,
      brand: brand.value.trim() || null,
    };
    void writeOptions(filters);
    void track('filters_applied');
    applyFiltersToCards();
    setStatus(root, isEmptyFilter(filters) ? 'Filters cleared.' : 'Filters applied.');
  });

  clear.addEventListener('click', () => {
    filters = { ...EMPTY_FILTERS };
    maxReviews.value = '';
    minRatingGap.value = '';
    priceMin.value = '';
    priceMax.value = '';
    brand.value = '';
    void writeOptions(filters);
    applyFiltersToCards();
    setStatus(root, 'Filters cleared.');
  });

  return el('div', { className: 'panel' }, [
    el('div', { className: 'grid' }, [
      el('label', { className: 'field' }, ['Max reviews', maxReviews]),
      el('label', { className: 'field' }, ['Min rating gap (below)', minRatingGap]),
      el('label', { className: 'field' }, ['Price min', priceMin]),
      el('label', { className: 'field' }, ['Price max', priceMax]),
      el('label', { className: 'field' }, ['Brand', brand]),
    ]),
    el('div', { className: 'row apply-row' }, [apply, clear]),
    el('p', { className: 'badge-note' }, [
      'Listings that clear both "max reviews" and "min rating gap" are flagged as opportunity candidates on the page.',
    ]),
  ]);
}

function buildExportPanel(root: ShadowRoot): HTMLDivElement {
  const csvBtn = el('button', { className: 'small', type: 'button', textContent: 'Results as CSV' });
  const mdBtn = el('button', { className: 'small', type: 'button', textContent: 'Results as Markdown' });

  csvBtn.addEventListener('click', () => void exportResults('csv', root));
  mdBtn.addEventListener('click', () => void exportResults('md', root));

  return el('div', { className: 'panel' }, [el('div', { className: 'row' }, [csvBtn, mdBtn])]);
}

/**
 * Content scripts cannot call chrome.downloads directly — only extension
 * pages (background, popup) can. The export click here relays the finished
 * file to the service worker, which is the only place in this feature that
 * touches the downloads API.
 */
async function download(content: string, mimeType: string, filename: string): Promise<void> {
  const response = (await chrome.runtime.sendMessage({
    type: 'APO_DOWNLOAD',
    filename,
    content,
    mimeType,
  })) as { ok: boolean; error?: string } | undefined;
  if (!response?.ok) throw new Error(response?.error || 'Could not save the file.');
}

async function exportResults(format: 'csv' | 'md', root: ShadowRoot): Promise<void> {
  if (!snapshot || !stats) return;
  const content = format === 'csv' ? buildResultsCsv(snapshot) : buildResultsMarkdown(snapshot, stats);
  const type = format === 'csv' ? 'text/csv' : 'text/markdown';
  const filename = buildFilename(['amazon-opportunity', snapshot.marketplace, snapshot.query], format);
  try {
    await download(content, type, filename);
    void track(format === 'csv' ? 'export_results_csv' : 'export_results_md');
    setStatus(root, `Saved .${format}`);
  } catch {
    setStatus(root, 'Could not save the file.');
  }
}

async function onWatchSearch(root: ShadowRoot): Promise<void> {
  if (!snapshot || !stats) return;
  const capturedAt = new Date().toISOString();
  const watch = await addSearchSnapshot(
    snapshot.canonicalKey,
    { marketplace: snapshot.marketplace, query: snapshot.query, url: snapshot.url },
    {
      capturedAt,
      resultCount: stats.totalListings,
      medianReviews: stats.medianReviews,
      medianRating: stats.medianRating,
      distinctBrands: stats.distinctBrands,
    }
  );
  void track('watch_search_added');
  setStatus(
    root,
    watch.snapshots.length > 1 ? `Snapshot saved — ${describeSearchDeltaLine(watch)}` : 'Now watching this search.'
  );
  await renderStrip();
}

/* ── Per-card badges ─────────────────────────────────────────────────── */

function badgeText(listing: ListingSnapshot): string {
  const parts: string[] = [];
  parts.push(listing.rating === null ? '—★' : `${listing.rating.toFixed(1)}★`);
  parts.push(listing.reviewCount === null ? '— reviews' : `${listing.reviewCount.toLocaleString()} reviews`);
  if (listing.priceRaw) parts.push(listing.priceRaw);
  if (listing.prime) parts.push('Prime');
  if (listing.sponsored) parts.push('Sponsored');
  return parts.join(' · ');
}

async function renderBadges(): Promise<void> {
  if (!snapshot) return;
  const filtered = applyFilters(snapshot.listings, filters);

  for (const { listing, matches, opportunity } of filtered) {
    const card = findCard(listing.asin);
    if (!card) continue;

    card.setAttribute(`${UI_ATTR}-card`, opportunity ? 'opportunity' : matches ? 'match' : 'dim');

    let badge = card.querySelector<HTMLDivElement>('.apo-badge');
    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'apo-badge';
      const anchor = card.querySelector('.a-section, .s-card-container') ?? card;
      anchor.appendChild(badge);
    }

    const textSpan = badge.querySelector('span.apo-badge__text') ?? document.createElement('span');
    textSpan.className = 'apo-badge__text';
    textSpan.textContent = badgeText(listing);

    let watchBtn = badge.querySelector<HTMLButtonElement>('.apo-badge__watch');
    if (!watchBtn) {
      watchBtn = document.createElement('button');
      watchBtn.type = 'button';
      watchBtn.className = 'apo-badge__watch';
      watchBtn.addEventListener('click', event => {
        event.preventDefault();
        event.stopPropagation();
        void onWatchProduct(listing);
      });
    }
    const existingWatch = await readProductWatch(snapshot!.marketplace, listing.asin);
    watchBtn.textContent = existingWatch ? '★' : '☆';
    watchBtn.title = existingWatch ? 'Watching this product — click to snapshot again' : 'Watch this product';
    watchBtn.dataset.watching = String(Boolean(existingWatch));

    badge.replaceChildren(textSpan, watchBtn);
  }
}

async function onWatchProduct(listing: ListingSnapshot): Promise<void> {
  if (!snapshot) return;
  await addProductSnapshot(
    snapshot.marketplace,
    listing.asin,
    { title: listing.title, url: listing.url ?? snapshot.url },
    {
      capturedAt: new Date().toISOString(),
      price: listing.price,
      rating: listing.rating,
      reviewCount: listing.reviewCount,
      prime: listing.prime,
    }
  );
  void track('watch_product_added');
  await renderBadges();
}

function applyFiltersToCards(): void {
  if (!snapshot) return;
  void renderBadges();
}

/* ── Boot / refresh loop ─────────────────────────────────────────────── */

async function analyze(): Promise<void> {
  if (!hasSearchResults()) return;

  try {
    snapshot = buildSnapshot();
    stats = computeCategoryStats(snapshot.listings);

    injectInlineStyle();
    await renderStrip();
    await renderBadges();
    void track('overlay_rendered');

    const dedupeKey = `${snapshot.canonicalKey}::p${snapshot.page}::${snapshot.listings.length}`;
    if (!analyzedKeys.has(dedupeKey)) {
      analyzedKeys.add(dedupeKey);
      void track('search_analyzed');
    }
  } catch {
    // The overlay disables quietly rather than risk the host page (PRD §6).
    snapshot = null;
    stats = null;
  }
}

let scheduleTimer: number | undefined;
function scheduleAnalyze(delay = 300): void {
  window.clearTimeout(scheduleTimer);
  scheduleTimer = window.setTimeout(() => void analyze(), delay);
}

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(m =>
    Array.from(m.addedNodes).some(node => node.nodeType === Node.ELEMENT_NODE && !(node as Element).hasAttribute?.(UI_ATTR))
  );
  if (relevant) scheduleAnalyze(500);
});

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    shadow = null;
    stripHost?.remove();
    stripHost = null;
    scheduleAnalyze(200);
  }, 700);
}

/* ── Messaging with the popup ───────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'APO_GET_SNAPSHOT') {
    sendResponse({ type: 'APO_SNAPSHOT', snapshot, stats });
    return false;
  }
  return false;
});

if (window.top === window) {
  void (async () => {
    filters = await readOptions(EMPTY_FILTERS);
    scheduleAnalyze(150);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    watchUrl();
    window.addEventListener('load', () => scheduleAnalyze(300));
  })();
}
