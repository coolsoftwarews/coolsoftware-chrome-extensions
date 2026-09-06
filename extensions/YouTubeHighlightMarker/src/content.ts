/**
 * Runs on youtube.com. Jobs:
 *   1. put an "In" / "Out" mark button pair under the player
 *   2. capture a timestamp (+ best-effort thumbnail) on each press and turn
 *      a completed pair into a saved clip candidate (src/marks.ts, src/storage.ts)
 *   3. seek the player when the panel asks
 *   4. tell the panel when YouTube swaps videos or the pending mark changes
 *      (YouTube never does a full page load between videos)
 */
import { applyPress, buildClipCandidate } from './marks';
import { track } from './metrics';
import { addClip } from './storage';
import { grabThumbnail } from './thumbnail';
import { clampSeconds } from './time';
import { PendingPoint, MarkKind } from './types';
import { extractVideoId } from './url';

const BAR_ID = 'yhm-mark-bar';
const TOAST_ID = 'yhm-toast';

/**
 * Talking to an extension that may no longer be there.
 *
 * Reloading or updating the extension orphans every content script already
 * in a page — the script keeps running, but its half of the bridge is gone,
 * and the next `chrome.runtime.sendMessage` throws *synchronously*. One
 * orphaned script cannot repair itself, so the honest response is to stop:
 * pull the UI back out and leave the page as we found it.
 */
let orphaned = false;

function send(message: unknown): void {
  if (orphaned) return;
  try {
    void chrome.runtime.sendMessage(message)?.catch(() => undefined);
  } catch {
    retire();
  }
}

function retire(): void {
  if (orphaned) return;
  orphaned = true;
  observer?.disconnect();
  document.getElementById(BAR_ID)?.remove();
  document.getElementById(TOAST_ID)?.remove();
}

let observer: MutationObserver | null = null;
let pending: PendingPoint | null = null;
let lastVideoId: string | null = null;

function isWatchPage(): boolean {
  return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
}

function currentVideoId(): string | null {
  return extractVideoId(location.href);
}

function currentVideo(): HTMLVideoElement | null {
  return document.querySelector('video.html5-main-video') ?? document.querySelector('video');
}

function currentTitle(): string {
  const el = document.querySelector<HTMLElement>('ytd-watch-metadata #title h1, h1.ytd-watch-metadata');
  const text = el?.textContent?.trim();
  if (text) return text;
  return document.title.replace(/ - YouTube$/, '').trim();
}

function currentChannel(): string {
  const el = document.querySelector<HTMLElement>(
    'ytd-watch-metadata ytd-channel-name yt-formatted-string a, #owner ytd-channel-name a',
  );
  return el?.textContent?.trim() ?? '';
}

/* ── On-page bar ─────────────────────────────────────────────────────── */

const ACTION_ROW_SELECTORS = [
  'ytd-watch-metadata #actions-inner #top-level-buttons-computed',
  'ytd-watch-metadata #actions #top-level-buttons-computed',
  '#top-level-buttons-computed',
  'ytd-watch-metadata #actions-inner',
  '#menu-container #top-level-buttons-computed',
];

