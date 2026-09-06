import { activeFilterKeys, compareBySort, deriveMetrics, matchesFilters, needsEnrichment } from '../lib/filters';
import { loadFilters, loadUserPresets, saveFilters, saveUserPresets, bumpMetric } from '../lib/storage';
import { EMPTY_FILTERS, type EnrichedResult, type FilterState, type MetricKey, type Preset } from '../types';
import { clearBadges, renderBadges } from './badges';
import { FilterBar } from './bar';
import { cachedStats, enrichChannels } from './enrich';
import { scanRow } from './scan';
import { ANCHOR_SELECTORS, RESULT_CONTAINER_SELECTOR, RESULT_SELECTOR } from './selectors';

/**
 * Content-script entry point. Runs on every youtube.com page but only does
 * work on /results — the surface V1 commits to (§11).
 */

const HIDDEN_CLASS = 'ypf-hidden';
const ORDER_ATTR = 'data-ypf-order';

let bar: FilterBar | null = null;
let filters: FilterState = { ...EMPTY_FILTERS };
let userPresets: Preset[] = [];
let observer: MutationObserver | null = null;
let rescheduled = false;
/** Serialised filter state that last produced zero matches, to dedupe the counter. */
let lastEmptyKey: string | null = null;

function isSearchPage(): boolean {
  return location.pathname === '/results';
}

/* ── Apply ────────────────────────────────────────────────────────────── */

/**
 * The whole pipeline: scan every result row, derive metrics, hide the
 * non-matches, reorder the matches, redraw badges, kick off enrichment.
 * Idempotent — safe to run on every mutation.
 */
function apply(): void {
  if (!bar || !isSearchPage()) return;

  const now = Date.now();
  const rows = Array.from(document.querySelectorAll<HTMLElement>(RESULT_SELECTOR));
  const scanned: Array<{ row: HTMLElement; result: EnrichedResult }> = [];
  const channels: Array<{ channelKey: string; channelUrl: string }> = [];
  let pendingChannels = 0;

  for (const row of rows) {
    const data = scanRow(row, now);
    if (!data) continue;

    const stats = data.channelKey ? cachedStats(data.channelKey) : null;
    const result = deriveMetrics(data, stats?.subscribers ?? null, stats?.medianViews ?? null, now);
    scanned.push({ row, result });

    if (data.channelKey && data.channelUrl) {
      if (!stats) pendingChannels += 1;
      channels.push({ channelKey: data.channelKey, channelUrl: data.channelUrl });
    }
  }

  let shown = 0;
  for (const { row, result } of scanned) {
    const visible = matchesFilters(result, filters, now);
    row.classList.toggle(HIDDEN_CLASS, !visible);
    if (visible) shown += 1;
    renderBadges(row, result);
  }

  applySort(scanned);

  // Unresolved channels are only worth reporting when a channel-derived bound
  // or sort is in play — otherwise they affect nothing the user is waiting on.
  bar.setStatus(shown, scanned.length, needsEnrichment(filters) ? pendingChannels : 0);

  // Counted once per distinct filter state, not once per scroll mutation.
  const emptyKey = shown === 0 && scanned.length > 0 ? JSON.stringify(filters) : null;
  if (emptyKey && emptyKey !== lastEmptyKey) void bumpMetric('search.emptyResult');
  lastEmptyKey = emptyKey;

  // Enrichment runs regardless: the outlier badge wants channel medians even
  // when no channel-based filter is set.
  enrichChannels(channels, scheduleApply);
}

/**
 * Reorders matching rows inside their container. Each row's original index is
 * stamped once so 'YouTube's order' can always be restored exactly, and so a
 * stable sort has a deterministic tiebreak.
 */
function applySort(scanned: Array<{ row: HTMLElement; result: EnrichedResult }>): void {
  const containers = new Map<HTMLElement, Array<{ row: HTMLElement; result: EnrichedResult }>>();

  for (const entry of scanned) {
    const container = entry.row.parentElement;
    if (!container) continue;
    if (!entry.row.hasAttribute(ORDER_ATTR)) {
      entry.row.setAttribute(ORDER_ATTR, String(indexIn(container, entry.row)));
    }
    const group = containers.get(container) ?? [];
    group.push(entry);
    containers.set(container, group);
  }

  for (const [container, group] of containers) {
    const sorted = [...group].sort((a, b) => {
      const primary = compareBySort(a.result, b.result, filters.sort);
      if (primary !== 0) return primary;
      return originalOrder(a.row) - originalOrder(b.row);
    });

    // Only touch the DOM when the order actually changed — reappending nodes
    // on every mutation would restart thumbnail animations and fight scroll.
    if (sorted.every((entry, index) => entry.row === group[index].row)) continue;
    const fragment = document.createDocumentFragment();
    for (const entry of sorted) fragment.append(entry.row);
    container.append(fragment);
  }
}

