/**
 * URL/id parsing — pure, no chrome.*, so both content.ts, panel.ts and
 * scripts/selftest.mjs can use it without a browser (PRD §5: the video id is
 * one of exactly two inputs this whole product reads).
 */
export function isYouTubeUrl(raw: string | undefined): boolean {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return /(^|\.)youtube\.com$/i.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The video id from a YouTube URL, or null when the page isn't a single
 * video (a channel page, the homepage, search results…). Supports the two
 * shapes a viewer can land a "+ Note" click on: `/watch?v=` and `/live/{id}`.
 * Shorts are deliberately out of PRD-29's scope, but `/shorts/{id}` is parsed
 * anyway since it costs nothing and a viewer clicking the shortcut there
 * should still get a sensible id rather than null.
 */
export function extractVideoId(raw: string | undefined): string | null {
  if (!isYouTubeUrl(raw)) return null;
  const url = new URL(raw as string);

  const v = url.searchParams.get('v');
  if (v && /^[\w-]{6,}$/.test(v)) return v;

  const liveMatch = url.pathname.match(/^\/live\/([\w-]{6,})/);
  if (liveMatch) return liveMatch[1];

  const shortsMatch = url.pathname.match(/^\/shorts\/([\w-]{6,})/);
  if (shortsMatch) return shortsMatch[1];

  return null;
}

/** The Markdown/CSV export's clickable jump link (PRD §4). Whole seconds —
 *  YouTube's `t=` param doesn't need sub-second precision to be useful. */
export function youtubeTimestampUrl(videoId: string, seconds: number): string {
  return `https://www.youtube.com/watch?v=${videoId}&t=${Math.max(0, Math.floor(seconds))}s`;
}
