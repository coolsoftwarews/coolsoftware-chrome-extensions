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
  const header = root.querySelector('header');
  if (!header) return null;
  const candidates = Array.from(header.querySelectorAll<HTMLAnchorElement>('a[href]'));
  for (const anchor of candidates) {
    const handle = handleFromHref(anchor.getAttribute('href'));
    if (handle) return handle;
  }
  return null;
}

/** All post/Reel containers currently rendered on the page (feed, an open
 *  dialog, a permalink page) — never a background fetch, only whatever
 *  Instagram already put in the DOM (PRD §6: "foreground only"). */
export function findPostContainers(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('article'));
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
  const header = root.querySelector('header');
  const sections = Array.from(root.querySelectorAll('section'));
  const withIcon = sections.find(sec => sec.querySelector('svg'));
  return withIcon ?? header?.nextElementSibling ?? null;
}
