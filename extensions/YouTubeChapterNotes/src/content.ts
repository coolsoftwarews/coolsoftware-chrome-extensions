/**
 * Runs on youtube.com. Jobs:
 *   1. put a "+ Note" button in the action row under the player
 *   2. on click (or the Alt+Shift+N shortcut, relayed from background.ts —
 *      content scripts can't listen for chrome.commands directly) freeze the
 *      current timestamp and open a small capture card
 *   3. save the note straight to chrome.storage.local — no messaging needed
 *      for that half (PRD §5: this product's only backend is local storage)
 *   4. answer the panel's two narrow questions: "what video is this" and
 *      "seek to N seconds" — the only two things a per-page panel can't get
 *      from storage alone, same shape as RedditOpportunityMonitor's single
 *      ROM_GET_TAB_STATUS request/response
 *
 * All capture-card UI lives in a shadow root so YouTube's own CSS can never
 * reach it and this extension's markup never ends up mistaken for the
 * page's. Nothing here makes a network request — see PRIVACY.md.
 */

import { continueDraftFor } from './notes';
import { track } from './metrics';
import { clearDraft, readDraft, saveNote, writeDraft } from './storage';
import { Draft, TabState } from './types';
import { extractVideoId, isYouTubeUrl } from './url';

const BUTTON_ID = 'ycn-note-button';
const UI_ATTR = 'data-ycn-ui';

/**
 * Talking to an extension that may no longer be there.
 *
 * Reloading or updating the extension orphans every content script already
 * in a page: the script keeps running, but its half of the bridge is gone.
 * The next chrome.runtime.sendMessage then throws synchronously — take the
 * button and card out and stop, the new content script from the reload
 * takes over. Same defensive shape as YouTubeTranscription's content.ts.
 */
let orphaned = false;

function push(message: unknown): void {
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
  closeCapture();
  document.getElementById(BUTTON_ID)?.remove();
}

let observer: MutationObserver | null = null;

/* ── Where the button goes ──────────────────────────────────────────── */

// Reused verbatim from YouTubeTranscription's content.ts, which already
// validated this list live under the player's action row.
const ACTION_ROW_SELECTORS = [
  'ytd-watch-metadata #actions-inner #top-level-buttons-computed',
  'ytd-watch-metadata #actions #top-level-buttons-computed',
  '#top-level-buttons-computed',
  'ytd-watch-metadata #actions-inner',
  '#menu-container #top-level-buttons-computed',
];

function isWatchPage(): boolean {
  return location.pathname === '/watch' || location.pathname.startsWith('/live/');
}

function findActionRow(): HTMLElement | null {
  for (const selector of ACTION_ROW_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    if (el) return el;
  }
  return null;
}

function buildButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.type = 'button';
  button.textContent = '+ Note';
  button.title = 'Save a timestamped note (Alt+Shift+N)';
  // Inline styles rather than a stylesheet: YouTube's own classes churn.
  button.style.cssText = [
    'display:inline-flex',
    'align-items:center',
    'height:36px',
    'padding:0 16px',
    'margin-left:8px',
    'border:none',
    'border-radius:18px',
    'font-family:"Roboto","Arial",sans-serif',
    'font-size:14px',
    'font-weight:500',
    'cursor:pointer',
    'background:var(--yt-spec-badge-chip-background, rgba(0,0,0,0.05))',
    'color:var(--yt-spec-text-primary, #0f0f0f)',
  ].join(';');

  button.addEventListener('click', () => openCapture(button));
  return button;
}

function injectButton(): void {
  if (!isWatchPage()) {
    document.getElementById(BUTTON_ID)?.remove();
    return;
  }
  if (document.getElementById(BUTTON_ID)) return;

  const row = findActionRow();
  if (!row) return;
  row.appendChild(buildButton());
}

