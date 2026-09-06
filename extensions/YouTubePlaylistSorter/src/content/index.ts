/**
 * Content script entry point.
 *
 * YouTube is a single-page app — the document loads once and every later
 * "page" is a client-side swap announced by `yt-navigate-finish`. This script
 * re-checks whether the tab is a playlist page on every navigation and on
 * every DOM mutation of the row list (YouTube's own scroll-driven lazy
 * loading), and pushes a fresh ScanState to the panel each time.
 *
 * There is no code path here that writes to YouTube — no click simulation, no
 * form submission, nothing but reading rows and driving the page's own
 * scroll. That is a permanent property of this product (PRD §4/§6), not a V1
 * limit.
 */

import { track } from '../metrics';
import { ContentToPanel, PanelToContent, ScanState } from '../types';
import { autoScrollToLoadFull, currentStatedTotal, scanRows } from './scan';
import { isPlaylistPage, isWatchLaterPage, playlistTitleFromDocument } from './selectors';

let loading = false;
let cancelRequested = false;
let lastRowCount = -1;

function isAlive(): boolean {
  try {
    return Boolean(chrome.runtime?.id);
  } catch {
    return false;
  }
}

function buildState(loadProgress: string | null = null): ScanState {
  if (!isPlaylistPage()) {
    return {
      supported: false,
      notice: 'Open a YouTube playlist page (a URL like youtube.com/playlist?list=...) to use this panel.',
      playlistTitle: '',
      isWatchLater: false,
      rows: [],
      statedTotal: null,
      loading: false,
      loadProgress: null,
      scannedAt: Date.now(),
    };
  }

  const watchLater = isWatchLaterPage();
  const rows = scanRows();

  return {
    supported: true,
    notice: watchLater
      ? "Watch Later hasn't been verified to render the same way as a regular playlist — results here may be incomplete."
      : null,
    playlistTitle: playlistTitleFromDocument(),
    isWatchLater: watchLater,
    rows,
    statedTotal: currentStatedTotal(),
    loading,
    loadProgress,
    scannedAt: Date.now(),
  };
}

function broadcastState(loadProgress: string | null = null): void {
  if (!isAlive()) return;
  const message: ContentToPanel = { type: 'PLS_STATE', state: buildState(loadProgress) };
  try {
    chrome.runtime.sendMessage(message).catch(() => {
      /* no panel listening right now — fine, it will ask on open */
    });
  } catch {
    /* extension context gone */
  }
}

/* ── React to YouTube's own scroll-driven row loading ─────────────────── */

let observer: MutationObserver | null = null;

function watchForRowChanges(): void {
  observer?.disconnect();
  observer = new MutationObserver(() => {
    const count = document.querySelectorAll('ytd-playlist-video-renderer').length;
    if (count === lastRowCount) return;
    lastRowCount = count;
    broadcastState(loading ? undefined : null);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

/* ── Navigation ─────────────────────────────────────────────────────── */

function onNavigate(): void {
  loading = false;
  cancelRequested = false;
  lastRowCount = -1;
  // The list container mounts a beat after the navigation event fires.
  setTimeout(() => broadcastState(), 300);
  setTimeout(() => broadcastState(), 1200);
  broadcastState();
}

document.addEventListener('yt-navigate-finish', onNavigate);
window.addEventListener('popstate', onNavigate);

/* ── Messaging ──────────────────────────────────────────────────────── */

chrome.runtime.onMessage.addListener((raw: unknown, _sender, sendResponse) => {
  const message = raw as PanelToContent;
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'PLS_GET_STATE') {
    sendResponse({ type: 'PLS_STATE', state: buildState() } satisfies ContentToPanel);
    return false;
  }

  if (message.type === 'PLS_CANCEL_LOAD') {
    cancelRequested = true;
    return false;
  }

  if (message.type === 'PLS_LOAD_FULL') {
    if (loading) return false;
    loading = true;
    cancelRequested = false;
    void track('load_full_used');

    void autoScrollToLoadFull(
      (loadedCount, attempts, elapsedMs) => {
        const seconds = Math.round(elapsedMs / 1000);
        broadcastState(`${loadedCount} loaded — scrolling… (${attempts} attempts, ${seconds}s)`);
      },
      () => cancelRequested,
    ).then((outcome) => {
      loading = false;
      if (!outcome.completed) void track('load_full_capped');
      void track('scan_completed');
      broadcastState(
        outcome.completed
          ? null
          : `stopped after ${Math.round(outcome.elapsedMs / 1000)}s / ${outcome.attempts} attempts — ${outcome.finalCount} loaded, more may remain`,
      );
    });

    sendResponse({ type: 'PLS_STATE', state: buildState('starting…') } satisfies ContentToPanel);
    return false;
  }

  return false;
});

watchForRowChanges();
broadcastState();
void track('scan_completed');
