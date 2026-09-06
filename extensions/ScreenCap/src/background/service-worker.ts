/**
 * Screen Capture — service worker.
 *
 * Owns the whole capture pipeline: inject the page agent, measure, scroll,
 * grab frames, stitch them offscreen, then hand the result to the editor tab.
 */

import { Msg, type CaptureMode, type CaptureMeta, type CapturePayload, type PageMeasurement, type Rect, type Tile } from '../shared/messages';
import { CAPTURE_THROTTLE_MS, MAX_CANVAS_DIMENSION, blockedReason } from '../shared/constants';
import { track } from '../shared/analytics';

/**
 * Finished captures waiting for their editor tab to ask for them. Held in
 * memory rather than storage so a multi-megabyte screenshot never touches
 * disk — the editor requests it within a second of the tab opening.
 */
const pending = new Map<string, CapturePayload>();
let captureInFlight = false;

// ── Entry points ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: { action: string; mode?: CaptureMode; id?: string }, _sender, sendResponse) => {
  if (message.action === Msg.START_CAPTURE) {
    runCapture(message.mode ?? 'fullPage')
      .then(() => sendResponse({ ok: true }))
      .catch((error: Error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message.action === Msg.GET_CAPTURE && message.id) {
    const payload = pending.get(message.id);
    pending.delete(message.id);
    sendResponse(payload ?? null);
    return false;
  }

  return false;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'capture-full-page') {
    void runCapture('fullPage');
  }
});

// ── Orchestration ─────────────────────────────────────────────

async function runCapture(mode: CaptureMode): Promise<void> {
  if (captureInFlight) throw new Error('A capture is already running.');

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("This page can't be captured.");

  const blocked = blockedReason(tab.url);
  if (blocked) {
    await track('capture.fail.blocked-page');
    throw new Error(blocked);
  }

  captureInFlight = true;
  try {
    const result =
      mode === 'fullPage' ? await captureFullPage(tab)
      : mode === 'selectedRegion' ? await captureRegion(tab)
      : await captureVisible(tab);

    await track(`capture.${mode}`);
    await openEditor(result);
    notify({ action: Msg.CAPTURE_DONE });
  } catch (error) {
    const messageText = error instanceof Error ? error.message : 'Capture failed.';
    await track('capture.fail.runtime');
    notify({ action: Msg.CAPTURE_FAILED, error: messageText });
    throw error;
  } finally {
    captureInFlight = false;
    await closeOffscreen();
  }
}

// ── Capture modes ─────────────────────────────────────────────

async function captureVisible(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  const dataUrl = await grabFrame(tab.windowId!);
  const size = await imageSize(dataUrl);
  return payloadFor(dataUrl, { mode: 'visibleArea', ...tabMeta(tab), ...size });
}

