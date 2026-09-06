/**
 * Pure string parsing — no DOM, no chrome.* — so scripts/selftest.mjs can
 * check every one of these headlessly. The DOM-bound half that calls into
 * these lives in scrape.ts. Ported from XConversationSaver's parse.ts
 * (PRD-13), which this product shares a platform and several idioms with.
 */

/** Extracts the numeric status id from a post URL or permalink path. */
export function parseStatusId(url: string | null | undefined): string | null {
  if (!url) return null;
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

/** Strips a leading "@" and lowercases, so the same person is always one key. */
export function normalizeHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@/, '').toLowerCase();
}

export function canonicalStatusUrl(handle: string, id: string): string {
  const normalized = normalizeHandle(handle);
  return normalized ? `https://x.com/${normalized}/status/${id}` : `https://x.com/i/status/${id}`;
}

/** Collapses accidental whitespace X's markup introduces without flattening
 *  intentional line breaks in the post's own text. */
export function cleanText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** True for a tab whose content script this extension is allowed to talk to. */
export function isXUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    return /(^|\.)x\.com$/.test(parsed.hostname) || /(^|\.)twitter\.com$/.test(parsed.hostname);
  } catch {
    return false;
  }
}

/** Media count → a plain-language label. Never claims a type it can't tell
 *  apart (a mixed photo/video count still just gets counted). */
export function mediaLabel(count: number, hasVideo: boolean): string {
  if (count <= 0) return '';
  if (count === 1) return hasVideo ? '1 video' : '1 image';
  return hasVideo ? `${count} media items` : `${count} images`;
}
