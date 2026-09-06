/**
 * Runs on Ad Library results pages. Jobs, in order:
 *   1. find ad cards by their one stable string — "Library ID:" — never a
 *      CSS class, which the Library reshuffles without notice (PRD §5)
 *   2. compute days-running, variant grouping and a badge for each
 *   3. inject the badge + "+ Save ad" button into each card, and one
 *      filter/sort bar for the page
 *   4. save ads straight to chrome.storage.local — no relay needed, content
 *      scripts have their own access to `storage`
 *
 * A parse failure on one card must never break the Library page (PRD §6):
 * every extraction step below degrades to "skip this card" rather than throw.
 * Nothing here makes a network request — see PRIVACY.md.
 */

import { detectFormatFromSignals, extractBodyText, parseAdCardText } from './adparser';
import { applyFilters, sortAds } from './filters';
import { DEFAULT_GROUPING_CAP, groupAds } from './grouping';
import { buildFilename, resultsToCsv, resultsToMarkdown } from './formatters';
import { formatBadge } from './longevity';
import { track } from './metrics';
import { isSaved, saveItem, deleteItem, readItems } from './storage';
import { AdFormat, ComputedAd, DEFAULT_FILTERS, DEFAULT_SORT, FilterState, RawAd, SortKey } from './types';
import { extractDomain, isAdLibraryUrl } from './url';

const UI_ATTR = 'data-faw-ui';
const CARD_ATTR = 'data-faw-card';
const BADGE_CLASS = 'faw-badge';

if (isAdLibraryUrl(location.href)) {
  void boot();
}

async function boot(): Promise<void> {
  injectToolbar();
  scheduleScan(50);
  const observer = new MutationObserver(() => scheduleScan(300));
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('scroll', () => scheduleScan(400), { passive: true });
}

/* ── State ───────────────────────────────────────────────────────────── */

let filters: FilterState = { ...DEFAULT_FILTERS };
let sortKey: SortKey = DEFAULT_SORT;
let lastComputed: ComputedAd[] = [];
let lastCapped = false;

/* ── Finding cards by their one stable string ───────────────────────── */

const LIBRARY_ID_TEXT_RE = /Library ID:?\s*[0-9]{6,}/i;

function countLibraryIds(text: string): number {
  return (text.match(new RegExp(LIBRARY_ID_TEXT_RE.source, 'gi')) || []).length;
}

/**
 * Climbs from each "Library ID:" text node while the ancestor still contains
 * exactly one such string — the smallest element that fully owns one ad's
 * markup, whatever that markup happens to be this week.
 */
function findAdCards(): HTMLElement[] {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: node => (LIBRARY_ID_TEXT_RE.test(node.textContent || '') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });

  const cards = new Set<HTMLElement>();
  let node: Node | null;
  while ((node = walker.nextNode())) {
    let el = node.parentElement;
    let candidate: HTMLElement | null = el;
    while (el && el !== document.body) {
      if (el.hasAttribute(UI_ATTR)) break;
      const count = countLibraryIds(el.textContent || '');
      if (count === 1) {
        candidate = el;
        el = el.parentElement;
      } else {
        break;
      }
    }
    if (candidate) cards.add(candidate);
  }
  return [...cards];
}

/* ── Extracting one ad from its card ────────────────────────────────── */

function resolveOutboundHref(href: string): string {
  try {
    const url = new URL(href, location.href);
    // Meta wraps outbound links through an interstitial redirect; the real
    // destination is the `u` query parameter.
    if (/\/l\.php$/i.test(url.pathname) || url.hostname.endsWith('facebook.com') === false) {
      const wrapped = url.searchParams.get('u');
      if (wrapped) return wrapped;
    }
    return url.toString();
  } catch {
    return href;
  }
}

function findLandingDomain(card: HTMLElement): string {
  const anchors = [...card.querySelectorAll<HTMLAnchorElement>('a[href]')];
  for (const a of anchors) {
    const href = a.getAttribute('href') || '';
    if (!href || href === '#') continue;
    if (/facebook\.com|instagram\.com|fb\.me/i.test(href) && !/\/l\.php/i.test(href)) continue; // internal nav, not the landing page
    const resolved = resolveOutboundHref(href);
    const domain = extractDomain(resolved);
    if (domain) return domain;
  }
  return '';
}

