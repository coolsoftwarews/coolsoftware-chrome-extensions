/**
 * Content-script entry point. Runs on every x.com / twitter.com page. Four
 * jobs: scan the timeline into posts, badge each one, apply the filter bar,
 * and (on search pages) sort by velocity. Nothing here makes a network
 * request — see PRIVACY.md. State is per-tab and in memory only; the two
 * things that persist are author medians and filter settings (PRD §4),
 * written through storage.ts.
 */

import { renderBadge } from './badges';
import { buildFilename, toCsv, toDataUrl, toMarkdown } from './export';
import { FilterBar } from './bar';
import { scanPost } from './scan';
import { ANCHOR_SELECTORS, POST_SELECTOR, isSearchPage } from './selectors';
import { readBaselines, readFilters, track, trackFailure, writeBaseline, writeFilters } from './storage';
import { AuthorBaseline, ExportFormat, ExportRequest, FilterSettings, Post, DEFAULT_FILTERS, SortMode, StatusRequest, StatusResponse } from './types';
import { compareByVelocity, deriveMetrics, isThreadContinuation, matchesFilters, updateBaseline } from './velocity';

const HIDDEN_CLASS = 'xvf-hidden';
const DIM_CLASS = 'xvf-dim';
const ORDER_ATTR = 'data-xvf-order';

/** Consecutive empty passes with posts present before we conclude the DOM
 * changed under us and stop trying — the timeline must never break (PRD §6). */
const FAILURE_PASSES_BEFORE_DISABLE = 3;
const MIN_POSTS_FOR_FAILURE_CHECK = 5;

let bar: FilterBar | null = null;
let filters: FilterSettings = { ...DEFAULT_FILTERS };
let observer: MutationObserver | null = null;
let scheduled = false;
let sortMode: SortMode = 'default';
let badgesDisabled = false;
let consecutiveEmptyPasses = 0;
let disabledTracked = false;

let lastScanned: Post[] = [];

/** In-memory cache of author baselines for this tab, keyed by lowercase handle. */
const baselineCache = new Map<string, AuthorBaseline | null>();
const pendingBaselineWrites = new Map<string, AuthorBaseline>();

function isSupportedPage(): boolean {
  return true; // every page on x.com / twitter.com may show a timeline (home, profile, search, a single post's replies)
}

/* ── Baselines ───────────────────────────────────────────────────────── */

async function ensureBaselinesLoaded(handles: string[]): Promise<void> {
  const missing = [...new Set(handles.map(h => h.toLowerCase()))].filter(h => !baselineCache.has(h));
  if (!missing.length) return;
  const loaded = await readBaselines(missing);
  for (const handle of missing) {
    baselineCache.set(handle, loaded.get(handle) ?? null);
  }
  scheduleApply();
}

function scheduleBaselineFlush(): void {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = undefined;
    const writes = [...pendingBaselineWrites.values()];
    pendingBaselineWrites.clear();
    for (const baseline of writes) void writeBaseline(baseline);
  }, 4000);
}
let flushTimer: number | undefined;

/* ── Scan + apply ────────────────────────────────────────────────────── */

function apply(): void {
  if (badgesDisabled && !bar) return;

  const rows = Array.from(document.querySelectorAll<HTMLElement>(POST_SELECTOR));
  const scanned: Array<{ row: HTMLElement; post: Post }> = [];
  const handlesNeeded: string[] = [];
  let previousAuthor: string | null = null;
  let failed = 0;

  for (const row of rows) {
    let raw;
    try {
      raw = scanPost(row);
    } catch {
      raw = null;
    }
    if (!raw) {
      failed += 1;
      continue;
    }

    const key = raw.authorHandle.toLowerCase();
    if (!baselineCache.has(key)) handlesNeeded.push(raw.authorHandle);
    const baseline = baselineCache.get(key) ?? undefined;

    const post = deriveMetrics(raw, baseline ?? undefined);
    scanned.push({ row, post });

    // Roll a fresh sample into the baseline only when the velocity is real —
    // never for "too new" or missing-count posts, which would just add noise.
    if (post.velocityPerHour !== null) {
      const next = updateBaseline(baseline ?? undefined, raw.authorHandle, post.velocityPerHour);
      baselineCache.set(key, next);
      pendingBaselineWrites.set(key, next);
      scheduleBaselineFlush();
    }

    if (!badgesDisabled) {
      const isReply = isThreadContinuation(previousAuthor, raw.authorHandle);
      if (!isReply) {
        try {
          renderBadge(row, post);
          void track('badge_rendered');
        } catch {
          void trackFailure('parse_post');
        }
      }
    }
    previousAuthor = raw.authorHandle;
  }

  trackDomHealth(rows.length, scanned.length, failed);
  if (handlesNeeded.length) void ensureBaselinesLoaded(handlesNeeded);

  lastScanned = scanned.map(s => s.post);

  let shown = 0;
  for (const { row, post } of scanned) {
    const visible = matchesFilters(post, filters);
    if (visible) shown += 1;
    row.classList.toggle(HIDDEN_CLASS, !visible && filters.mode === 'hide');
    row.classList.toggle(DIM_CLASS, !visible && filters.mode === 'dim');
  }

  if (sortMode === 'velocity') applySort(scanned);

  bar?.setStatus(shown, scanned.length);
}

