/**
 * The DOM half, and the single most load-bearing file in this extension
 * (PRD §5). Two functions here decide whether a Save button is allowed to
 * exist at all:
 *
 *   - readLoggedInHandle()  — the signed-in account's own handle, read from
 *     Instagram's own nav (the profile icon/link in the app's own chrome),
 *     never from a cached value, a cookie, or the current URL.
 *   - readPostAuthorHandle() — a single post's author handle, read from
 *     that post's own header, scoped to the post's own container so it can
 *     never pick up a handle from a different post on the page.
 *
 * content.ts calls both fresh for every post it considers and only renders
 * Save when parse.ts#handlesMatch says they agree. Selector drift here must
 * make a function return null, never a guess: a null read is what makes the
 * gate fail closed (PRD §5 — "no post gets a Save button").
 *
 * Instagram ships obfuscated, frequently-changing class names, so every
 * selector below is a best-effort heuristic with a fallback. This file is
 * DOM-bound and cannot be checked headlessly; it is covered by the manual
 * checklist in README.md, the same split every Instagram/X extension in
 * this portfolio uses for its scrape.ts (see InstagramResearchSaver's and
 * XBookmarkOrganizer's).
 */

import { isProfilePath } from './parse';
import { MediaKind } from './types';

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

/** Extracts a bare `/handle/` segment from a same-origin href, or '' if the
 *  path isn't a profile link (a post link, a reserved app route, etc.). */
function handleFromHref(href: string | null | undefined): string {
  if (!href) return '';
  let pathname = href;
  try {
    pathname = new URL(href, location.href).pathname;
  } catch {
    /* href was already a bare path — use it as-is */
  }
  const match = pathname.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
  if (!match) return '';
  return isProfilePath(match[1]) ? match[1] : '';
}

/**
 * The logged-in account's own handle, read from Instagram's own nav.
 * Returns null the moment the read isn't confident — no nav found, no
 * candidate link looks like the "Profile" entry — rather than falling back
 * to a guess. PRD §5: "If the logged-in handle can't be read at all
 * (selector drift, logged out), no post gets a Save button."
 */
export function readLoggedInHandle(root: ParentNode = document): string | null {
  const nav = root.querySelector('nav') ?? root.querySelector('[role="navigation"]');
  if (!nav) return null;

  const candidates = Array.from(nav.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of candidates) {
    const handle = handleFromHref(anchor.getAttribute('href'));
    if (!handle) continue;

    const img = anchor.querySelector<HTMLImageElement>('img[alt]');
    const altText = img?.getAttribute('alt') ?? '';
    const ariaLabel = anchor.getAttribute('aria-label') ?? '';
    const looksLikeProfileEntry =
      /profile (photo|picture)/i.test(altText) || /profile/i.test(ariaLabel) || /profile/i.test(text(anchor));

    if (looksLikeProfileEntry) return handle;
  }
  return null;
}

/**
 * A post's author handle, read from that post's own header — the element
 * Instagram renders at the top of every post/Reel card carrying the
 * author's name/link. `root` must be the post's own container (an
 * `<article>`); the search is scoped to its `<header>` so it never reads a
 * handle belonging to a different post on the same page.
 */
export function readPostAuthorHandle(root: ParentNode): string | null {
  // The photo-grid layout renders the byline inside a <header>; Reels often
  // don't have one, so fall back to the container itself. handleFromHref
  // still only accepts profile-shaped paths (isProfilePath), and this reads
  // the *first* matching link in document order — the byline is always the
  // first profile link Instagram renders in either layout — so widening the
  // search scope doesn't widen what counts as a match, only where it looks.
  const scope = root.querySelector('header') ?? root;
  const candidates = Array.from(scope.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of candidates) {
    const handle = handleFromHref(anchor.getAttribute('href'));
    if (handle) return handle;
  }
  return null;
}

/**
 * The single Reel tile actually on screen, in a feed that preloads several
 * neighbouring Reels into the DOM at once for smooth scrolling (confirmed:
 * naively falling back to the whole `<main>` region pulled in media and
 * controls from multiple adjacent Reels, not just the visible one). Anchors
 * on whichever `<video>` is actually playing (virtualized neighbours are
 * paused/off-screen), then climbs to the first ancestor roughly one
 * viewport tall — this vertical feed snaps one full-height tile at a time,
 * so that height is a reliable tile boundary where no class name is. */
