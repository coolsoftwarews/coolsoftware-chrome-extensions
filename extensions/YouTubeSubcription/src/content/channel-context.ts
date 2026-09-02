/**
 * Working out which channel the current page (or a subscribe button) belongs
 * to, from the page alone. Part of the isolated selector layer: everything
 * here returns null rather than throwing.
 */

import { Channel } from '../types';
import {
  channelIdFromInitialData,
  extractInitialData,
  extractPlayerResponse,
  videoOwnerIdFromInitialData,
  videoOwnerIdFromPlayerResponse,
} from '../yt-data';

const UC_RE = /(UC[\w-]{20,24})/;

export interface PageChannel {
  id: string;
  name: string;
  handle: string | null;
  avatarUrl: string | null;
}

/** Resolves an @handle to a channel ID using the caller's cached subscriptions. */
export type HandleLookup = (handle: string) => string | null;

/**
 * Resolve the channel that a subscribe button subscribes to.
 *
 * Ordered by *how current the source is*, not by how cheap it is to read.
 * YouTube is a single-page app and does not remove the previous page's
 * `ytInitialData` script when you navigate — so a scan of script text can
 * confidently return the channel you were looking at a moment ago. That was
 * real: walking channel to channel showed each new channel wearing the
 * previous one's groups, and a refresh "fixed" it because a full load leaves
 * only one such script behind.
 *
 * So: the URL first (it is the one thing guaranteed to describe this page),
 * then live DOM, and script text last and only when scoped to this page's
 * handle.
 */
export function resolveChannel(
  near: Element | null,
  lookupHandle?: HandleLookup,
): PageChannel | null {
  const pathId = idFromPath();
  const handle = handleFromPath() ?? readHandle(near);

  const id =
    pathId ??
    (handle ? lookupHandle?.(handle) ?? null : null) ??
    idFromNearbyLink(near) ??
    idFromWatchPage() ??
    idFromMeta() ??
    idFromCanonical() ??
    idFromEmbeddedJson(handle);
  if (!id) return null;

  return {
    id,
    name: readName(near) || id,
    handle,
    avatarUrl: readAvatar(near),
  };
}

/** `/channel/UC…` states the ID outright — nothing beats that. */
function idFromPath(): string | null {
  const match = /^\/channel\/(UC[\w-]{20,24})/.exec(location.pathname);
  return match ? match[1] : null;
}

