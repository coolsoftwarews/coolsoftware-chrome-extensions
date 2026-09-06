/**
 * Runs on every YouTube page. Three jobs, all read-only (PRD §6):
 *   1. answer the panel's "what's loaded right now" question
 *   2. trigger YouTube's own lazy-load on request, then report what mounted
 *   3. notify the panel when a SPA navigation changes which video is open
 *
 * No code path here writes to the page beyond scrolling it — no click
 * simulation, no form submission, nothing that could be mistaken for the
 * user acting. That is a permanent property of this extension, not a V1
 * limit (see PRIVACY.md, "What this extension will never do").
 */

import { scanAll, readVideoMeta, triggerLoadMore, scrollToComment } from './scan';
import { PanelState } from './types';
import { isWatchPage } from './url';

function buildState(): PanelState {
  const supported = isWatchPage(location.href);
  if (!supported) {
    return {
      supported: false,
      meta: { videoId: null, title: null, channel: null },
      commentsDisabled: false,
      comments: [],
      declaredTotalText: null,
    };
  }

  const { comments, commentsDisabled, declaredTotalText } = scanAll();
  return { supported: true, meta: readVideoMeta(), commentsDisabled, comments, declaredTotalText };
}

function notifyPanel(): void {
  void chrome.runtime.sendMessage({ type: 'YCD_STATE_CHANGED' }).catch(() => undefined);
}

/**
 * Waits for the comments section to grow (or a timeout) after triggering a
 * scroll, so the panel gets the freshly-mounted comments instead of racing
 * YouTube's own network request. Observes transiently only — no persistent
 * background polling (PRD §6: foreground only).
 */
function waitForGrowth(previousCount: number, timeoutMs = 2500): Promise<void> {
  return new Promise(resolve => {
    const section = document.querySelector('ytd-comments#comments, ytd-comments');
    if (!section) {
      resolve();
      return;
    }

    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      clearTimeout(timer);
      resolve();
    };

    const observer = new MutationObserver(() => {
      const count = section.querySelectorAll('ytd-comment-thread-renderer').length;
      if (count > previousCount) {
        // Give the batch a moment to fully settle rather than firing on the first node.
        window.setTimeout(finish, 300);
      }
    });
    observer.observe(section, { childList: true, subtree: true });

    const timer = window.setTimeout(finish, timeoutMs);
  });
}

let lastVideoId: string | null = null;

function currentVideoId(): string | null {
  try {
    return new URL(location.href).searchParams.get('v');
  } catch {
    return null;
  }
}

function watchNavigation(): void {
  lastVideoId = currentVideoId();
  window.setInterval(() => {
    const next = currentVideoId();
    if (next === lastVideoId) return;
    lastVideoId = next;
    notifyPanel();
  }, 700);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message?.type) {
    case 'YCD_GET_STATE':
      sendResponse(buildState());
      return false;

    case 'YCD_LOAD_MORE': {
      const before = scanAll().comments.length;
      const triggered = triggerLoadMore();
      if (!triggered) {
        sendResponse(buildState());
        return false;
      }
      void waitForGrowth(before).then(() => sendResponse(buildState()));
      return true;
    }

    case 'YCD_SCROLL_TO':
      sendResponse({ ok: scrollToComment(message.id) });
      return false;

    default:
      return false;
  }
});

if (window.top === window) {
  watchNavigation();
}
