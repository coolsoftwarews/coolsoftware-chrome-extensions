/**
 * The DOM half: finding posts/Reels on the page and reading whatever Instagram
 * has rendered for them (PRD §6 — "only what Instagram has rendered for the
 * logged-in user in the current tab"). No API calls, no background crawling.
 *
 * Instagram ships obfuscated, frequently-changing class names, so every
 * selector here is a best-effort heuristic with a fallback, and every field is
 * optional — a field Instagram didn't render becomes null/empty rather than
 * throwing (PRD §8: "posts with no visible view count"). This file is
 * DOM-bound and cannot be checked headlessly; it is covered by the manual
 * checklist in README.md, the same split WebHighlighter uses for anchor.ts.
 */

import { MediaType, RawCapture } from './types';

const POST_LINK_RE = /\/(p|reel)\/([^/?#]+)/;

export function mediaTypeFromUrl(url: string): MediaType {
  return /\/reel\//.test(url) ? 'reel' : 'post';
}

/** True for any element/link that points at a single post or Reel. */
export function isPostUrl(href: string | null | undefined): boolean {
  return !!href && POST_LINK_RE.test(href);
}

/** Grid anchors on a profile grid, explore page or hashtag page. */
export function findGridAnchors(root: ParentNode): HTMLAnchorElement[] {
  const anchors = Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href]'));
  return anchors.filter(a => isPostUrl(a.getAttribute('href')));
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/** Nearby profile link text (e.g. "/username/") — used to guess the handle. */
function handleFromProfileLink(root: ParentNode): string {
  const link = root.querySelector<HTMLAnchorElement>('a[href^="/"][role="link"], header a[href^="/"]');
  const href = link?.getAttribute('href') ?? '';
  const match = href.match(/^\/([A-Za-z0-9._]+)\/?$/);
  return match ? match[1] : '';
}

/** Best-effort caption: the longest text block inside the header/first section. */
function guessCaption(root: ParentNode): string {
  const candidates = Array.from(root.querySelectorAll<HTMLElement>('h1, span, div'))
    .map(el => text(el))
    .filter(t => t.length > 3);
  if (!candidates.length) return '';
  return candidates.reduce((longest, current) => (current.length > longest.length ? current : longest), '');
}

function findCounts(root: ParentNode): { views: string | null; likes: string | null; comments: string | null } {
  const bySection = (label: RegExp): string | null => {
    const el = Array.from(root.querySelectorAll<HTMLElement>('[aria-label], span, a')).find(node =>
      label.test((node.getAttribute('aria-label') ?? '') + ' ' + text(node))
    );
    return el ? (el.getAttribute('aria-label') ?? text(el)) : null;
  };
  return {
    views: bySection(/view/i),
    likes: bySection(/like/i),
    comments: bySection(/comment/i),
  };
}

function findPostDate(root: ParentNode): string {
  const time = root.querySelector('time');
  return time?.getAttribute('datetime') || text(time);
}

/** Counts carousel dots/steps when the post is a multi-image carousel. */
function findCarouselCount(root: ParentNode): number | null {
  const dots = root.querySelectorAll('[role="tablist"] [role="button"], ul li button[aria-label^="Go to"]');
  if (dots.length > 1) return dots.length;

  const status = Array.from(root.querySelectorAll<HTMLElement>('[aria-label]')).find(el =>
    /^\d+\s*\/\s*\d+$/.test((el.getAttribute('aria-label') ?? '').trim())
  );
  if (status) {
    const match = (status.getAttribute('aria-label') ?? '').match(/\/\s*(\d+)/);
    if (match) return Number(match[1]);
  }
  return null;
}

function findThumbnailElement(root: ParentNode): HTMLImageElement | HTMLVideoElement | null {
  return (
    root.querySelector<HTMLImageElement>('article img, [role="dialog"] img, img') ??
    root.querySelector<HTMLVideoElement>('article video, [role="dialog"] video, video')
  );
}

/**
 * Resizes and re-encodes a thumbnail to a size-capped data URI (PRD §6: ~320px
 * WebP, budgeted so a 500-item library fits in chrome.storage.local). Instagram's
 * CDN does not grant cross-origin pixel access, so drawing the image onto a
 * canvas commonly throws a SecurityError — that failure is expected, not a bug,
 * and this function falls back to the remote URL exactly as PRD §6 describes.
 */
export async function captureThumbnail(
  el: HTMLImageElement | HTMLVideoElement | null,
  maxDim = 320,
  maxBytes = 45_000
): Promise<{ dataUri: string | null; remoteUrl: string }> {
  const remoteUrl = el instanceof HTMLVideoElement ? el.poster || el.currentSrc || '' : el?.currentSrc || el?.src || '';
  if (!el) return { dataUri: null, remoteUrl };

  const naturalWidth = el instanceof HTMLImageElement ? el.naturalWidth : el.videoWidth;
  const naturalHeight = el instanceof HTMLImageElement ? el.naturalHeight : el.videoHeight;
  if (!naturalWidth || !naturalHeight) return { dataUri: null, remoteUrl };

  const scale = Math.min(1, maxDim / Math.max(naturalWidth, naturalHeight));
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));

  try {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { dataUri: null, remoteUrl };
    ctx.drawImage(el, 0, 0, width, height);

    // Step quality down until the encoded size fits the per-item budget.
    for (const quality of [0.8, 0.6, 0.4, 0.25]) {
      const dataUri = canvas.toDataURL('image/webp', quality);
      // Rough byte estimate from base64 length (4 chars ≈ 3 bytes).
      const bytes = (dataUri.length * 3) / 4;
      if (bytes <= maxBytes) return { dataUri, remoteUrl };
    }
    return { dataUri: null, remoteUrl };
  } catch {
    // Tainted canvas (no CORS headers from Instagram's CDN) or an element that
    // vanished mid-capture — either way, fall back rather than fail the save.
    return { dataUri: null, remoteUrl };
  }
}

export interface DomCapture extends Omit<RawCapture, 'thumbnailDataUri' | 'thumbnailRemoteUrl'> {
  thumbnailEl: HTMLImageElement | HTMLVideoElement | null;
}

/**
 * Scrapes whatever is available around `root` for a single post/Reel — the
 * detail view (permalink page or open dialog) or, with far fewer fields, a
 * grid tile. `fallbackHandle` covers the common case where the handle only
 * appears once, in a page header outside the card being scraped (e.g. a
 * profile grid).
 */
export function scrapePost(root: ParentNode, postUrl: string, fallbackHandle = ''): DomCapture {
  const counts = findCounts(root);
  return {
    postUrl,
    creatorHandle: handleFromProfileLink(root) || fallbackHandle,
    captionRaw: guessCaption(root),
    postDateRaw: findPostDate(root),
    viewsRaw: counts.views,
    likesRaw: counts.likes,
    commentsRaw: counts.comments,
    carouselCount: findCarouselCount(root),
    mediaType: mediaTypeFromUrl(postUrl),
    thumbnailEl: findThumbnailElement(root),
  };
}

/** Profile handle from a `/username/` page, when the current page is a profile. */
export function handleFromLocation(pathname: string): string {
  const match = pathname.match(/^\/([A-Za-z0-9._]+)\/?$/);
  const reserved = new Set(['p', 'reel', 'reels', 'explore', 'direct', 'stories', 'accounts']);
  if (match && !reserved.has(match[1].toLowerCase())) return match[1];
  return '';
}