function findAdvertiser(card: HTMLElement): string {
  const heading = card.querySelector('strong, b, h1, h2, h3, h4');
  if (heading?.textContent?.trim()) return heading.textContent.trim();
  const link = [...card.querySelectorAll<HTMLAnchorElement>('a[href]')].find(a => {
    const text = a.textContent?.trim() || '';
    return text.length > 1 && text.length < 80 && !/^https?:\/\//i.test(text);
  });
  return link?.textContent?.trim() || 'Unknown advertiser';
}

function findThumbnail(card: HTMLElement): string | null {
  const img = [...card.querySelectorAll<HTMLImageElement>('img[src]')].find(el => {
    const w = el.naturalWidth || Number(el.getAttribute('width')) || 0;
    const h = el.naturalHeight || Number(el.getAttribute('height')) || 0;
    return w === 0 || h === 0 || (w >= 60 && h >= 60);
  });
  if (img?.src) return img.src;
  const video = card.querySelector<HTMLVideoElement>('video[poster]');
  return video?.getAttribute('poster') || null;
}

function detectFormat(card: HTMLElement): AdFormat {
  const hasVideo = Boolean(card.querySelector('video'));
  const imageCount = [...card.querySelectorAll<HTMLImageElement>('img[src]')].filter(el => {
    const w = el.naturalWidth || Number(el.getAttribute('width')) || 0;
    const h = el.naturalHeight || Number(el.getAttribute('height')) || 0;
    return w >= 60 && h >= 60;
  }).length;
  return detectFormatFromSignals({ hasVideo, imageCount });
}

function readRegionLabel(): string {
  const match = document.body.innerText.match(/Ads?\s+(?:shown|are shown)\s+in\s+([^\n·|]{2,60})/i);
  return match ? match[1].trim() : 'Unknown region — check the Library’s own filters';
}

let cachedRegion: string | null = null;

function extractAd(card: HTMLElement): RawAd | null {
  const text = (card as HTMLElement).innerText || card.textContent || '';
  const parsed = parseAdCardText(text);
  if (!parsed.libraryId) return null; // no reliable identity: skip quietly (PRD §6)

  const libraryUrl = `https://www.facebook.com/ads/library/?id=${parsed.libraryId}`;

  return {
    libraryId: parsed.libraryId,
    advertiser: findAdvertiser(card),
    bodyText: extractBodyText(text),
    landingDomain: findLandingDomain(card),
    startDate: parsed.startDate,
    stopDate: parsed.stopDate,
    status: parsed.status,
    format: detectFormat(card),
    thumbnailUrl: findThumbnail(card),
    libraryUrl,
    region: cachedRegion ?? (cachedRegion = readRegionLabel()),
  };
}

/* ── Scan, group, render ─────────────────────────────────────────────── */

let scanTimer: number | undefined;
function scheduleScan(delay: number): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scan(), delay);
}

async function scan(): Promise<void> {
  const started = performance.now();
  const cards = findAdCards();
  if (!cards.length) return;

  const raws: RawAd[] = [];
  const cardByLibraryId = new Map<string, HTMLElement>();
  let failures = 0;

  for (const card of cards) {
    const ad = extractAd(card);
    if (!ad) {
      failures++;
      continue;
    }
    if (!cardByLibraryId.has(ad.libraryId)) {
      raws.push(ad);
      cardByLibraryId.set(ad.libraryId, card);
    }
  }

  if (failures) void track('parse_failure');
  if (!raws.length) return;

  const result = groupAds(raws, { cap: DEFAULT_GROUPING_CAP });
  lastComputed = result.computed;
  lastCapped = result.capped;

  for (const ad of result.computed) {
    const card = cardByLibraryId.get(ad.libraryId);
    if (card) void renderCard(card, ad);
  }

  updateToolbarSummary(result.groupedCount, result.totalCount, result.capped);
  applyFilterVisibility();

  void track('badges_rendered');
  const elapsed = Math.round(performance.now() - started);
  if (elapsed > 400) console.debug(`[Meta Ad Winner] badge pass took ${elapsed}ms for ${cards.length} cards`);
}