function indexIn(container: HTMLElement, row: HTMLElement): number {
  return Array.prototype.indexOf.call(container.children, row);
}

function originalOrder(row: HTMLElement): number {
  return Number(row.getAttribute(ORDER_ATTR) ?? '0');
}

/** Coalesces bursts of mutations (infinite scroll appends dozens) into one pass. */
function scheduleApply(): void {
  if (rescheduled) return;
  rescheduled = true;
  requestAnimationFrame(() => {
    rescheduled = false;
    try {
      apply();
    } catch {
      // A selector change must never take YouTube search down with it.
      void bumpMetric('selectors.miss');
    }
  });
}

/* ── State changes ────────────────────────────────────────────────────── */

function setFilters(next: FilterState, metric?: MetricKey): void {
  const previousSort = filters.sort;
  filters = next;
  bar?.setFilters(next);
  void saveFilters(next);
  if (metric) void bumpMetric(metric);
  if (next.sort !== previousSort) void bumpMetric('sort.changed');
  // Counted here rather than in apply(): apply() runs on every scroll
  // mutation, which would inflate the count by an order of magnitude.
  if (activeFilterKeys(next).length > 0) void bumpMetric('search.filtered');
  scheduleApply();
}

/** Maps an edit to the counter it belongs to, so §8's per-type breakdown works. */
function metricForChange(before: FilterState, after: FilterState): MetricKey | undefined {
  const added = activeFilterKeys(after).filter((key) => !activeFilterKeys(before).includes(key));
  const first = added[0];
  return first ? (`filter.${first}` as MetricKey) : undefined;
}

/* ── Mounting ─────────────────────────────────────────────────────────── */

function anchor(): HTMLElement | null {
  for (const selector of ANCHOR_SELECTORS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
  }
  return null;
}

function mount(): void {
  if (!isSearchPage()) {
    unmount();
    return;
  }

  const host = anchor();
  if (!host) return;
  if (bar && host.contains(bar.root)) return;

  if (!bar) {
    bar = new FilterBar({
      onChange: (next) => setFilters(next, metricForChange(filters, next)),
      onClear: () => setFilters({ ...EMPTY_FILTERS }, 'filters.cleared'),
      onPresetUsed: (preset) => setFilters({ ...preset.filters }, 'preset.used'),
      onSavePreset: (name) => void savePreset(name),
      onDeletePreset: (id) => void deletePreset(id),
    });
    bar.setUserPresets(userPresets);
    bar.setFilters(filters);
  }

  host.prepend(bar.root);
  observeResults();
  scheduleApply();
}

function unmount(): void {
  observer?.disconnect();
  observer = null;
  bar?.root.remove();
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach((node) => node.classList.remove(HIDDEN_CLASS));
  clearBadges(document);
}

/** Watches the results container so infinite scroll re-filters automatically (§6). */
function observeResults(): void {
  observer?.disconnect();
  const target = document.querySelector(RESULT_CONTAINER_SELECTOR) ?? document.body;
  observer = new MutationObserver(scheduleApply);
  observer.observe(target, { childList: true, subtree: true });
}

async function savePreset(name: string): Promise<void> {
  const preset: Preset = {
    id: `user-${Date.now().toString(36)}`,
    name,
    builtIn: false,
    filters: { ...filters },
  };
  userPresets = [...userPresets, preset];
  await saveUserPresets(userPresets);
  bar?.setUserPresets(userPresets);
}

async function deletePreset(id: string): Promise<void> {
  userPresets = userPresets.filter((preset) => preset.id !== id);
  await saveUserPresets(userPresets);
  bar?.setUserPresets(userPresets);
}

async function init(): Promise<void> {
  [filters, userPresets] = await Promise.all([loadFilters(), loadUserPresets()]);
  mount();
}

// YouTube is a SPA: this fires on every in-app navigation, including the one
// from the homepage into a search (§6).
window.addEventListener('yt-navigate-finish', () => {
  // The new page's DOM is attached a tick after the event.
  setTimeout(mount, 0);
});

void init();