async function captureRegion(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  await injectAgent(tab.id!);
  const { rect, devicePixelRatio } = (await send(tab.id!, { action: Msg.SELECT_REGION })) as {
    rect: Rect | null;
    devicePixelRatio: number;
  };
  if (!rect) throw new Error('Selection cancelled.');

  const frame = await grabFrame(tab.windowId!);
  const dpr = devicePixelRatio || 1;
  const cropped = await inOffscreen<{ dataUrl: string }>({
    action: 'CROP',
    dataUrl: frame,
    rect: {
      x: Math.round(rect.x * dpr),
      y: Math.round(rect.y * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
    },
  });

  return payloadFor(cropped.dataUrl, {
    mode: 'selectedRegion',
    ...tabMeta(tab),
    width: Math.round(rect.width * dpr),
    height: Math.round(rect.height * dpr),
  });
}

async function captureFullPage(tab: chrome.tabs.Tab): Promise<CapturePayload> {
  await injectAgent(tab.id!);
  const page = (await send(tab.id!, { action: Msg.MEASURE_PAGE })) as PageMeasurement;

  const dpr = page.devicePixelRatio || 1;
  const canvasWidth = Math.round(page.viewportWidth * dpr);
  const fullHeight = Math.round(page.scrollHeight * dpr);
  const canvasHeight = Math.min(fullHeight, MAX_CANVAS_DIMENSION);
  const truncated = fullHeight > canvasHeight;

  // Step by a whole viewport. Frames are placed at the scroll position the
  // page actually landed on, so the final short frame overlaps the previous
  // one and overwrites it cleanly instead of leaving a seam.
  const stepCss = Math.max(1, page.viewportHeight - 1);
  const frameCount = Math.max(1, Math.ceil((canvasHeight / dpr) / stepCss));

  const tiles: Tile[] = [];
  const seenPositions = new Set<number>();

  try {
    for (let i = 0; i < frameCount; i++) {
      notify({ action: Msg.CAPTURE_PROGRESS, current: i + 1, total: frameCount });

      const { actualY } = (await send(tab.id!, { action: Msg.SCROLL_TO, y: i * stepCss })) as {
        actualY: number;
      };

      // Reached the bottom early (or the page shrank) — nothing new to grab.
      if (i > 0 && seenPositions.has(actualY)) break;
      seenPositions.add(actualY);

      if (i === 1) {
        // Keep the real header on the first frame only; from here on it would
        // repeat down the stitch.
        await send(tab.id!, { action: Msg.HIDE_FIXED });
      }

      if (i > 0) await sleep(CAPTURE_THROTTLE_MS);
      const dataUrl = await grabFrame(tab.windowId!);

      tiles.push({
        dataUrl,
        y: Math.round(actualY * dpr),
        height: Math.round(page.viewportHeight * dpr),
      });
    }
  } finally {
    await send(tab.id!, { action: Msg.RESTORE_FIXED }).catch(() => undefined);
    await send(tab.id!, { action: Msg.SCROLL_TO, y: 0 }).catch(() => undefined);
  }

  const stitched = await inOffscreen<{ dataUrl: string }>({
    action: 'STITCH',
    tiles,
    width: canvasWidth,
    height: canvasHeight,
  });

  return payloadFor(stitched.dataUrl, {
    mode: 'fullPage',
    ...tabMeta(tab),
    width: canvasWidth,
    height: canvasHeight,
    truncated,
  });
}

// ── Plumbing ──────────────────────────────────────────────────

async function injectAgent(tabId: number): Promise<void> {
  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content/page-agent.js'],
  });

  // executeScript resolves before the listener is necessarily wired up.
  for (let attempt = 0; attempt < 10; attempt++) {
    try {
      await send(tabId, { action: Msg.PING });
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error("This page can't be captured.");
}

function send(tabId: number, message: unknown): Promise<unknown> {
  return chrome.tabs.sendMessage(tabId, message);
}

async function grabFrame(windowId: number): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

/** Runs a canvas job in the offscreen document, creating it on first use. */
async function inOffscreen<T>(job: Record<string, unknown>): Promise<T> {
  const url = chrome.runtime.getURL('offscreen/offscreen.html');
  const existing = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (existing.length === 0) {
    await chrome.offscreen.createDocument({
      url,
      reasons: [chrome.offscreen.Reason.DOM_PARSER],
      justification: 'Canvas compositing for full-page screenshots',
    });
  }

  const response = (await chrome.runtime.sendMessage({ ...job, target: 'offscreen' })) as
    | (T & { error?: string })
    | undefined;
  if (!response) throw new Error('Image compositing failed.');
  if (response.error) throw new Error(response.error);
  return response;
}

async function closeOffscreen(): Promise<void> {
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    // No document open — nothing to do.
  }
}

async function imageSize(dataUrl: string): Promise<{ width: number; height: number }> {
  const blob = await (await fetch(dataUrl)).blob();
  const bitmap = await createImageBitmap(blob);
  const size = { width: bitmap.width, height: bitmap.height };
  bitmap.close();
  return size;
}

function tabMeta(tab: chrome.tabs.Tab) {
  return { sourceUrl: tab.url ?? '', sourceTitle: tab.title ?? 'Capture' };
}

function payloadFor(imageDataUrl: string, meta: CaptureMeta): CapturePayload {
  return { id: crypto.randomUUID(), imageDataUrl, meta };
}

async function openEditor(payload: CapturePayload): Promise<void> {
  pending.set(payload.id, payload);
  await chrome.tabs.create({
    url: chrome.runtime.getURL(`src/editor/editor.html?id=${payload.id}`),
  });
  // Don't leak a capture forever if the editor tab is closed before it loads.
  setTimeout(() => pending.delete(payload.id), 60_000);
}

/**
 * Best-effort broadcast to the popup, which is often already closed — and
 * for failures, a badge, since the keyboard shortcut has no popup at all.
 */
function notify(message: Record<string, unknown>): void {
  chrome.runtime.sendMessage(message).catch(() => undefined);

  if (message.action === Msg.CAPTURE_FAILED) {
    void chrome.action.setBadgeBackgroundColor({ color: '#b91c1c' });
    void chrome.action.setBadgeText({ text: '!' });
    void chrome.action.setTitle({ title: `Screen Capture — ${message.error}` });
    setTimeout(clearBadge, 8000);
  } else if (message.action === Msg.CAPTURE_DONE) {
    clearBadge();
  }
}

function clearBadge(): void {
  void chrome.action.setBadgeText({ text: '' });
  void chrome.action.setTitle({ title: 'Screen Capture' });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