function watchForActionRow(): void {
  let scheduled = false;
  observer = new MutationObserver(() => {
    if (orphaned) return;
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      announceNavigation(); // catches navigations if the yt event ever stops firing
      injectButton();
    });
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

/* ── Reading the video ─────────────────────────────────────────────── */

function currentVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function currentVideoTitle(): string {
  return document.title.replace(/ - YouTube$/, '').trim() || 'YouTube video';
}

/** A livestream's `duration` is Infinity/NaN, and its player carries a
 *  distinct "LIVE" badge class — checking both covers a stream that hasn't
 *  buffered enough yet to report a duration at all. */
function isLiveNow(): boolean {
  const video = currentVideo();
  const durationLooksLive = !video || !Number.isFinite(video.duration);
  return durationLooksLive || !!document.querySelector('.ytp-live');
}

function tabState(): TabState | null {
  const videoId = extractVideoId(location.href);
  if (!videoId) return null;
  return { videoId, videoTitle: currentVideoTitle(), url: location.href, isLive: isLiveNow() };
}

function seekTo(seconds: number): boolean {
  const player = document.querySelector('#movie_player') as (HTMLElement & { seekTo?: (s: number) => void }) | null;
  if (player?.seekTo) {
    player.seekTo(seconds);
    return true;
  }
  const video = currentVideo();
  if (video) {
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
    return true;
  }
  return false;
}

/* ── Capture card (shadow DOM) ─────────────────────────────────────── */

let shadow: ShadowRoot | null = null;

function ui(): ShadowRoot {
  if (shadow) return shadow;
  const host = document.createElement('div');
  host.setAttribute(UI_ATTR, '');
  host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647';
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = SHADOW_CSS;
  shadow.appendChild(style);
  return shadow;
}

const SHADOW_CSS = `
  .card {
    position: fixed; display: none; box-sizing: border-box; width: min(320px, 88vw);
    background: #14161a; color: #fff; border-radius: 14px;
    box-shadow: 0 10px 30px rgba(0,0,0,.35); padding: 12px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    z-index: 2147483647;
  }
  .card--open { display: block; }
  .card__badge {
    display: inline-flex; align-items: center; gap: 4px;
    background: rgba(255,255,255,.12); border-radius: 999px;
    padding: 3px 10px; font-weight: 600; font-size: 12px; margin-bottom: 8px;
  }
  .card__badge--live { background: #b3261e; }
  textarea {
    width: 100%; min-height: 64px; resize: vertical; box-sizing: border-box;
    background: rgba(255,255,255,.08); color: #fff; border: 1px solid rgba(255,255,255,.2);
    border-radius: 8px; padding: 8px; font: inherit; font-size: 13px;
  }
  textarea:focus { outline: 2px solid #59c2b3; outline-offset: 1px; }
  .card__actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
  button.pill {
    border: none; border-radius: 999px; padding: 6px 14px; font: inherit; font-weight: 600;
    cursor: pointer;
  }
  .cancel { background: none; color: rgba(255,255,255,.8); }
  .cancel:hover { background: rgba(255,255,255,.1); }
  .save { background: #59c2b3; color: #0a1f1c; }
  .save:disabled { opacity: .5; cursor: default; }
  .save:not(:disabled):hover { background: #74d0c3; }
  button:focus-visible { outline: 2px solid #59c2b3; outline-offset: 2px; }
  .toast {
    position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%);
    background: #14161a; color: #fff; padding: 8px 14px; border-radius: 999px;
    font: 13px/1.4 -apple-system, "Segoe UI", Roboto, sans-serif;
    opacity: 0; pointer-events: none; transition: opacity .18s ease;
    z-index: 2147483647;
  }
  .toast--on { opacity: .96; }
  @media (prefers-reduced-motion: reduce) { .toast { transition: none; } }
`;

interface CaptureState {
  videoId: string;
  videoTitle: string;
  seconds: number;
  isLive: boolean;
}

let captureCard: HTMLDivElement | null = null;
let captureTextarea: HTMLTextAreaElement | null = null;
let captureSave: HTMLButtonElement | null = null;
let captureBadge: HTMLDivElement | null = null;
let active: CaptureState | null = null;
let draftTimer: number | undefined;

function positionNear(card: HTMLElement, anchor: HTMLElement): void {
  const rect = anchor.getBoundingClientRect();
  card.classList.add('card--open');
  const width = card.offsetWidth || 320;
  const height = card.offsetHeight || 140;
  const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
  const above = rect.top - height - 10;
  const top = above > 8 ? above : Math.min(rect.bottom + 10, window.innerHeight - height - 8);
  card.style.left = `${Math.round(left)}px`;
  card.style.top = `${Math.round(top)}px`;
}

function buildCard(): void {
  captureCard = document.createElement('div');
  captureCard.className = 'card';
  captureCard.setAttribute('role', 'dialog');
  captureCard.setAttribute('aria-label', 'Save a timestamped note');

  captureBadge = document.createElement('div');
  captureBadge.className = 'card__badge';
  captureCard.appendChild(captureBadge);

  captureTextarea = document.createElement('textarea');
  captureTextarea.placeholder = "What's happening at this timestamp?";
  captureTextarea.addEventListener('input', onDraftInput);
  captureTextarea.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeCapture();
    if ((event.key === 'Enter' && (event.metaKey || event.ctrlKey))) void handleSave();
  });
  captureCard.appendChild(captureTextarea);

  const actions = document.createElement('div');
  actions.className = 'card__actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'pill cancel';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => closeCapture());
  actions.appendChild(cancel);

  captureSave = document.createElement('button');
  captureSave.type = 'button';
  captureSave.className = 'pill save';
  captureSave.textContent = 'Save note';
  captureSave.disabled = true;
  captureSave.addEventListener('click', () => void handleSave());
  actions.appendChild(captureSave);

  captureCard.appendChild(actions);
  ui().appendChild(captureCard);
}