function handleFromPath(): string | null {
  const match = /^\/(@[^/?#]+)/.exec(location.pathname);
  return match ? match[1] : null;
}

/** Shape a `PageChannel` into a cache record. Stats stay unknown until a scrape. */
export function toChannel(page: PageChannel): Channel {
  return {
    id: page.id,
    name: page.name,
    handle: page.handle,
    avatarUrl: page.avatarUrl,
    subscriberText: null,
    subscriberCount: null,
    videoText: null,
    videoCount: null,
  };
}

function idFromNearbyLink(near: Element | null): string | null {
  // Walk outwards from the button: the owner block around it carries the
  // channel link, while the wider page may be about something else entirely
  // (a recommended video's channel, say).
  let scope: Element | null = near;
  for (let depth = 0; scope && depth < 6; depth++) {
    for (const a of scope.querySelectorAll<HTMLAnchorElement>('a[href*="/channel/"]')) {
      const match = UC_RE.exec(a.getAttribute('href') || '');
      if (match) return match[1];
    }
    scope = scope.parentElement;
  }
  return null;
}

/**
 * The owner of the video being watched.
 *
 * Watch pages were the hole: the path says `/watch`, the owner link beside
 * Subscribe is an `/@handle`, the microformat meta tag is long gone, canonical
 * points at the video, and the channel-page renderers this file used to read
 * are simply absent. Everything fell through and returned null — so no "Add to
 * group" button appeared on a watch page, and, worse, subscribing from one
 * never offered the group picker, because the watcher resolves the channel the
 * same way. Both worked on channel pages, which is why it went unnoticed.
 *
 * Scoped to the id in the URL: navigation leaves earlier pages' scripts behind,
 * and filing the wrong channel is worse than filing none.
 */
function idFromWatchPage(): string | null {
  if (location.pathname !== '/watch') return null;
  const videoId = new URLSearchParams(location.search).get('v');
  if (!videoId) return null;

  // Newest first — navigation appends.
  for (const script of [...document.scripts].reverse()) {
    const text = script.textContent;
    if (!text || !text.includes(videoId)) continue;

    if (text.includes('ytInitialPlayerResponse')) {
      const id = videoOwnerIdFromPlayerResponse(extractPlayerResponse(text), videoId);
      if (id) return id;
    }
    if (text.includes('ytInitialData')) {
      const id = videoOwnerIdFromInitialData(extractInitialData(text));
      if (id) return id;
    }
  }
  return null;
}

function idFromMeta(): string | null {
  for (const selector of [
    'meta[itemprop="channelId"]',
    'meta[itemprop="identifier"]',
    'meta[property="og:video:url"]',
  ]) {
    const content = document.querySelector<HTMLMetaElement>(selector)?.content ?? '';
    const match = UC_RE.exec(content);
    if (match) return match[1];
  }
  return null;
}

function idFromCanonical(): string | null {
  const href = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? '';
  const match = /\/channel\/(UC[\w-]{20,24})/.exec(href);
  return match ? match[1] : null;
}

/**
 * Last resort: read the ID out of YouTube's own bootstrap JSON.
 *
 * Parsed properly and read from the documented location, rather than
 * pattern-matched out of raw script text — the regex version returned whatever
 * channel ID appeared first, which on a single-page app is frequently the page
 * you were on a moment ago.
 *
 * Scoped to the current handle wherever we know it, because stale scripts from
 * previously-visited pages stay in the document. Newest first: navigation
 * appends, so the last script is the one describing the page you are on.
 */
function idFromEmbeddedJson(handle: string | null): string | null {
  for (const script of [...document.scripts].reverse()) {
    const text = script.textContent;
    if (!text || !text.includes('ytInitialData')) continue;
    if (handle && !text.includes(handle)) continue;

    const id = channelIdFromInitialData(extractInitialData(text));
    if (id) return id;
  }

  // Nothing here described this handle. Better to report "unknown" than to hand
  // back some other channel's ID and file the wrong channel into a group.
  return null;
}

function readName(near: Element | null): string {
  const scoped = near?.closest('ytd-video-owner-renderer, #owner, #channel-header, ytd-c4-tabbed-header-renderer');
  const candidates = [
    scoped?.querySelector('ytd-channel-name a, #channel-name a, yt-formatted-string#text'),
    document.querySelector('ytd-video-owner-renderer ytd-channel-name a'),
    document.querySelector('#channel-header yt-formatted-string, #channel-name .ytd-channel-name'),
  ];
  for (const node of candidates) {
    const text = node?.textContent?.trim();
    if (text) return text;
  }
  // Channel pages put the name in the title: "Name - YouTube".
  return document.title.replace(/\s-\sYouTube$/, '').trim();
}

function readHandle(near: Element | null): string | null {
  const scope = near?.closest('ytd-video-owner-renderer, #owner, #page-header, #channel-header') ?? document;
  for (const a of scope.querySelectorAll<HTMLAnchorElement>('a[href^="/@"], a[href*="youtube.com/@"]')) {
    const match = /\/(@[^/?#]+)/.exec(a.getAttribute('href') || '');
    if (match) return match[1];
  }
  const fromUrl = /^\/(@[^/?#]+)/.exec(location.pathname);
  return fromUrl ? fromUrl[1] : null;
}

function readAvatar(near: Element | null): string | null {
  const scope = near?.closest('ytd-video-owner-renderer, #owner, #page-header, #channel-header') ?? document;
  const img =
    scope.querySelector<HTMLImageElement>('img[src*="ytimg.com"], img[src*="ggpht.com"]') ??
    document.querySelector<HTMLImageElement>('#channel-header img, ytd-video-owner-renderer img');
  return img?.src || null;
}