/** If a normal-looking timeline (several posts present) keeps yielding zero
 * scannable posts across several passes, X's markup likely changed under us.
 * Disable badges quietly rather than keep failing loudly (PRD §6). */
function trackDomHealth(rowCount: number, scannedCount: number, failedCount: number): void {
  if (failedCount > 0) void trackFailure('parse_post');

  if (rowCount < MIN_POSTS_FOR_FAILURE_CHECK) {
    consecutiveEmptyPasses = 0;
    return;
  }
  if (scannedCount === 0) {
    consecutiveEmptyPasses += 1;
  } else {
    consecutiveEmptyPasses = 0;
  }

  if (consecutiveEmptyPasses >= FAILURE_PASSES_BEFORE_DISABLE && !badgesDisabled) {
    badgesDisabled = true;
    if (!disabledTracked) {
      disabledTracked = true;
      void trackFailure('dom_layout_changed');
    }
  }
}

/** Reorders matching rows inside their scroll container by velocity. Each
 * row's original index is stamped once so 'default' can always be restored. */
function applySort(scanned: Array<{ row: HTMLElement; post: Post }>): void {
  const containers = new Map<HTMLElement, Array<{ row: HTMLElement; post: Post }>>();
  for (const entry of scanned) {
    const container = entry.row.parentElement;
    if (!container) continue;
    if (!entry.row.hasAttribute(ORDER_ATTR)) {
      entry.row.setAttribute(ORDER_ATTR, String(Array.prototype.indexOf.call(container.children, entry.row)));
    }
    const group = containers.get(container) ?? [];
    group.push(entry);
    containers.set(container, group);
  }

  for (const [container, group] of containers) {
    const sorted = [...group].sort((a, b) => {
      const primary = compareByVelocity(a.post, b.post);
      if (primary !== 0) return primary;
      return originalOrder(a.row) - originalOrder(b.row);
    });
    if (sorted.every((entry, index) => entry.row === group[index].row)) continue;
    const fragment = document.createDocumentFragment();
    for (const entry of sorted) fragment.append(entry.row);
    container.append(fragment);
  }
}

function originalOrder(row: HTMLElement): number {
  return Number(row.getAttribute(ORDER_ATTR) ?? '0');
}

function scheduleApply(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try {
      apply();
    } catch {
      void trackFailure('dom_layout_changed');
    }
  });
}

/* ── Filter state changes ───────────────────────────────────────────── */

function setFilters(next: FilterSettings, metric?: 'filter_set' | 'filter_cleared'): void {
  filters = next;
  bar?.setFilters(next);
  void writeFilters(next);
  if (metric) void track(metric);
  void track(next.mode === 'hide' ? 'mode_hide' : 'mode_dim');
  scheduleApply();
}

/* ── Export ──────────────────────────────────────────────────────────── */

async function exportSet(format: ExportFormat): Promise<void> {
  const matching = lastScanned.filter(post => matchesFilters(post, filters));
  const text = format === 'csv' ? toCsv(matching) : toMarkdown(matching);
  const mime = format === 'csv' ? 'text/csv' : 'text/markdown';
  const filename = buildFilename(isSearchPage(location.pathname) ? 'search' : 'timeline', format);
  const dataUrl = toDataUrl(text, mime);

  const request: ExportRequest = { type: 'XVF_EXPORT', filename, dataUrl };
  await chrome.runtime.sendMessage(request).catch(() => undefined);
  void track(format === 'csv' ? 'export_csv' : 'export_md');
}

/* ── Mounting ────────────────────────────────────────────────────────── */

function anchor(): HTMLElement | null {
  for (const selector of ANCHOR_SELECTORS) {
    const node = document.querySelector<HTMLElement>(selector);
    if (node) return node;
  }
  return null;
}

function mount(): void {
  const host = anchor();
  if (!host) return;
  if (bar && host.contains(bar.root)) {
    bar.setFilters(filters);
    return;
  }

  bar = new FilterBar(
    filters,
    {
      onChange: next => setFilters(next, 'filter_set'),
      onClear: () => setFilters({ ...DEFAULT_FILTERS }, 'filter_cleared'),
      onSortChange: mode => {
        sortMode = mode;
        if (mode === 'velocity') void track('sort_velocity_used');
        scheduleApply();
      },
      onExport: format => void exportSet(format),
    },
    isSearchPage(location.pathname)
  );

  host.prepend(bar.root);
  observeTimeline();
  scheduleApply();
}

function observeTimeline(): void {
  observer?.disconnect();
  observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, { childList: true, subtree: true });
}

/** X is a client-rendered SPA; polling the URL is the most portable way to
 * notice an in-app navigation without depending on an undocumented event. */
function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    consecutiveEmptyPasses = 0;
    bar?.root.remove();
    bar = null;
    setTimeout(mount, 200);
  }, 700);
}

chrome.runtime.onMessage.addListener((message: StatusRequest, _sender, sendResponse) => {
  if (message?.type !== 'XVF_GET_STATUS') return false;
  const response: StatusResponse = {
    onSupportedPage: isSupportedPage(),
    postsSeen: lastScanned.length,
    postsShown: lastScanned.filter(post => matchesFilters(post, filters)).length,
    filters,
  };
  sendResponse(response);
  return false;
});

async function init(): Promise<void> {
  filters = await readFilters();
  mount();
  watchNavigation();
}

void init();
