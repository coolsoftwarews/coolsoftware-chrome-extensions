/**
 * Runs on every etsy.com page. Does nothing at all unless the page is a
 * search or category results page with a readable grid of listings — see
 * detect() below and PRD-20 §6: "Failure: strip hides itself; Etsy's page
 * still works."
 *
 * Jobs, in order:
 *   1. read the listings Etsy already rendered (extract.ts)
 *   2. merge them into this query's running, user-paginated sample (storage.ts)
 *   3. compute the niche read (stats.ts) and paint a fixed, non-layout-shifting
 *      strip plus a small badge on every listing card
 *   4. answer the popup's questions and act on its filter/save/export requests
 *
 * All UI lives inside one shadow root, so Etsy's CSS cannot reach it and the
 * strip cannot be mistaken for part of the Etsy page. Nothing here makes a
 * network request — see PRIVACY.md.
 */

import { extractListingsWithCards } from './extract';
import { track, trackQueryAnalyzed } from './metrics';
import { computeDelta, computeStats, aggregateTags, applyFilters, describeDelta } from './stats';
import { buildFilename, toCsvReport, toMarkdownReport } from './formatters';
import { mergeCache, pruneStaleCache, readOptions, readSnapshotRecord, saveSnapshot, writeOptions } from './storage';
import {
  ContentState,
  ContentToBackground,
  DEFAULT_FILTERS,
  Filters,
  Listing,
  NicheStats,
  PageContext,
  PanelToContent,
  SnapshotDelta,
  TagTable,
} from './types';
import { isEtsyHost, parseEtsyUrl } from './url';

/* ── Module state ────────────────────────────────────────────────────── */

let context: PageContext | null = null;
let allListings: Listing[] = [];
let stats: NicheStats | null = null;
let tags: TagTable | null = null;
let filters: Filters = { ...DEFAULT_FILTERS };
let delta: SnapshotDelta | null = null;
let deltaSavedAt: number | null = null;
let lastTrackedQueryKey: string | null = null;
let currentCards: Array<{ card: Element; listing: Listing }> = [];

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'ENF_STATE_CHANGED' }).catch(() => undefined);
}

function buildState(): ContentState {
  const filtered = applyFilters(allListings, filters);
  return {
    supported: context !== null && stats !== null,
    reason:
      context === null
        ? 'Not a search or category results page.'
        : stats === null
          ? 'Could not read listings on this page.'
          : null,
    context,
    stats,
    tags,
    listings: allListings,
    filters,
    filteredCount: filtered.length,
    delta,
  };
}

/* ── UI shell (shadow DOM, fixed — never participates in page flow) ────
   NFR: "strip after results render < 400ms; no layout shift". A fixed,
   viewport-docked bar guarantees the second half regardless of where Etsy's
   grid happens to sit in the DOM this week (PRD-20 §7: "Etsy A/B tests on
   the results layout"). */

const UI_ATTR = 'data-enf-ui';
const BADGE_ATTR = 'data-enf-badge';

let shadow: ShadowRoot | null = null;
let els: {
  bar: HTMLDivElement;
  summary: HTMLDivElement;
  toggleBtn: HTMLButtonElement;
  panel: HTMLDivElement;
  deltaLine: HTMLDivElement;
  filtersForm: HTMLFormElement;
  maxSales: HTMLInputElement;
  minPrice: HTMLInputElement;
  maxPrice: HTMLInputElement;
  shopSelect: HTMLSelectElement;
  organicOnly: HTMLInputElement;
  filterCount: HTMLSpanElement;
  tagsToggle: HTMLButtonElement;
  tagsBody: HTMLDivElement;
  saveBtn: HTMLButtonElement;
  exportCsv: HTMLButtonElement;
  exportMd: HTMLButtonElement;
  toast: HTMLDivElement;
} | null = null;