async function renderCard(card: HTMLElement, ad: ComputedAd): Promise<void> {
  card.setAttribute(CARD_ATTR, ad.libraryId);
  card.dataset.fawDays = String(ad.daysRunning);
  card.dataset.fawVariants = String(ad.variantCount);
  card.dataset.fawStatus = ad.status;
  card.dataset.fawFormat = ad.format;

  let badge = card.querySelector<HTMLElement>(`:scope > .${BADGE_CLASS}`);
  if (!badge) {
    badge = document.createElement('div');
    badge.className = BADGE_CLASS;
    badge.style.cssText =
      'all:initial;display:flex;align-items:center;gap:8px;flex-wrap:wrap;' +
      'font:600 12px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif;' +
      'background:#fff7db;color:#5c4300;border:1px solid #e3c766;border-radius:8px;' +
      'padding:4px 8px;margin:6px 0;';
    card.prepend(badge);
  }

  const label = document.createElement('span');
  label.textContent = formatBadge(ad);

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  const already = await isSaved(ad.libraryUrl);
  paintSaveButton(saveButton, already);
  saveButton.addEventListener('click', async event => {
    event.preventDefault();
    event.stopPropagation();
    const nowSaved = saveButton.dataset.fawSaved === '1';
    if (nowSaved) {
      const items = await readItems();
      const match = items.find(item => item.libraryUrl === ad.libraryUrl);
      if (match) await deleteItem(match.id);
      paintSaveButton(saveButton, false);
      void track('ad_unsaved');
    } else {
      await saveItem({
        collectionId: null,
        note: '',
        advertiser: ad.advertiser,
        adText: ad.bodyText,
        landingDomain: ad.landingDomain,
        startDate: ad.startDate,
        daysRunning: ad.daysRunning,
        variantCount: ad.variantCount,
        format: ad.format,
        status: ad.status,
        thumbnailUrl: ad.thumbnailUrl,
        libraryUrl: ad.libraryUrl,
      });
      paintSaveButton(saveButton, true);
      void track('ad_saved');
    }
  });

  badge.replaceChildren(label, saveButton);
}

function paintSaveButton(button: HTMLButtonElement, saved: boolean): void {
  button.dataset.fawSaved = saved ? '1' : '0';
  button.textContent = saved ? 'Saved ✓' : '+ Save ad';
  button.style.cssText =
    'all:initial;cursor:pointer;font:600 11px/1 -apple-system,"Segoe UI",Roboto,sans-serif;' +
    `border-radius:999px;padding:4px 10px;border:1px solid ${saved ? '#2e7d32' : '#5c4300'};` +
    `background:${saved ? '#e6f4ea' : '#ffffff'};color:${saved ? '#2e7d32' : '#5c4300'};`;
}

/* ── Filter / sort toolbar ──────────────────────────────────────────── */

let toolbar: HTMLElement | null = null;
let summaryEl: HTMLElement | null = null;

