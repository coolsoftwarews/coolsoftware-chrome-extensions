/** Screen Capture — tuning constants. */

/** Chrome's hard canvas dimension limit. Anything past this is truncated. */
export const MAX_CANVAS_DIMENSION = 32767;

/** How long to let the page settle after a scroll before grabbing a frame. */
export const SCROLL_SETTLE_MS = 220;

/** Upper bound on waiting for lazy-loaded content per frame. */
export const LAZY_LOAD_TIMEOUT_MS = 1200;

/**
 * captureVisibleTab is rate-limited (roughly 2/sec). Staying just above the
 * limit is the difference between a 20k-pixel page taking 12s and failing.
 */
export const CAPTURE_THROTTLE_MS = 520;

export const DEFAULT_JPEG_QUALITY = 0.92;

/** Pages we can never capture — surfaced as a plain message, not an error. */
export const BLOCKED_URL_PREFIXES = [
  'chrome://',
  'chrome-extension://',
  'edge://',
  'about:',
  'devtools://',
  'https://chromewebstore.google.com/',
  'https://chrome.google.com/webstore',
];

export function blockedReason(url: string | undefined): string | null {
  if (!url) return "This page can't be captured.";
  if (BLOCKED_URL_PREFIXES.some((p) => url.startsWith(p))) {
    return "Chrome blocks extensions on this page. Try it on a regular website.";
  }
  if (url.endsWith('.pdf')) {
    return "Chrome's PDF viewer can't be captured. Use the PDF's own download instead.";
  }
  return null;
}