function findActionRow(): HTMLElement | null {
  for (const selector of ACTION_ROW_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function styleButton(button: HTMLButtonElement, primary: boolean): void {
  button.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'height:36px',
    'padding:0 14px',
    'margin-left:8px',
    'border:none',
    'border-radius:18px',
    'font-family:"Roboto","Arial",sans-serif',
    'font-size:13px',
    'font-weight:500',
    'cursor:pointer',
    primary
      ? 'background:#d33; color:#fff;'
      : 'background:var(--yt-spec-badge-chip-background, rgba(0,0,0,0.05)); color:var(--yt-spec-text-primary, #0f0f0f);',
  ].join(';');
}

function buildBar(): HTMLElement {
  const wrap = document.createElement('span');
  wrap.id = BAR_ID;
  wrap.style.cssText = 'display:inline-flex; align-items:center;';

  const inBtn = document.createElement('button');
  inBtn.type = 'button';
  inBtn.id = 'yhm-mark-in';
  inBtn.textContent = 'Mark in';
  inBtn.title = 'Mark the in-point of a highlight (Alt+Shift+I)';
  styleButton(inBtn, false);
  inBtn.addEventListener('click', () => void markPoint('in'));

  const outBtn = document.createElement('button');
  outBtn.type = 'button';
  outBtn.id = 'yhm-mark-out';
  outBtn.textContent = 'Mark out';
  outBtn.title = 'Mark the out-point of a highlight (Alt+Shift+O)';
  styleButton(outBtn, false);
  outBtn.addEventListener('click', () => void markPoint('out'));

  wrap.appendChild(inBtn);
  wrap.appendChild(outBtn);
  return wrap;
}

function updateBarUI(): void {
  const inBtn = document.getElementById('yhm-mark-in') as HTMLButtonElement | null;
  const outBtn = document.getElementById('yhm-mark-out') as HTMLButtonElement | null;
  if (!inBtn || !outBtn) return;

  styleButton(inBtn, pending?.kind === 'in');
  styleButton(outBtn, pending?.kind === 'out');
  inBtn.textContent = pending?.kind === 'in' ? 'In point set' : 'Mark in';
  outBtn.textContent = pending?.kind === 'out' ? 'Out point set' : 'Mark out';
}

function injectBar(): void {
  if (!isWatchPage()) {
    document.getElementById(BAR_ID)?.remove();
    return;
  }
  if (document.getElementById(BAR_ID)) return;

  const row = findActionRow();
  if (!row) return;
  row.appendChild(buildBar());
  updateBarUI();
}

function showToast(text: string): void {
  document.getElementById(TOAST_ID)?.remove();
  const toast = document.createElement('div');
  toast.id = TOAST_ID;
  toast.textContent = text;
  toast.style.cssText = [
    'position:fixed',
    'left:50%',
    'bottom:24px',
    'transform:translateX(-50%)',
    'background:rgba(20,20,20,0.92)',
    'color:#fff',
    'padding:10px 16px',
    'border-radius:8px',
    'font:13px/1.4 "Roboto","Arial",sans-serif',
    'z-index:2147483647',
    'max-width:80vw',
    'text-align:center',
    'box-shadow:0 2px 10px rgba(0,0,0,0.35)',
  ].join(';');
  document.body.appendChild(toast);
  window.setTimeout(() => toast.remove(), 3500);
}

/* ── Marking ─────────────────────────────────────────────────────────── */

async function markPoint(kind: MarkKind): Promise<{ ok: boolean; reason?: string }> {
  const video = currentVideo();
  const videoId = currentVideoId();
  if (!video || !videoId || !isWatchPage()) {
    return { ok: false, reason: 'no-video' };
  }

  const seconds = clampSeconds(video.currentTime, Number.isFinite(video.duration) ? video.duration : undefined);
  const thumbnail = grabThumbnail(video);
  if (!thumbnail) void track('thumbnail_failed');
  void track(kind === 'in' ? 'mark_in' : 'mark_out');

  const { nextPending, pair } = applyPress(pending, kind, seconds, thumbnail);
  pending = nextPending;
  updateBarUI();
  send({ type: 'YHM_PENDING_CHANGED', pending: pending ? { kind: pending.kind, seconds: pending.seconds } : null });

  if (pair) {
    const [a, b] = pair;
    const clip = buildClipCandidate(a, b, videoId);
    if (clip.swapped) void track('clip_swapped');
    void track('clip_created');
    await addClip(videoId, clip);
    send({ type: 'YHM_CLIP_ADDED', videoId });
  }

  return { ok: true };
}

function cancelPending(): void {
  if (!pending) return;
  pending = null;
  updateBarUI();
  send({ type: 'YHM_PENDING_CHANGED', pending: null });
}

function seekTo(seconds: number): boolean {
  const video = currentVideo();
  if (!video) return false;
  video.currentTime = seconds;
  void video.play().catch(() => undefined);
  return true;
}

/* ── Navigation (SPA — YouTube never does a full page load) ────────────── */

function announceNavigation(): void {
  if (orphaned) return;
  const videoId = currentVideoId();
  if (videoId === lastVideoId) return;

  // PRD §7: an in-progress, unfinished mark must not vanish without a trace.
  if (pending) {
    void track('pending_discarded');
    showToast('The video changed before you finished a mark — the in-progress point was discarded.');
    pending = null;
    send({ type: 'YHM_PENDING_DISCARDED' });
  }

  lastVideoId = videoId;
  injectBar();
  updateBarUI();
  send({ type: 'YHM_NAVIGATED', videoId, url: location.href });
}

function watchForActionRow(): void {
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (orphaned) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      announceNavigation();
      injectBar();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* ── Messages from background (keyboard commands) and the panel ───────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'YHM_MARK_IN' || message?.type === 'YHM_MARK_OUT') {
    void markPoint(message.type === 'YHM_MARK_IN' ? 'in' : 'out').then(sendResponse);
    return true;
  }
  if (message?.type === 'YHM_CANCEL_PENDING') {
    cancelPending();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'YHM_SEEK' && typeof message.seconds === 'number') {
    void track('seek_used');
    sendResponse({ ok: seekTo(message.seconds) });
    return false;
  }
  if (message?.type === 'YHM_PING') {
    sendResponse({
      ok: true,
      url: location.href,
      videoId: currentVideoId(),
      title: currentTitle(),
      channel: currentChannel(),
      pending: pending ? { kind: pending.kind, seconds: pending.seconds } : null,
    });
    return false;
  }
  return false;
});

document.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('popstate', announceNavigation);

lastVideoId = currentVideoId();
injectBar();
watchForActionRow();