function findActiveReelTile(root: ParentNode): HTMLElement | null {
  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video'));
  const active =
    videos.find(v => !v.paused && v.readyState > 0) ??
    videos.find(v => {
      const rect = v.getBoundingClientRect();
      return rect.top < window.innerHeight && rect.bottom > 0;
    });
  if (!active) return null;

  let node: HTMLElement = active;
  for (let i = 0; i < 8 && node.parentElement; i++) {
    node = node.parentElement;
    if (node.getBoundingClientRect().height >= window.innerHeight * 0.85) return node;
  }
  return active.parentElement ?? active;
}

/** All post/Reel containers currently rendered on the page (feed, an open
 *  dialog, a permalink page) — never a background fetch, only whatever
 *  Instagram already put in the DOM (PRD §6: "foreground only").
 *
 *  The photo-grid layout wraps every post in `<article>`; Reels don't
 *  reliably get one, so this falls back to just the one tile actually on
 *  screen (findActiveReelTile) — never the whole page, which would merge
 *  several preloaded Reels' media/controls together. */
export function findPostContainers(root: ParentNode = document): HTMLElement[] {
  const articles = Array.from(root.querySelectorAll<HTMLElement>('article'));
  if (articles.length) return articles;

  const tile = findActiveReelTile(root);
  return tile ? [tile] : [];
}

export interface MediaItem {
  url: string;
  kind: MediaKind;
  /** 1-based position within the post — a single image/video is always 1. */
  index: number;
}

/**
 * The post's own media element(s) — one entry per carousel slide, or one
 * entry for a single image/video post (PRD §7: "each image offered
 * individually"). Only elements that carry a real, currently-loaded source
 * are returned; Instagram lazy-loads carousel slides the user hasn't
 * scrolled to yet, so an unseen slide may simply not be discoverable until
 * they do (documented in README's Known limits).
 */
export function findMediaItems(root: ParentNode): MediaItem[] {
  const seen = new Set<string>();
  const items: MediaItem[] = [];

  const videos = Array.from(root.querySelectorAll<HTMLVideoElement>('video'));
  for (const video of videos) {
    const url = video.currentSrc || video.src;
    if (!url || seen.has(url)) continue;
    seen.add(url);
    items.push({ url, kind: 'video', index: items.length + 1 });
  }

  if (!items.length) {
    const images = Array.from(root.querySelectorAll<HTMLImageElement>('img[src]')).filter(img => {
      const alt = img.getAttribute('alt') ?? '';
      // Excludes avatar thumbnails ("X's profile picture") and small UI icons.
      return img.naturalWidth > 100 && !/profile (photo|picture)/i.test(alt);
    });
    for (const img of images) {
      const url = img.currentSrc || img.src;
      if (!url || seen.has(url)) continue;
      seen.add(url);
      items.push({ url, kind: 'image', index: items.length + 1 });
    }
  }

  return items;
}

/** The post's action row (like/comment/share) — the Save button bar is
 *  anchored next to it, never inserted inside it. See content.ts's header
 *  comment for why nothing here writes into Instagram's own tree. */
export function findActionRow(root: ParentNode): Element | null {
  // Anchor on the actual Like control, found by its own aria-label/text
  // rather than by page position — the photo-grid's action row and the
  // Reels layout's action column sit in very different places on screen, but
  // both always render something labelled "Like"/"Unlike" (the same
  // aria-label-matching trick InstagramResearchSaver's metrics reader
  // already relies on for this exact cross-layout difference).
  const likeEl = Array.from(root.querySelectorAll<HTMLElement>('[aria-label], span, a')).find(node =>
    /like/i.test(node.getAttribute('aria-label') ?? '')
  );
  if (likeEl) return likeEl.closest('button, a, div[role="button"]') ?? likeEl;

  const header = root.querySelector('header');
  const sections = Array.from(root.querySelectorAll('section'));
  const withIcon = sections.find(sec => sec.querySelector('svg'));
  return withIcon ?? header?.nextElementSibling ?? null;
}
