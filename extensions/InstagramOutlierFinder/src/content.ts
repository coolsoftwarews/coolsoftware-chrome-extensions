/**
 * Content-script entry point. Runs on every instagram.com page but only does
 * work on a profile grid — the surface V1 commits to (PRD §4).
 *
 * No fetch, no XMLHttpRequest anywhere in this file or anything it imports:
 * everything here reads what Instagram already rendered into the tab for the
 * logged-in user (PRD §5) and writes only to chrome.storage.local.
 */

import { clearBadges, renderBadge } from './badges';
import { OverlayBar } from './bar';
import { visibleSet } from './filters';
import { buildFilename, toCsv, toMarkdown } from './formatters';
import { computeProfileStats, scoreAll } from './outlier';
import { scanGrid } from './scan';
import * as dom from './selectors';
import { readFilters, readProfileCache, writeFilters, writeProfileCache } from './storage';
import { track, trackParseFailure } from './metrics';
import { DownloadRequest, DownloadResponse, FilterState, ProfileStats } from './types';

const HIDDEN_CLASS = 'iof-hidden';
const CONSECUTIVE_FAILURE_LIMIT = 3;

let bar: OverlayBar | null = null;
let filters: FilterState = { ratio: 'all', kind: 'all', days: null, sort: 'ratio' };
let observer: MutationObserver | null = null;
let scheduled = false;
let currentHandle: string | null = null;
let lastStats: ProfileStats | null = null;
let consecutiveFailures = 0;
let noticeShown = false;

function isProfilePage(): boolean {
  return dom.isProfilePath(location.pathname);
}

/* ── The scan → score → filter → render pipeline ───────────────────────── */

function apply(): void {
  if (!bar) return;
  const handle = dom.profileHandle(location.pathname);
  if (!handle) return;

  let result: ReturnType<typeof scanGrid>;
  try {
    result = scanGrid();
  } catch {
    result = { posts: [], failed: true };
  }

  if (result.failed) {
    consecutiveFailures++;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT && !noticeShown) {
      noticeShown = true;
      bar.showNotice(
        "Couldn't read post counts on this page — Instagram may have changed something. The grid itself is untouched."
      );
      void trackParseFailure();
    }
    return;
  }
  consecutiveFailures = 0;
  if (result.posts.length === 0) return;

  const stats = computeProfileStats(result.posts);
  lastStats = stats;
  const scored = scoreAll(result.posts, stats);

  const tileByShortcode = new Map<string, HTMLElement>();
  for (const anchor of dom.tileAnchors()) {
    const shortcode = dom.extractShortcode(anchor.getAttribute('href'));
    if (shortcode) tileByShortcode.set(shortcode, anchor);
  }

  for (const post of scored) {
    const tile = tileByShortcode.get(post.id);
    if (tile) renderBadge(tile, post);
  }

  const visible = visibleSet(scored, filters);
  for (const post of scored) {
    const tile = tileByShortcode.get(post.id);
    tile?.classList.toggle(HIDDEN_CLASS, !visible.includes(post));
  }

  bar.setStats(stats);
  bar.setStatus(visible.length, scored.length);

  if (handle !== currentHandle) {
    currentHandle = handle;
    void track('profile_analysed');
  }
  if (stats.reliable) {
    void writeProfileCache({ handle, stats, postCount: result.posts.length, computedAt: Date.now() });
  }
}

function scheduleApply(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    try {
      apply();
    } catch {
      void trackParseFailure();
    }
  });
}

/* ── Filter / sort / export wiring ──────────────────────────────────────── */

function setFilters(next: FilterState): void {
  const previous = filters;
  filters = next;
  bar?.setFilters(next);
  void writeFilters(next);

  if (next.ratio !== previous.ratio || next.kind !== previous.kind || next.days !== previous.days) {
    void track('filter_used');
  }
  if (next.sort !== previous.sort) void track('sort_used');

  scheduleApply();
}

async function exportVisible(format: 'csv' | 'md'): Promise<void> {
  const handle = currentHandle ?? dom.profileHandle(location.pathname) ?? 'profile';
  const { posts: raw } = scanGrid();
  if (raw.length === 0 || !lastStats) {
    bar?.showNotice('Nothing to export yet — scroll to load some posts first.');
    return;
  }

  const scored = scoreAll(raw, lastStats);
  const visible = visibleSet(scored, filters);
  const content = format === 'csv' ? toCsv(visible) : toMarkdown(handle, visible, lastStats);
  const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
  const filename = buildFilename(handle, format === 'csv' ? 'csv' : 'md');

  const request: DownloadRequest = { type: 'IOF_DOWNLOAD', filename, content, mimeType };
  try {
    const response = (await chrome.runtime.sendMessage(request)) as DownloadResponse | undefined;
    if (!response?.ok) throw new Error(response?.error || 'download failed');
    void track(format === 'csv' ? 'export_csv' : 'export_md');
  } catch {
    bar?.showNotice('Could not save the file — try again in a moment.');
  }
}

/* ── Mounting ────────────────────────────────────────────────────────────── */

function mount(): void {
  if (!isProfilePage()) {
    unmount();
    return;
  }

  const container = dom.gridContainer();
  if (!container) return;
  if (bar && container.contains(bar.root)) return;

  const handle = dom.profileHandle(location.pathname);

  if (!bar) {
    bar = new OverlayBar(filters, {
      onChange: setFilters,
      onExport: format => void exportVisible(format),
    });
  }
  bar.setFilters(filters);
  container.prepend(bar.root);

  if (handle) {
    void readProfileCache(handle).then(cached => {
      if (cached && bar) bar.setStats(cached.stats);
    });
  }

  noticeShown = false;
  consecutiveFailures = 0;
  observeGrid(container);
  scheduleApply();
}

function unmount(): void {
  observer?.disconnect();
  observer = null;
  bar?.root.remove();
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(node => node.classList.remove(HIDDEN_CLASS));
  clearBadges(document);
  currentHandle = null;
  lastStats = null;
}

/** PRD §6: recompute on scroll, debounced, no visible jank at 200+ tiles. */
function observeGrid(container: HTMLElement): void {
  observer?.disconnect();
  observer = new MutationObserver(scheduleApply);
  observer.observe(container, { childList: true, subtree: true });
}

/* ── Boot: SPA navigation, since Instagram never reloads the page ─────────── */

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    setTimeout(mount, 150);
  }, 500);

  window.addEventListener('scroll', scheduleApply, { passive: true });
}

async function init(): Promise<void> {
  filters = await readFilters();
  mount();
  watchNavigation();
}

void init();
