/**
 * Content-script entry point. Runs on tiktok.com but only mounts on a
 * profile page (`/@handle`) — the surface PRD-09 §4 commits to. Everything
 * here reads the DOM the browser already rendered; there is no fetch, no
 * XMLHttpRequest, nowhere in this file (README "Hard constraints": foreground
 * only, no extra network requests).
 */

import { renderBadge, setTileVisibility, clearBadges } from './badges';
import { toCsv, toMarkdown, buildFilename } from './export';
import { matchesFilters, sortVideos } from './filters';
import { computeHookInsights } from './hooks';
import { track, trackProfile } from './metrics';
import { computeSnapshot } from './outlier';
import { OutlierPanel } from './panel';
import { scanGrid } from './scan';
import * as dom from './selectors';
import { readFilters, readMedianCache, writeFilters, writeMedianCache } from './storage';
import { DEFAULT_FILTERS, ExportFileRequest, ExportFileResponse, ExportFormat, FilterState, MetricKey, OutlierSnapshot, OutlierVideo } from './types';
import { parseProfileId } from './parse';

let panel: OutlierPanel | null = null;
let filters: FilterState = { ...DEFAULT_FILTERS };
let currentProfileId: string | null = null;
let lastSnapshot: OutlierSnapshot | null = null;
let itemByVideoId = new Map<string, Element>();
let rescheduled = false;
let observer: MutationObserver | null = null;

function isProfilePage(): boolean {
  return /^\/@[^/]+\/?$/.test(location.pathname);
}

function metricForFilterKey(key: keyof FilterState): MetricKey | null {
  switch (key) {
    case 'ratio':
      return 'filter_ratio';
    case 'date':
      return 'filter_date';
    case 'length':
      return 'filter_length';
    case 'sort':
      return 'sort_changed';
    default:
      return null;
  }
}

/* ── Sorting the live grid ──────────────────────────────────────────── */

const ORDER_ATTR = 'data-tco-order';

function indexIn(container: Element, node: Element): number {
  return Array.prototype.indexOf.call(container.children, node);
}

function reorderTiles(order: OutlierVideo[]): void {
  try {
    const container = order.length ? itemByVideoId.get(order[0].id)?.parentElement : null;
    if (!container) return;

    for (const video of order) {
      const item = itemByVideoId.get(video.id);
      if (item && !item.hasAttribute(ORDER_ATTR)) {
        item.setAttribute(ORDER_ATTR, String(indexIn(container, item)));
      }
    }

    const fragment = document.createDocumentFragment();
    for (const video of order) {
      const item = itemByVideoId.get(video.id);
      if (item) fragment.append(item);
    }
    container.append(fragment);
  } catch {
    // A reorder that goes wrong must never take the profile page down with it.
    void track('parse_failure');
  }
}

/* ── The pipeline ────────────────────────────────────────────────────── */

async function apply(): Promise<void> {
  if (!panel || !isProfilePage()) return;

  const { videos, parseFailure } = scanGrid();
  panel.setParseFailure(parseFailure);
  if (parseFailure) void track('parse_failure');
  if (!videos.length) {
    panel.setStatus(0, 0);
    return;
  }

  itemByVideoId = new Map();
  for (const item of dom.POST_ITEM_SELECTORS.flatMap(sel => Array.from(document.querySelectorAll(sel)))) {
    const href = dom.postHref(item);
    const id = href?.match(/\/(?:video|photo)\/(\d+)/)?.[1];
    if (id) itemByVideoId.set(id, item);
  }

  const profileId = parseProfileId(location.pathname) ?? location.pathname;
  if (profileId !== currentProfileId) {
    currentProfileId = profileId;
    void trackProfile(profileId);
  }

  const snapshot = computeSnapshot(profileId, videos);
  lastSnapshot = snapshot;
  panel.setSnapshot(snapshot);

  if (snapshot.median !== null && !snapshot.lowSample) {
    void writeMedianCache({ profileId, median: snapshot.median, sampleSize: snapshot.sampleSize, updatedAt: Date.now() });
  }

  const visible = snapshot.videos.filter(video => matchesFilters(video, filters));
  const sorted = sortVideos(visible, filters.sort);

  const visibleIds = new Set(sorted.map(v => v.id));
  for (const video of snapshot.videos) {
    const item = itemByVideoId.get(video.id);
    if (!item) continue;
    setTileVisibility(item, visibleIds.has(video.id));
    if (visibleIds.has(video.id)) renderBadge(item, video, snapshot.lowSample);
  }

  reorderTiles(sorted);
  panel.setStatus(sorted.length, snapshot.videos.length);
}