function renderBadge(): void {
  if (!captureBadge || !active) return;
  captureBadge.textContent = active.isLive ? `${formatBadgeTime(active.seconds)} · live` : formatBadgeTime(active.seconds);
  captureBadge.classList.toggle('card__badge--live', active.isLive);
}

function formatBadgeTime(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

async function openCapture(anchor?: HTMLElement): Promise<void> {
  const state = tabState();
  const video = currentVideo();
  if (!state || !video) return;

  const draft = continueDraftFor(await readDraft(), state.videoId);
  active = draft
    ? { videoId: draft.videoId, videoTitle: draft.videoTitle, seconds: draft.seconds, isLive: draft.isLive }
    : { videoId: state.videoId, videoTitle: state.videoTitle, seconds: video.currentTime, isLive: state.isLive };

  if (!captureCard) buildCard();
  captureTextarea!.value = draft?.text ?? '';
  captureSave!.disabled = !captureTextarea!.value.trim();
  renderBadge();

  const target = anchor ?? document.getElementById(BUTTON_ID) ?? document.body;
  positionNear(captureCard!, target);
  captureTextarea!.focus();

  document.addEventListener('pointerdown', onOutsidePointer, true);
  document.addEventListener('keydown', onGlobalEscape, true);
}

function closeCapture(): void {
  captureCard?.classList.remove('card--open');
  document.removeEventListener('pointerdown', onOutsidePointer, true);
  document.removeEventListener('keydown', onGlobalEscape, true);
  active = null;
}

function onOutsidePointer(event: PointerEvent): void {
  const target = event.target as Node;
  const path = (event.composedPath?.() ?? []) as EventTarget[];
  if (path.includes(captureCard as EventTarget)) return;
  if (captureCard?.contains(target)) return;
  closeCapture();
}

function onGlobalEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') closeCapture();
}

function onDraftInput(): void {
  if (!active || !captureTextarea) return;
  captureSave!.disabled = !captureTextarea.value.trim();

  window.clearTimeout(draftTimer);
  draftTimer = window.setTimeout(() => {
    if (!active) return;
    const draft: Draft = {
      videoId: active.videoId,
      videoTitle: active.videoTitle,
      seconds: active.seconds,
      isLive: active.isLive,
      text: captureTextarea!.value,
      updatedAt: Date.now(),
    };
    void writeDraft(draft);
  }, 350);
}

let toastEl: HTMLDivElement | null = null;
let toastTimer: number | undefined;

function showToast(message: string): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    ui().appendChild(toastEl);
  }
  toastEl.textContent = message;
  toastEl.classList.add('toast--on');
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastEl?.classList.remove('toast--on'), 1800);
}

async function handleSave(): Promise<void> {
  if (!active || !captureTextarea) return;
  const text = captureTextarea.value.trim();
  if (!text) return;

  await saveNote({ videoId: active.videoId, videoTitle: active.videoTitle, seconds: active.seconds, isLive: active.isLive, text });
  window.clearTimeout(draftTimer);
  await clearDraft();
  closeCapture();
  showToast('Note saved');
  void track('note_captured');
}

/* ── Messaging: the panel's two questions, plus the shortcut relay ────── */

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'YCN_GET_STATE') {
    sendResponse(tabState());
    return false;
  }
  if (message?.type === 'YCN_SEEK' && typeof message.seconds === 'number') {
    sendResponse({ ok: seekTo(message.seconds) });
    return false;
  }
  if (message?.type === 'YCN_OPEN_CAPTURE') {
    void openCapture();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'YCN_PING') {
    sendResponse({ ok: true, url: location.href });
    return false;
  }
  return false;
});

/* ── SPA navigation: YouTube never does a full page load ──────────────── */

let lastUrl = location.href;

function announceNavigation(): void {
  if (orphaned || location.href === lastUrl) return;
  lastUrl = location.href;
  // A different video is on screen now — a card open for the old one is a
  // stale target, not a note about the video the viewer is now watching.
  // The draft it holds is already persisted (debounced writeDraft above),
  // so nothing typed is lost — only the open card goes away (PRD §7).
  closeCapture();
  injectButton();
  push({ type: 'YCN_VIDEO_CHANGED', state: tabState() });
}

document.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('popstate', announceNavigation);

const supported = isYouTubeUrl(location.href);
if (supported) {
  injectButton();
  watchForActionRow();
}
