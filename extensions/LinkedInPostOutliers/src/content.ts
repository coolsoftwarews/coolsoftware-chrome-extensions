/**
 * Content-script entry point. Runs on every linkedin.com page but only does
 * work on the three page shapes PRD §4 scopes V1 to: a profile's post
 * history, a hashtag page, or content search results. The main feed is
 * deliberately left alone (PRD §4) — that surface belongs to LinkedIn
 * Creator Watchlist's browsing-driven collection, not this product.
 *
 * No fetch, no XMLHttpRequest anywhere in this file or anything it imports:
 * everything here reads what LinkedIn already rendered into the tab for the
 * logged-in user (PRD §5) and writes only to chrome.storage.local. There is
 * no code path anywhere in this extension that posts, reacts, comments,
 * follows or connects — see PRIVACY.md.
 */

import { renderBadge, clearBadges } from './badges';
import { OverlayBar } from './bar';
import * as dom from './dom';
import { visibleSet } from './filters';
import { buildFilename, toCsv, toMarkdown } from './formatters';
import { computeAuthorBaselines, formatCompact, scoreAll } from './outlier';
import { identifyPost, scanPosts } from './scan';
import { readAuthorCache, readFilters, writeAuthorCache, writeFilters } from './storage';
import { track, trackParseFailure } from './metrics';
import { pageModeFor } from './text';
import { AuthorBaseline, AuthorCacheRecord, DownloadRequest, DownloadResponse, FilterState, PageMode, ScoredPost } from './types';

const HIDDEN_CLASS = 'lpo-hidden';
const CONSECUTIVE_FAILURE_LIMIT = 3;
const MIN_RELIABLE_SAMPLE_LABEL = 5;

let bar: OverlayBar | null = null;
let filters: FilterState = { ratio: 'all', days: null, sort: 'ratio' };
let observer: MutationObserver | null = null;
let scheduled = false;
let currentMode: PageMode = 'unsupported';
let trackedMode: PageMode | null = null;
let authorCache: Map<string, AuthorCacheRecord> = new Map();
let lastScored: ScoredPost[] = [];
let lastMode: PageMode = 'unsupported';
let consecutiveFailures = 0;
let noticeShown = false;

/* ── The scan -> baseline -> score -> filter -> render pipeline ────────── */

function apply(): void {
  if (!bar) return;
  const mode = pageModeFor(location.pathname);
  if (mode === 'unsupported') {
    unmount();
    return;
  }
  currentMode = mode;

  let result: ReturnType<typeof scanPosts>;
  try {
    result = scanPosts();
  } catch {
    result = { posts: [], failed: true };
  }

  if (result.failed) {
    consecutiveFailures++;
    if (consecutiveFailures >= CONSECUTIVE_FAILURE_LIMIT && !noticeShown) {
      noticeShown = true;
      bar.showNotice(
        "Couldn't read engagement counts here — LinkedIn may have changed something. The page itself is untouched."
      );
      void trackParseFailure();
    }
    return;
  }
  consecutiveFailures = 0;
  if (result.posts.length === 0) return;

  const baselines = computeAuthorBaselines(result.posts, authorCache);
  const scored = scoreAll(result.posts, baselines);
  lastScored = scored;
  lastMode = mode;

  const containerById = new Map<string, HTMLElement>();
  for (const container of dom.postContainers()) {
    const identity = identifyPost(container);
    if (identity) containerById.set(identity.id, container);
  }

  for (const post of scored) {
    const container = containerById.get(post.id);
    if (!container) continue;
    const anchor = dom.badgeAnchor(container);
    if (anchor) renderBadge(container, anchor, post);
  }

  const visible = visibleSet(scored, filters);
  const visibleIds = new Set(visible.map(p => p.id));
  for (const post of scored) {
    const container = containerById.get(post.id);
    container?.classList.toggle(HIDDEN_CLASS, !visibleIds.has(post.id));
  }

  updateSummary(mode, scored, baselines, result.posts.length);
  bar.setStatus(visible.length, scored.length);

  // Write-through cache: a profile page's live, reliable per-author median
  // is what makes a later hashtag/search page confident about that same
  // author (PRD §4 "Local state"). Only writes when a baseline is actually
  // reliable — never caches a guess.
  if (mode === 'profile') {
    for (const [authorId, baseline] of baselines) {
      if (baseline.source !== 'live' || !baseline.reliable || baseline.median === null) continue;
      const authorName = scored.find(p => p.authorId === authorId)?.authorName ?? '';
      const record: AuthorCacheRecord = {
        authorId,
        authorName,
        median: baseline.median,
        sampleSize: baseline.sampleSize,
        computedAt: Date.now(),
      };
      authorCache.set(authorId, record);
      void writeAuthorCache(record);
    }
  }

  if (mode !== trackedMode) {
    trackedMode = mode;
    void track(mode === 'profile' ? 'profile_scanned' : 'mixed_page_scanned');
  }
}

