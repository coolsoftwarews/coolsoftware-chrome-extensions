/**
 * Content script. Two independent jobs that happen to live in the same file:
 *
 * 1. Hiding — sets one data attribute on <html> per toggle in Settings.
 *    content.css (declared in content_scripts, loaded at document_start)
 *    does the actual hiding via attribute selectors. Because the attribute
 *    lives on <html> (not re-applied per rendered row), it survives
 *    YouTube's own SPA navigation for free — there is deliberately no
 *    'yt-navigate-finish' listener anywhere in this file for the hiding
 *    feature, because there is nothing that needs re-applying.
 *
 * 2. The session timer's tab-side half — decides when *this* tab counts as
 *    "being watched" (PRD §5: visible AND focused) and opens/closes a port
 *    to the background service worker accordingly. background.ts is the
 *    only place that actually advances the clock; this file only reports
 *    watch/not-watch, which is what makes the multi-tab dedup in PRD §7
 *    possible at all — see background.ts's own comment.
 */
import { shouldRemind } from './session';
import { mergeSettings } from './settings';
import { bumpMetric, readSettings } from './storage';
import type { Settings } from './types';

const PORT_NAME = 'ft-watch';
const REMINDER_CHECK_INTERVAL_MS = 15_000;

type HideKey = 'hideRecommendations' | 'hideHomeFeed' | 'hideShorts' | 'hideEndScreen' | 'hideComments';

const ATTR_MAP: Record<HideKey, string> = {
  hideRecommendations: 'data-ft-hide-recs',
  hideHomeFeed: 'data-ft-hide-home',
  hideShorts: 'data-ft-hide-shorts',
  hideEndScreen: 'data-ft-hide-endscreen',
  hideComments: 'data-ft-hide-comments',
};

function applyToggleAttrs(settings: Settings): void {
  const root = document.documentElement;
  (Object.keys(ATTR_MAP) as HideKey[]).forEach((key) => {
    root.toggleAttribute(ATTR_MAP[key], Boolean(settings[key]));
  });
}

/* ── Session timer: watch-state → port lifecycle ────────────────────── */

let port: chrome.runtime.Port | null = null;
let watchStartedAt: number | null = null;
let reminderShownThisStreak = false;
let reminderThresholdMs: number | null = null;
let reminderCheckId: ReturnType<typeof setInterval> | null = null;

function isWatching(): boolean {
  return document.visibilityState === 'visible' && document.hasFocus();
}

function openPort(): void {
  if (port) return;
  try {
    port = chrome.runtime.connect({ name: PORT_NAME });
    port.onDisconnect.addListener(() => {
      // The service worker was recycled or the extension reloaded — clear
      // our reference so the next watch-state change reconnects cleanly.
      port = null;
    });
  } catch {
    // Extension context can be invalidated mid-navigation (reload/update);
    // never let that throw into YouTube's own page.
    port = null;
  }
}

function closePort(): void {
  if (!port) return;
  try {
    port.disconnect();
  } catch {
    /* already gone */
  }
  port = null;
}

function checkReminder(): void {
  if (watchStartedAt === null) return;
  const continuousMs = Date.now() - watchStartedAt;
  if (shouldRemind(continuousMs, reminderThresholdMs, reminderShownThisStreak)) {
    reminderShownThisStreak = true;
    showReminderBanner(continuousMs);
    void bumpMetric('reminder.shown');
  }
}

function updateWatchState(): void {
  const watching = isWatching();
  if (watching && watchStartedAt === null) {
    watchStartedAt = Date.now();
    reminderShownThisStreak = false;
    openPort();
    if (reminderCheckId === null) reminderCheckId = setInterval(checkReminder, REMINDER_CHECK_INTERVAL_MS);
  } else if (!watching && watchStartedAt !== null) {
    watchStartedAt = null;
    closePort();
    if (reminderCheckId !== null) {
      clearInterval(reminderCheckId);
      reminderCheckId = null;
    }
  }
}

document.addEventListener('visibilitychange', updateWatchState);
window.addEventListener('focus', updateWatchState);
window.addEventListener('blur', updateWatchState);
window.addEventListener('pagehide', closePort);

/* ── Gentle end-of-session reminder — a small, dismissible, non-blocking toast ─ */

let bannerHost: HTMLElement | null = null;

function formatMinutes(ms: number): string {
  return `${Math.round(ms / 60_000)} minutes`;
}

function showReminderBanner(continuousMs: number): void {
  if (bannerHost) return; // one at a time
  const host = document.createElement('div');
  host.setAttribute('data-ft-reminder-host', '');
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host { all: initial; }
    .toast {
      position: fixed; right: 16px; bottom: 16px; z-index: 2147483647;
      display: flex; align-items: center; gap: 12px;
      background: #0f0f0f; color: #fff; border: 1px solid #303030;
      border-radius: 10px; padding: 12px 14px; max-width: 320px;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      box-shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
    }
    .msg { flex: 1; }
    button {
      background: transparent; color: #aaa; border: 1px solid #4a4a4a; border-radius: 6px;
      padding: 5px 9px; font: inherit; cursor: pointer;
    }
    button:hover, button:focus-visible { color: #fff; border-color: #8a8a8a; }
    button:focus-visible { outline: 2px solid #3ea6ff; outline-offset: 1px; }
  `;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  const msg = document.createElement('span');
  msg.className = 'msg';
  msg.textContent = `You've been on YouTube for ${formatMinutes(continuousMs)}.`;

  const dismiss = document.createElement('button');
  dismiss.type = 'button';
  dismiss.textContent = 'Dismiss';
  dismiss.addEventListener('click', () => {
    void bumpMetric('reminder.dismissed');
    removeReminderBanner();
  });

  toast.append(msg, dismiss);
  shadow.append(style, toast);
  document.body.appendChild(host);
  bannerHost = host;

  // Never blocking, and never sticks around forever if ignored.
  setTimeout(removeReminderBanner, 15_000);
}

function removeReminderBanner(): void {
  bannerHost?.remove();
  bannerHost = null;
}

/* ── Live settings updates from the popup, no messaging needed ─────── */

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['ft:settings']) return;
  const settings = mergeSettings(changes['ft:settings'].newValue as Partial<Settings> | undefined);
  applyToggleAttrs(settings);
  reminderThresholdMs = settings.reminderMinutes ? settings.reminderMinutes * 60_000 : null;
});

/* ── Boot ────────────────────────────────────────────────────────────── */

async function init(): Promise<void> {
  const settings = await readSettings();
  applyToggleAttrs(settings);
  reminderThresholdMs = settings.reminderMinutes ? settings.reminderMinutes * 60_000 : null;
  updateWatchState();
}

void init();