const SHADOW_CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font: 12px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif; }
  .bar {
    position: fixed; top: 0; left: 0; right: 0; z-index: 2147483647;
    background: #1f1410; color: #f4ede7; padding: 8px 12px;
    display: flex; align-items: center; gap: 10px;
    box-shadow: 0 2px 10px rgba(0,0,0,.25);
  }
  .bar__summary { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar__mark { color: #f2852d; font-weight: 700; margin-right: 4px; }
  button { font: inherit; cursor: pointer; border-radius: 6px; border: 1px solid rgba(255,255,255,.25);
    background: rgba(255,255,255,.08); color: inherit; padding: 5px 9px; white-space: nowrap; }
  button:hover { background: rgba(255,255,255,.18); }
  button:focus-visible { outline: 2px solid #f2852d; outline-offset: 1px; }
  button.primary { background: #f2852d; border-color: #f2852d; color: #1f1410; font-weight: 600; }
  .panel {
    position: fixed; top: 40px; left: 0; right: 0; z-index: 2147483646;
    background: #2a1d17; color: #f4ede7; padding: 12px 14px; max-height: 70vh; overflow: auto;
    box-shadow: 0 6px 18px rgba(0,0,0,.3); display: none;
  }
  .panel--open { display: block; }
  .panel__delta { margin: 0 0 10px; color: #f2c199; }
  .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .field { display: flex; flex-direction: column; gap: 2px; }
  .field span { color: #cbb9ac; font-size: 11px; }
  input, select { font: inherit; padding: 4px 6px; border-radius: 4px; border: 1px solid rgba(255,255,255,.3);
    background: #1f1410; color: inherit; width: 90px; }
  select { width: 160px; }
  label.check { display: inline-flex; align-items: center; gap: 5px; color: #f4ede7; cursor: pointer; }
  .tags { margin-top: 10px; }
  .tags__grid { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
  .chip { background: rgba(255,255,255,.1); border-radius: 999px; padding: 3px 9px; }
  .chip__n { color: #f2852d; font-weight: 600; margin-left: 4px; }
  .muted { color: #cbb9ac; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #1f1410; color: #fff; padding: 8px 14px; border-radius: 999px;
    opacity: 0; transition: opacity .18s ease; pointer-events: none; z-index: 2147483647; max-width: 80vw;
    text-align: center;
  }
  .toast--on { opacity: .96; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

function buildUi(): void {
  if (els) return;
  const root = ui();

  const bar = document.createElement('div');
  bar.className = 'bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Etsy niche read');

  const summary = document.createElement('div');
  summary.className = 'bar__summary';
  const mark = document.createElement('span');
  mark.className = 'bar__mark';
  mark.textContent = 'Niche Finder';
  summary.appendChild(mark);
  const summaryText = document.createElement('span');
  summary.appendChild(summaryText);

  const toggleBtn = document.createElement('button');
  toggleBtn.type = 'button';
  toggleBtn.textContent = 'Details';
  toggleBtn.setAttribute('aria-expanded', 'false');

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'primary';
  saveBtn.textContent = '+ Save niche';

  bar.append(summary, toggleBtn, saveBtn);

  const panel = document.createElement('div');
  panel.className = 'panel';

  const deltaLine = document.createElement('p');
  deltaLine.className = 'panel__delta muted';

  const filtersForm = document.createElement('form');
  filtersForm.setAttribute('aria-label', 'Filter listings');

  const maxSalesField = document.createElement('label');
  maxSalesField.className = 'field';
  const maxSalesLabel = document.createElement('span');
  maxSalesLabel.textContent = 'Max sales';
  const maxSales = document.createElement('input');
  maxSales.type = 'number';
  maxSales.min = '0';
  maxSales.placeholder = 'Any';
  maxSalesField.append(maxSalesLabel, maxSales);

  const minPriceField = document.createElement('label');
  minPriceField.className = 'field';
  const minPriceLabel = document.createElement('span');
  minPriceLabel.textContent = 'Min price';
  const minPrice = document.createElement('input');
  minPrice.type = 'number';
  minPrice.min = '0';
  minPrice.step = '0.01';
  minPrice.placeholder = 'Any';
  minPriceField.append(minPriceLabel, minPrice);

  const maxPriceField = document.createElement('label');
  maxPriceField.className = 'field';
  const maxPriceLabel = document.createElement('span');
  maxPriceLabel.textContent = 'Max price';
  const maxPrice = document.createElement('input');
  maxPrice.type = 'number';
  maxPrice.min = '0';
  maxPrice.step = '0.01';
  maxPrice.placeholder = 'Any';
  maxPriceField.append(maxPriceLabel, maxPrice);

  const shopField = document.createElement('label');
  shopField.className = 'field';
  const shopLabel = document.createElement('span');
  shopLabel.textContent = 'Shop';
  const shopSelect = document.createElement('select');
  shopField.append(shopLabel, shopSelect);

  const organicField = document.createElement('label');
  organicField.className = 'check';
  const organicOnly = document.createElement('input');
  organicOnly.type = 'checkbox';
  organicField.append(organicOnly, document.createTextNode('Organic only'));

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.textContent = 'Reset filters';

  const filterCount = document.createElement('span');
  filterCount.className = 'muted';

  const filterRow = document.createElement('div');
  filterRow.className = 'row';
  filterRow.append(maxSalesField, minPriceField, maxPriceField, shopField, organicField, resetBtn, filterCount);
  filtersForm.appendChild(filterRow);

  const exportRow = document.createElement('div');
  exportRow.className = 'row';
  const exportCsv = document.createElement('button');
  exportCsv.type = 'button';
  exportCsv.textContent = 'Export CSV';
  const exportMd = document.createElement('button');
  exportMd.type = 'button';
  exportMd.textContent = 'Export Markdown';
  exportRow.append(exportCsv, exportMd);

  const tagsToggle = document.createElement('button');
  tagsToggle.type = 'button';
  tagsToggle.textContent = 'Show tag table';
  tagsToggle.setAttribute('aria-expanded', 'false');

  const tagsBody = document.createElement('div');
  tagsBody.className = 'tags';
  tagsBody.hidden = true;

  panel.append(deltaLine, filtersForm, exportRow, tagsToggle, tagsBody);

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  root.append(bar, panel, toast);

  els = {
    bar, summary: summaryText as unknown as HTMLDivElement, toggleBtn, panel, deltaLine: deltaLine as unknown as HTMLDivElement,
    filtersForm, maxSales, minPrice, maxPrice, shopSelect, organicOnly, filterCount,
    tagsToggle, tagsBody, saveBtn, exportCsv, exportMd, toast,
  };

  toggleBtn.addEventListener('click', () => {
    const open = panel.classList.toggle('panel--open');
    toggleBtn.setAttribute('aria-expanded', String(open));
  });
  resetBtn.addEventListener('click', () => {
    filters = { ...DEFAULT_FILTERS };
    syncFilterInputs();
    void applyAndPersistFilters();
  });
  for (const input of [maxSales, minPrice, maxPrice]) {
    input.addEventListener('change', () => void readFiltersFromForm());
  }
  shopSelect.addEventListener('change', () => void readFiltersFromForm());
  organicOnly.addEventListener('change', () => void readFiltersFromForm());
  tagsToggle.addEventListener('click', () => {
    const open = tagsBody.hidden;
    tagsBody.hidden = !open;
    tagsToggle.setAttribute('aria-expanded', String(open));
    tagsToggle.textContent = open ? 'Hide tag table' : 'Show tag table';
    if (open) void track('tag_view_opened');
  });
  saveBtn.addEventListener('click', () => void handleSaveSnapshot());
  exportCsv.addEventListener('click', () => void handleExport('csv'));
  exportMd.addEventListener('click', () => void handleExport('md'));
}

let toastTimer: number | undefined;
function toastMessage(message: string): void {
  if (!els) return;
  els.toast.textContent = message;
  els.toast.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => els?.toast.classList.remove('toast--on'), 3200);
}

function money(currency: string, value: number | null): string {
  if (value === null) return '—';
  return `${currency}${Number.isInteger(value) ? value : value.toFixed(2)}`;
}

function renderSummary(): void {
  if (!els || !stats) return;
  const kind = stats.medianCountKind === 'sales' ? 'sales' : stats.medianCountKind === 'reviews' ? 'reviews' : 'sales/reviews';
  els.summary.textContent =
    `${stats.organicListings} listings · ${stats.distinctShops} shops · median ${stats.medianCount ?? '—'} ${kind} · ` +
    `median price ${money(stats.currency, stats.medianPrice)} · top ${stats.topShops.length} shop${stats.topShops.length === 1 ? '' : 's'} hold ` +
    `${stats.top3Pct === null ? '—' : Math.round(stats.top3Pct)}% · price band ${money(stats.currency, stats.priceBandLow)}–${money(stats.currency, stats.priceBandHigh)} · ` +
    `from ${stats.samplePages} page${stats.samplePages === 1 ? '' : 's'}, ${stats.sampleListings} listings (${stats.adListings} ads excluded)`;
}

function renderDelta(): void {
  if (!els) return;
  if (!delta || deltaSavedAt === null || !stats) {
    els.deltaLine.textContent = 'No saved snapshot for this query yet — "+ Save niche" to track it over time.';
    return;
  }
  els.deltaLine.textContent = describeDelta(delta, deltaSavedAt, stats.medianCountKind);
}

function syncFilterInputs(): void {
  if (!els) return;
  els.maxSales.value = filters.maxSales === null ? '' : String(filters.maxSales);
  els.minPrice.value = filters.minPrice === null ? '' : String(filters.minPrice);
  els.maxPrice.value = filters.maxPrice === null ? '' : String(filters.maxPrice);
  els.organicOnly.checked = filters.organicOnly;
  els.shopSelect.value = filters.shop ?? '';
}

function renderShopOptions(): void {
  if (!els || !stats) return;
  const counts = new Map<string, number>();
  for (const l of allListings) {
    if (l.isAd || !l.shopName) continue;
    counts.set(l.shopName, (counts.get(l.shopName) ?? 0) + 1);
  }
  const shops = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30);
  els.shopSelect.replaceChildren();
  const allOpt = document.createElement('option');
  allOpt.value = '';
  allOpt.textContent = 'All shops';
  els.shopSelect.appendChild(allOpt);
  for (const [shop, count] of shops) {
    const opt = document.createElement('option');
    opt.value = shop;
    opt.textContent = `${shop} (${count})`;
    els.shopSelect.appendChild(opt);
  }
  els.shopSelect.value = filters.shop ?? '';
}

function renderTags(): void {
  if (!els || !tags) return;
  els.tagsBody.replaceChildren();
  const heading = document.createElement('p');
  heading.className = 'muted';
  heading.textContent = `From ${tags.sampleSize} title${tags.sampleSize === 1 ? '' : 's'} — real word counts, never a search-volume estimate.`;
  els.tagsBody.appendChild(heading);
  const grid = document.createElement('div');
  grid.className = 'tags__grid';
  for (const t of tags.tags) {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.textContent = t.tag;
    const n = document.createElement('span');
    n.className = 'chip__n';
    n.textContent = String(t.count);
    chip.appendChild(n);
    grid.appendChild(chip);
  }
  els.tagsBody.appendChild(grid);
}

function renderFilterCount(): void {
  if (!els) return;
  const filtered = applyFilters(allListings, filters);
  els.filterCount.textContent = `${filtered.length} of ${allListings.length} shown`;
}

function renderAll(): void {
  buildUi();
  if (!els) return;
  els.bar.hidden = false;
  els.panel.style.display = '';
  renderSummary();
  renderDelta();
  renderShopOptions();
  renderTags();
  renderFilterCount();
  paintBadges();
}

function teardownStrip(): void {
  shadow?.host.remove();
  shadow = null;
  els = null;
  removeBadges();
}

/* ── Per-listing badges ──────────────────────────────────────────────── */

function removeBadges(): void {
  document.querySelectorAll(`[${BADGE_ATTR}]`).forEach(el => el.remove());
}

function badgeFor(listing: Listing, matchesFilter: boolean): HTMLDivElement {
  const badge = document.createElement('div');
  badge.setAttribute(BADGE_ATTR, '');
  const kind = listing.countKind === 'sales' ? 'sales' : listing.countKind === 'reviews' ? 'reviews' : '';
  const countText = listing.count !== null ? `${listing.count}${kind ? ` ${kind}` : ''}` : '';
  const priceText = `${money(listing.currency, listing.price)}${listing.priceIsRange ? '+' : ''}`;
  badge.style.cssText = [
    'position:absolute', 'top:6px', 'left:6px', 'z-index:2147483000',
    'max-width:88%', 'pointer-events:none',
    'font:11px/1.35 -apple-system,"Segoe UI",Roboto,sans-serif',
    'background:rgba(31,20,16,.88)', 'color:#f4ede7', 'padding:3px 6px', 'border-radius:6px',
    'white-space:nowrap', 'overflow:hidden', 'text-overflow:ellipsis',
    `opacity:${matchesFilter ? '1' : '.35'}`,
  ].join(';');
  badge.textContent = [priceText, countText, listing.shopName].filter(Boolean).join(' · ');
  if (listing.isAd) {
    const adTag = document.createElement('span');
    adTag.textContent = ' Ad';
    adTag.style.cssText = 'color:#f2852d;font-weight:700;margin-left:4px;';
    badge.appendChild(adTag);
  }
  return badge;
}

function paintBadges(): void {
  removeBadges();
  for (const { card, listing } of currentCards) {
    if (!(card instanceof HTMLElement)) continue;
    if (getComputedStyle(card).position === 'static') card.style.position = 'relative';
    const matches = applyFilters([listing], filters).length > 0;
    card.appendChild(badgeFor(listing, matches));
  }
}

/* ── Filters ─────────────────────────────────────────────────────────── */

async function readFiltersFromForm(): Promise<void> {
  if (!els) return;
  filters = {
    maxSales: els.maxSales.value ? Number(els.maxSales.value) : null,
    minPrice: els.minPrice.value ? Number(els.minPrice.value) : null,
    maxPrice: els.maxPrice.value ? Number(els.maxPrice.value) : null,
    shop: els.shopSelect.value || null,
    organicOnly: els.organicOnly.checked,
  };
  await applyAndPersistFilters();
}

async function applyAndPersistFilters(): Promise<void> {
  renderFilterCount();
  paintBadges();
  await writeOptions(filters);
  void track('filters_applied');
  notifyPanel();
}

/* ── Save niche / export ─────────────────────────────────────────────── */

async function refreshDelta(): Promise<void> {
  if (!context) {
    delta = null;
    deltaSavedAt = null;
    return;
  }
  const record = await readSnapshotRecord(context.queryKey);
  const previous = record?.snapshots[record.snapshots.length - 1] ?? null;
  if (!previous || !stats) {
    delta = null;
    deltaSavedAt = null;
    return;
  }
  delta = computeDelta(previous.stats, stats);
  deltaSavedAt = previous.savedAt;
}

async function handleSaveSnapshot(): Promise<void> {
  if (!context || !stats) return;
  const record = await readSnapshotRecord(context.queryKey);
  const previous = record?.snapshots[record.snapshots.length - 1] ?? null;

  await saveSnapshot(context.queryKey, context.query, stats);
  void track('snapshot_saved');

  if (previous) {
    const d = computeDelta(previous.stats, stats);
    toastMessage(`Saved. ${describeDelta(d, previous.savedAt, stats.medianCountKind)}`);
  } else {
    toastMessage('Niche saved. Come back later to see what changed.');
  }
  await refreshDelta();
  renderDelta();
  notifyPanel();
}

async function sendDownload(filename: string, mime: string, content: string): Promise<boolean> {
  const message: ContentToBackground = { type: 'ENF_DOWNLOAD', filename, mime, content };
  try {
    const response = (await chrome.runtime.sendMessage(message)) as { ok: boolean; error?: string } | undefined;
    return Boolean(response?.ok);
  } catch {
    return false;
  }
}

async function handleExport(format: 'csv' | 'md'): Promise<void> {
  if (!context || !stats || !tags) return;
  const filteredListings = applyFilters(allListings, filters);
  const bundle = { stats, listings: filteredListings, tags, filters };
  const content = format === 'csv' ? toCsvReport(bundle) : toMarkdownReport(bundle);
  const mime = format === 'csv' ? 'text/csv' : 'text/markdown';
  const ok = await sendDownload(buildFilename(context.query, format), mime, content);
  toastMessage(ok ? `Saved .${format}` : `Could not save the .${format} file.`);
  void track(format === 'csv' ? 'export_csv' : 'export_md');
}

/* ── Main pipeline ───────────────────────────────────────────────────── */

async function run(): Promise<void> {
  const parsed = parseEtsyUrl(location.href);
  if (parsed.kind === null) {
    context = null;
    teardownStrip();
    return;
  }

  const pairs = extractListingsWithCards(parsed.page);
  // Fewer than 4 cards found means the selectors missed, or this is a
  // results-empty page — either way, hide rather than show wrong numbers.
  if (pairs.length < 4) {
    teardownStrip();
    return;
  }
  currentCards = pairs;

  context = { kind: parsed.kind, query: parsed.query, queryKey: parsed.queryKey, page: parsed.page };
  const merged = await mergeCache(parsed.queryKey, parsed.query, parsed.page, pairs.map(p => p.listing));
  allListings = merged.listings;
  stats = computeStats(allListings, parsed.query, parsed.queryKey, merged.pages.length);
  tags = aggregateTags(allListings);

  if (lastTrackedQueryKey !== parsed.queryKey) {
    filters = await readOptions<Filters>(DEFAULT_FILTERS);
    lastTrackedQueryKey = parsed.queryKey;
    void track('strip_shown');
    void trackQueryAnalyzed(parsed.queryKey);
  }

  await refreshDelta();
  renderAll();
  syncFilterInputs();
  notifyPanel();
}

/* ── SPA-ish navigation (Etsy pagination sometimes updates via pushState) ─ */

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    void run();
  }, 700);
}

/** Debounced re-extraction for lazily-rendered grids (no fetches, purely local DOM). */
let mutationTimer: number | undefined;
const observer = new MutationObserver(() => {
  window.clearTimeout(mutationTimer);
  mutationTimer = window.setTimeout(() => {
    if (!context) return;
    const pairs = extractListingsWithCards(context.page);
    if (pairs.length > currentCards.length) void run();
  }, 500);
});

/* ── Panel messaging ─────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((message: PanelToContent, _sender, sendResponse) => {
  switch (message?.type) {
    case 'ENF_GET_STATE':
      sendResponse(buildState());
      return false;

    case 'ENF_APPLY_FILTERS':
      filters = message.filters;
      void applyAndPersistFilters().then(() => sendResponse(buildState()));
      return true;

    case 'ENF_SAVE_SNAPSHOT':
      void handleSaveSnapshot().then(() => sendResponse(buildState()));
      return true;

    case 'ENF_EXPORT':
      void handleExport(message.format).then(() => sendResponse({ ok: true }));
      return true;

    default:
      return false;
  }
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (isEtsyHost(location.hostname) && window.top === window) {
  void pruneStaleCache().then(() => run());
  observer.observe(document.documentElement, { childList: true, subtree: true });
  watchUrl();
}