function scheduleApply(): void {
  if (rescheduled) return;
  rescheduled = true;
  requestAnimationFrame(() => {
    rescheduled = false;
    void apply();
  });
}

/* ── Filter / hook / export callbacks ───────────────────────────────── */

function setFilters(next: FilterState): void {
  const changedKey = (Object.keys(next) as Array<keyof FilterState>).find(key => next[key] !== filters[key]);
  filters = next;
  panel?.setFilters(next);
  void writeFilters(next);
  const metric = changedKey ? metricForFilterKey(changedKey) : null;
  if (metric) void track(metric);
  scheduleApply();
}

function currentFilteredSorted(): OutlierVideo[] {
  if (!lastSnapshot) return [];
  const visible = lastSnapshot.videos.filter(video => matchesFilters(video, filters));
  return sortVideos(visible, filters.sort);
}

function onHookPanelOpen(): void {
  void track('hook_panel_opened');
  if (!panel) return;
  const filteredSorted = currentFilteredSorted();
  const outliers = filteredSorted.filter(v => v.band === 'fire');
  const baseline = lastSnapshot?.videos ?? [];
  panel.setHookResult(computeHookInsights(outliers, baseline));
}

async function onExport(format: ExportFormat): Promise<void> {
  if (!currentProfileId) return;
  const videos = currentFilteredSorted();
  const content =
    format === 'csv'
      ? toCsv(videos)
      : toMarkdown(currentProfileId, lastSnapshot?.median ?? null, lastSnapshot?.sampleSize ?? 0, videos);
  const filename = buildFilename(currentProfileId, format === 'csv' ? 'csv' : 'md');
  const mimeType = format === 'csv' ? 'text/csv' : 'text/markdown';

  const request: ExportFileRequest = { type: 'TCO_EXPORT_FILE', filename, content, mimeType };
  try {
    await chrome.runtime.sendMessage<ExportFileRequest, ExportFileResponse>(request);
  } catch {
    // The service worker can be asleep for a moment after install; the user
    // just sees no download and can click Export again.
  }
  void track(format === 'csv' ? 'export_csv' : 'export_md');
}

/* ── Mounting ────────────────────────────────────────────────────────── */

function anchor(): Element | null {
  for (const selector of dom.GRID_ANCHOR_SELECTORS) {
    const node = document.querySelector(selector);
    if (node) return node;
  }
  return null;
}

function mount(): void {
  if (!isProfilePage()) {
    unmount();
    return;
  }

  const host = anchor();
  if (!host?.parentElement) return;
  if (panel && host.parentElement.contains(panel.root)) return;

  if (!panel) {
    panel = new OutlierPanel({
      onFilterChange: setFilters,
      onHookPanelOpen,
      onExport: format => void onExport(format),
    });
    panel.setFilters(filters);
  }

  host.parentElement.insertBefore(panel.root, host);
  observeGrid();
  scheduleApply();
}

function unmount(): void {
  observer?.disconnect();
  observer = null;
  panel?.root.remove();
  if (panel) clearBadges(document);
}

function observeGrid(): void {
  observer?.disconnect();
  observer = new MutationObserver(scheduleApply);
  observer.observe(document.body, { childList: true, subtree: true });
}

function watchUrl(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    mount();
  }, 700);
}

async function init(): Promise<void> {
  filters = await readFilters();
  mount();

  // Warm the header with a cached median immediately, before the grid finishes
  // loading, so the strip isn't blank for the first paint (§6: no layout shift).
  const profileId = parseProfileId(location.pathname);
  if (profileId) {
    const cached = await readMedianCache(profileId);
    if (cached && panel && !lastSnapshot) {
      panel.setSnapshot({
        profileId,
        median: cached.median,
        sampleSize: cached.sampleSize,
        loadedCount: cached.sampleSize,
        lowSample: cached.sampleSize < 12,
        videos: [],
        dateRange: { earliest: null, latest: null },
      });
    }
  }
}

void init();
watchUrl();