function updateSummary(
  mode: PageMode,
  scored: ScoredPost[],
  baselines: Map<string, AuthorBaseline>,
  totalLoaded: number
): void {
  if (!bar) return;

  if (mode === 'profile') {
    const authorName = scored[0]?.authorName ?? 'this author';
    const baseline = scored[0] ? baselines.get(scored[0].authorId) : undefined;
    const reliable = Boolean(baseline?.reliable && baseline.median !== null);
    const headline = reliable
      ? `Recent median: ${formatCompact(baseline!.median!)} engagement (reactions + comments) · median of ${baseline!.sampleSize} of ${authorName}'s posts`
      : `Recent median: collecting… (need ${MIN_RELIABLE_SAMPLE_LABEL} of ${authorName}'s posts, ${totalLoaded} loaded so far)`;
    const detail = reliable ? '' : `Keep scrolling for a reliable median — fewer than ${MIN_RELIABLE_SAMPLE_LABEL} posts loaded so far.`;
    bar.setSummary(headline, detail, !reliable);
    return;
  }

  const authors = new Set(scored.map(p => p.authorId));
  const reliableCount = scored.filter(p => p.ratio !== null).length;
  const pendingCount = scored.length - reliableCount;
  bar.setSummary(
    `${scored.length} posts scanned across ${authors.size} authors`,
    `${reliableCount} have a reliable per-author median (5+ of their posts visible or cached from a profile visit) · ${pendingCount} pending`,
    reliableCount === 0
  );
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

  if (next.ratio !== previous.ratio || next.days !== previous.days) void track('filter_used');
  if (next.sort !== previous.sort) void track('sort_used');

  scheduleApply();
}

function slugFor(mode: PageMode): string {
  if (mode === 'profile') {
    const match = location.pathname.match(/^\/in\/([^/]+)\//);
    return match ? match[1] : 'profile';
  }
  if (location.pathname.startsWith('/feed/hashtag/')) {
    const match = location.pathname.match(/^\/feed\/hashtag\/([^/]+)/);
    return match ? `hashtag-${match[1]}` : 'hashtag';
  }
  return 'search';
}

async function exportVisible(format: 'csv' | 'md'): Promise<void> {
  if (lastScored.length === 0) {
    bar?.showNotice('Nothing to export yet — scroll to load some posts first.');
    return;
  }

  const visible = visibleSet(lastScored, filters);
  const slug = slugFor(lastMode);
  const title = lastMode === 'profile' ? slug : `LinkedIn ${lastMode} — ${slug}`;
  const content = format === 'csv' ? toCsv(visible) : toMarkdown(title, lastMode, visible);
  const mimeType = format === 'csv' ? 'text/csv;charset=utf-8' : 'text/markdown;charset=utf-8';
  const filename = buildFilename(slug, format === 'csv' ? 'csv' : 'md');

  const request: DownloadRequest = { type: 'LPO_DOWNLOAD', filename, content, mimeType };
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
  const mode = pageModeFor(location.pathname);
  if (mode === 'unsupported') {
    unmount();
    return;
  }

  const container = dom.resultsContainer();
  if (!container) return;
  if (bar && container.contains(bar.root)) return;

  if (!bar) {
    bar = new OverlayBar(filters, {
      onChange: setFilters,
      onExport: format => void exportVisible(format),
    });
  }
  bar.setFilters(filters);
  container.prepend(bar.root);

  noticeShown = false;
  consecutiveFailures = 0;
  observeContainer(container);
  scheduleApply();
}

function unmount(): void {
  observer?.disconnect();
  observer = null;
  bar?.root.remove();
  document.querySelectorAll(`.${HIDDEN_CLASS}`).forEach(node => node.classList.remove(HIDDEN_CLASS));
  clearBadges(document);
  currentMode = 'unsupported';
  trackedMode = null;
  lastScored = [];
}

/** PRD §6: recompute on scroll, debounced, no visible jank at 150+ posts. */
function observeContainer(container: HTMLElement): void {
  observer?.disconnect();
  observer = new MutationObserver(scheduleApply);
  observer.observe(container, { childList: true, subtree: true });
}

/* ── Boot: SPA navigation, since LinkedIn never reloads the page ─────────── */

function watchNavigation(): void {
  let last = location.href;
  window.setInterval(() => {
    if (location.href === last) return;
    last = location.href;
    setTimeout(mount, 200);
  }, 600);

  window.addEventListener('scroll', scheduleApply, { passive: true });
}

async function init(): Promise<void> {
  filters = await readFilters();
  authorCache = await readAuthorCache();
  mount();
  watchNavigation();
}

if (window.top === window && /(^|\.)linkedin\.com$/.test(location.hostname)) {
  void init();
}
