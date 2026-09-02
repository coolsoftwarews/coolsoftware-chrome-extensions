/**
 * Runs on youtube.com. Three jobs:
 *   1. put a "Transcript" button in the action row under the player
 *   2. seek the player when the panel asks
 *   3. tell the panel when YouTube swaps videos (it never does a full page load)
 */

const BUTTON_ID = 'ytx-transcript-button';

/**
 * Talking to an extension that may no longer be there.
 *
 * Reloading or updating the extension orphans every content script already in a
 * page: the script keeps running, but its half of the bridge is gone. The next
 * `chrome.runtime.sendMessage` then throws *synchronously* with "Extension
 * context invalidated" — which a `.catch()` on the returned promise never sees,
 * so it surfaced as an uncaught error every half-second from the tracking tick.
 *
 * One orphaned script cannot repair itself, so the honest response is to stop:
 * take the button out, drop the observers and timers, and leave the page as we
 * found it. The new content script that arrives with the reload does the work.
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
  stopTracking();
  observer?.disconnect();
  document.getElementById(BUTTON_ID)?.remove();
}

let observer: MutationObserver | null = null;

const ACTION_ROW_SELECTORS = [
  'ytd-watch-metadata #actions-inner #top-level-buttons-computed',
  'ytd-watch-metadata #actions #top-level-buttons-computed',
  '#top-level-buttons-computed',
  'ytd-watch-metadata #actions-inner',
  '#menu-container #top-level-buttons-computed',
];

function isWatchPage(): boolean {
  return location.pathname === '/watch' || location.pathname.startsWith('/shorts/');
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
  button.textContent = 'Transcript';
  button.title = 'Open the transcript panel (Alt+Shift+T)';
  // Inline styles rather than a stylesheet: YouTube's own classes churn, and a
  // handful of declarations is cheaper than tracking their design system.
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

  button.addEventListener('click', () => send({ type: 'YTX_OPEN_PANEL' }));

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

/**
 * The action row is rendered late and re-rendered on navigation, so we watch
 * for it — debounced to one check per frame, because YouTube mutates the DOM
 * constantly and an unthrottled callback here is a measurable tax on playback.
 */
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

function seekTo(seconds: number): boolean {
  const player = document.querySelector('#movie_player') as (HTMLElement & { seekTo?: (s: number) => void }) | null;
  if (player?.seekTo) {
    player.seekTo(seconds);
    return true;
  }
  const video = document.querySelector('video');
  if (video) {
    video.currentTime = seconds;
    void video.play().catch(() => undefined);
    return true;
  }
  return false;
}

/**
 * Report the play position, so the panel can follow along.
 *
 * Pushed on a timer rather than on `timeupdate`: that event fires four times a
 * second per video element and would cross the extension boundary every time.
 * Twice a second is well inside what a reader perceives as "keeping up", and an
 * order of magnitude less traffic. Nothing is sent while paused, and nothing is
 * sent when no one is listening — `sendMessage` rejects with no receiver, and
 * that rejection is the signal to go quiet.
 */
let tickTimer: number | null = null;

function currentVideo(): HTMLVideoElement | null {
  return document.querySelector('video');
}

function startTracking(): void {
  if (tickTimer !== null) return;

  tickTimer = self.setInterval(() => {
    const video = currentVideo();
    if (!video || video.paused || Number.isNaN(video.currentTime)) return;

    // `send` retires the script if the extension has gone; the panel simply
    // closing is a rejected promise, which is swallowed there too.
    send({ type: 'YTX_TIME', seconds: video.currentTime });
  }, 500);
}

function stopTracking(): void {
  if (tickTimer === null) return;
  self.clearInterval(tickTimer);
  tickTimer = null;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === 'YTX_SEEK' && typeof message.seconds === 'number') {
    sendResponse({ ok: seekTo(message.seconds) });
    return false;
  }
  if (message?.type === 'YTX_TRACK') {
    if (message.on) startTracking();
    else stopTracking();
    sendResponse({ ok: true });
    return false;
  }
  if (message?.type === 'YTX_PING') {
    sendResponse({ ok: true, url: location.href });
    return false;
  }
  return false;
});

// SPA navigation: YouTube fires this instead of reloading.
let lastUrl = location.href;

function announceNavigation(): void {
  if (orphaned || location.href === lastUrl) return;
  lastUrl = location.href;
  injectButton();
  send({ type: 'YTX_NAVIGATED', url: location.href });
}

// The event is dispatched on document and reaches window by bubbling, but
// YouTube has moved it before — listening in both places costs nothing, and the
// URL guard above makes the duplicate harmless.
document.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('yt-navigate-finish', announceNavigation);
window.addEventListener('popstate', announceNavigation);

injectButton();
watchForActionRow();
