/**
 * Boots on every TikTok page (manifest host permission: `*://*.tiktok.com/*`).
 * Three jobs, matched to PRD §4:
 *
 *   1. Feed / search / hashtag / video pages — scan tiles, badge them with an
 *      outlier ratio and any commercial marker, offer "+ Track product".
 *   2. Profile pages — read the creator's own recent view counts and cache a
 *      median baseline for them (PRD §5: "cache medians per creator when the
 *      user visits a profile").
 *   3. The product board drawer — toggled by the toolbar icon or the on-page
 *      tab, always available regardless of which of the above applies.
 *
 * Nothing here writes to TikTok itself (README hard constraint: read-only on
 * the platform) and nothing here makes a network request — see PRIVACY.md.
 */

import { promptTrack, refresh as refreshDrawer, isOpen as isDrawerOpen, toggle as toggleDrawer, isTracked } from './drawer';
import * as badge from './badge';
import { buildBaseline, computeOutlier } from './outlier';
import { hasCommercialMarker } from './markers';
import { extractVideo, extractProfileViewCounts, findTiles, pageContext } from './scan';
import { noteVideoSeen, readAllBaselines, readAllProducts, writeBaseline } from './storage';
import { CreatorBaseline, ScannedVideo } from './types';
import { extractHandle } from './parse';

const UI_ATTR = 'data-tps-ui';

let baselineCache = new Map<string, CreatorBaseline>();
let trackedIds = new Set<string>();

async function refreshCaches(): Promise<void> {
  const [baselines, products] = await Promise.all([readAllBaselines(), readAllProducts()]);
  baselineCache = baselines;
  trackedIds = new Set(products.flatMap(p => p.videos.map(v => v.id)));
}

function onVideoTracked(videoId: string): void {
  trackedIds.add(videoId);
  void refreshDrawer();
}

/* ── Feed / search / hashtag / video scanning ────────────────────────── */

let scanning = false;

async function scanAndRender(): Promise<void> {
  if (scanning) return;
  scanning = true;
  try {
    const context = pageContext();
    if (context === 'unknown') return;
    if (context === 'profile') {
      void updateProfileBaseline();
      return;
    }

    const tiles = findTiles(context);
    for (const { tile, anchor } of tiles) {
      const video = extractVideo(tile, anchor, context);
      if (!video) continue;

      void noteVideoSeen(video.id);
      renderBadgeFor(tile, video);
    }
  } finally {
    scanning = false;
  }
}

function renderBadgeFor(tile: HTMLElement, video: ScannedVideo): void {
  const baseline = baselineCache.get(video.creatorHandle) ?? null;
  const outlier = computeOutlier(video.views, baseline);
  const tracked = trackedIds.has(video.id);
  const canTrack = hasCommercialMarker(video.markers);

  badge.upsertBadge(tile, video, outlier, tracked, canTrack ? () => onTrackClick(video) : null);
}

function onTrackClick(video: ScannedVideo): void {
  if (trackedIds.has(video.id)) return; // already tracked; badge already reads "Tracked"
  promptTrack(video, onVideoTracked);
}

/* ── Profile baselines ───────────────────────────────────────────────── */

let lastBaselineHandle: string | null = null;
let lastBaselineSampleSize = 0;

async function updateProfileBaseline(): Promise<void> {
  const handle = extractHandle(location.href) ?? extractHandle(location.pathname);
  if (!handle) return;

  const views = extractProfileViewCounts();
  if (!views.length) return;

  // Cheap guard against re-writing storage on every scroll tick when nothing changed.
  if (handle === lastBaselineHandle && views.length === lastBaselineSampleSize) return;
  lastBaselineHandle = handle;
  lastBaselineSampleSize = views.length;

  const baseline = buildBaseline(handle, views);
  if (!baseline) return;

  await writeBaseline(baseline);
  baselineCache.set(handle, baseline);
}

/* ── Positioning loop (throttled — never fights TikTok's own scroll) ───── */

let positionQueued = false;

function schedulePositioning(): void {
  if (positionQueued) return;
  positionQueued = true;
  requestAnimationFrame(() => {
    positionQueued = false;
    badge.positionAll();
  });
}

/* ── DOM churn: rescan on mutation, throttled ───────────────────────── */

let scanTimer: number | undefined;

function scheduleScan(delay = 250): void {
  window.clearTimeout(scanTimer);
  scanTimer = window.setTimeout(() => void scanAndRender(), delay);
}

const observer = new MutationObserver(mutations => {
  const relevant = mutations.some(mutation =>
    Array.from(mutation.addedNodes).some(node => {
      if (node.nodeType === Node.TEXT_NODE) return true;
      const el = node as HTMLElement;
      return el.nodeType === Node.ELEMENT_NODE && !el.hasAttribute?.(UI_ATTR);
    })
  );
  if (relevant) {
    scheduleScan(300);
    badge.pruneDetached();
  }
});

let lastPath = location.pathname + location.search;

function watchNavigation(): void {
  window.setInterval(() => {
    const next = location.pathname + location.search;
    if (next === lastPath) return;
    lastPath = next;
    lastBaselineHandle = null;
    scheduleScan(200);
  }, 700);
}

/* ── Background messaging (toolbar toggle only) ─────────────────────── */

chrome.runtime.onMessage.addListener(message => {
  if (message?.type === 'TPS_TOGGLE_BOARD') toggleDrawer();
});

/* ── Boot ────────────────────────────────────────────────────────────── */

if (window.top === window) {
  void (async () => {
    await refreshCaches();
    void scanAndRender();

    observer.observe(document.documentElement, { childList: true, subtree: true });
    watchNavigation();

    window.addEventListener('scroll', schedulePositioning, { passive: true });
    window.addEventListener('resize', schedulePositioning, { passive: true });

    // A slow second pass: TikTok's own view/like counters often arrive after
    // the tile's first paint, so one retry catches numbers that were empty
    // on the first read (PRD §6: badge must appear fast, but a wrong "0" is
    // worse than a slightly late real number).
    window.setTimeout(() => void scanAndRender(), 1500);

    // Periodically drop badges for recycled feed tiles and refresh the
    // "already tracked" cache in case the drawer changed it.
    window.setInterval(() => {
      badge.pruneDetached();
      schedulePositioning();
    }, 4000);
  })();
}

export const __internal = { scanAndRender, isDrawerOpen, isTracked };