function injectToolbar(): void {
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;display:block;position:sticky;top:0;z-index:2147483000;';
  document.body.prepend(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = `
    .bar { display:flex; flex-wrap:wrap; align-items:center; gap:10px;
      font:13px/1.4 -apple-system,"Segoe UI",Roboto,sans-serif; background:#111318; color:#fff;
      padding:8px 14px; border-bottom:2px solid #ffd633; }
    .bar strong { color:#ffd633; }
    label { display:flex; align-items:center; gap:4px; }
    select, input[type="number"] { font:inherit; padding:2px 4px; border-radius:4px; border:1px solid #444; background:#1e2027; color:#fff; }
    input[type="number"] { width:56px; }
    button { font:600 12px/1 inherit; padding:5px 10px; border-radius:999px; border:1px solid #ffd633;
      background:#ffd633; color:#111318; cursor:pointer; }
    button.secondary { background:transparent; color:#ffd633; }
    .summary { margin-left:auto; opacity:.85; font-size:12px; }
  `;
  shadow.appendChild(style);

  const bar = document.createElement('div');
  bar.className = 'bar';

  const title = document.createElement('strong');
  title.textContent = 'Meta Ad Winner';

  const minDays = document.createElement('select');
  minDays.innerHTML = ['0', '30', '60', '90'].map(v => `<option value="${v}">${v === '0' ? 'Any length' : `≥ ${v} days`}</option>`).join('');
  minDays.addEventListener('change', () => {
    filters = { ...filters, minDays: Number(minDays.value) };
    void track('filter_used');
    applyFilterVisibility();
  });

  const activeOnly = document.createElement('label');
  const activeOnlyBox = document.createElement('input');
  activeOnlyBox.type = 'checkbox';
  activeOnlyBox.addEventListener('change', () => {
    filters = { ...filters, activeOnly: activeOnlyBox.checked };
    void track('filter_used');
    applyFilterVisibility();
  });
  activeOnly.append(activeOnlyBox, document.createTextNode('Active only'));

  const minVariantsLabel = document.createElement('label');
  const minVariants = document.createElement('input');
  minVariants.type = 'number';
  minVariants.min = '0';
  minVariants.value = '0';
  minVariants.addEventListener('change', () => {
    filters = { ...filters, minVariants: Number(minVariants.value) || 0 };
    void track('filter_used');
    applyFilterVisibility();
  });
  minVariantsLabel.append(document.createTextNode('Min variants'), minVariants);

  const formatSelect = document.createElement('select');
  formatSelect.innerHTML = ['all', 'image', 'video', 'carousel']
    .map(v => `<option value="${v}">${v === 'all' ? 'Any format' : v[0].toUpperCase() + v.slice(1)}</option>`)
    .join('');
  formatSelect.addEventListener('change', () => {
    filters = { ...filters, format: formatSelect.value as FilterState['format'] };
    void track('filter_used');
    applyFilterVisibility();
  });

  const sortSelect = document.createElement('select');
  sortSelect.innerHTML = `
    <option value="days">Sort: days running</option>
    <option value="variants">Sort: variant count</option>
    <option value="start">Sort: start date</option>
  `;
  sortSelect.addEventListener('change', () => {
    sortKey = sortSelect.value as SortKey;
    void track('sort_used');
    applyFilterVisibility();
  });

  const exportCsv = document.createElement('button');
  exportCsv.className = 'secondary';
  exportCsv.textContent = 'Export CSV';
  exportCsv.addEventListener('click', () => void exportResults('csv'));

  const exportMd = document.createElement('button');
  exportMd.className = 'secondary';
  exportMd.textContent = 'Export MD';
  exportMd.addEventListener('click', () => void exportResults('md'));

  summaryEl = document.createElement('span');
  summaryEl.className = 'summary';

  bar.append(title, minDays, activeOnly, minVariantsLabel, formatSelect, sortSelect, exportCsv, exportMd, summaryEl);
  shadow.appendChild(bar);
  toolbar = bar;
}

function updateToolbarSummary(grouped: number, total: number, capped: boolean): void {
  if (!summaryEl) return;
  const region = cachedRegion ?? '';
  const parts = [`${total} ad${total === 1 ? '' : 's'} on this page`, region].filter(Boolean);
  if (capped) parts.push(`grouping limited to the first ${grouped}`);
  summaryEl.textContent = parts.join(' · ');
}

/**
 * Filtering hides non-matching cards; sorting reorders cards that share one
 * parent (the common case for a results grid). Cards under any other parent
 * are left in place rather than risk scrambling a layout we don't control.
 */
function applyFilterVisibility(): void {
  const filtered = new Set(applyFilters(lastComputed, filters).map(ad => ad.libraryId));

  const cards = [...document.querySelectorAll<HTMLElement>(`[${CARD_ATTR}]`)];
  for (const card of cards) {
    const id = card.getAttribute(CARD_ATTR);
    card.style.display = id && filtered.has(id) ? '' : 'none';
  }

  const sorted = sortAds(applyFilters(lastComputed, filters), sortKey);
  const byParent = new Map<Element, HTMLElement[]>();
  for (const ad of sorted) {
    const card = document.querySelector<HTMLElement>(`[${CARD_ATTR}="${CSS.escape(ad.libraryId)}"]`);
    if (!card?.parentElement) continue;
    const list = byParent.get(card.parentElement) ?? [];
    list.push(card);
    byParent.set(card.parentElement, list);
  }
  for (const [parent, orderedCards] of byParent) {
    // Only reorder if this parent's own children are exactly this set of
    // cards (plus non-card chrome) — otherwise leave the DOM alone.
    for (const card of orderedCards) parent.appendChild(card);
  }
}

/* ── Export (relayed to the background page for chrome.downloads) ──── */

async function exportResults(format: 'csv' | 'md'): Promise<void> {
  const visible = sortAds(applyFilters(lastComputed, filters), sortKey);
  const content = format === 'csv' ? resultsToCsv(visible) : resultsToMarkdown(visible, cachedRegion ?? undefined);
  const mime = format === 'csv' ? 'text/csv' : 'text/markdown';
  const filename = buildFilename('meta-ad-winner-results', format);
  await chrome.runtime.sendMessage({ type: 'FAW_DOWNLOAD', filename, mime, content });
  void track(format === 'csv' ? 'export_results_csv' : 'export_results_md');
}
