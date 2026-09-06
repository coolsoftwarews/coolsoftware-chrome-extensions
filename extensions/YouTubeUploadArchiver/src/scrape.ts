/**
 * The DOM-bound half: finding a channel's own uploads on the two pages this
 * extension ever runs on — a channel's own "Videos" tab on youtube.com, and
 * Studio's own Content table on studio.youtube.com (PRD §4 — "the logged-in
 * user's own channel/Studio pages") — and, separately, confirming that the
 * channel being viewed really is the signed-in account's own (PRD §5).
 *
 * Every assumption about YouTube's and Studio's DOM lives in this file and
 * nowhere else, exactly like the selectors layer in every other DOM-reading
 * extension in this portfolio. Every function here returns null/empty rather
 * than throwing — a broken selector must degrade to "no Archive button"
 * (fail closed, per PRD §5), never a broken page and never a false positive
 * on ownership.
 *
 * This file could not be verified against a live YouTube/Studio DOM in this
 * build environment (no network access) — flagged here and in README.md's
 * "Known limits", the same "say so, don't silently guess" rule XCardExporter
 * and every other DOM-scraping extension in this portfolio follows. Walk the
 * manual checklist in README.md before shipping a build.
 *
 * Nothing in this file ever reads, builds or requests a player/format
 * response or a URL from YouTube's signed video-streaming CDN — only text
 * nodes, image `src` attributes and `href`s already rendered on the page
 * (PRD §2/§4).
 */

import { canonicalWatchUrl, parseDisplayedCount, parseVideoId } from './parse';
import { ScrapedVideo } from './types';

/* ── Which page this is ─────────────────────────────────────────────────── */

export type PageContext = 'channel-videos' | 'studio-content' | null;

export function currentPageContext(): PageContext {
  const host = location.hostname;
  const path = location.pathname;

  if (host === 'studio.youtube.com') {
    // Studio's Content dashboard, e.g. /channel/UC.../videos/upload,
    // /videos/short, /videos/live — the video-management table this
    // extension reads rows from.
    return /^\/channel\/[^/]+\/videos/.test(path) ? 'studio-content' : null;
  }

  if (/(^|\.)youtube\.com$/.test(host)) {
    // A channel's own "Videos" tab: /@handle/videos, /channel/UC.../videos,
    // and the legacy /c/Name/videos and /user/Name/videos forms.
    return /^\/(@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)\/videos(\/.*)?$/.test(path) ? 'channel-videos' : null;
  }

  return null;
}

/* ── The viewed channel's identity ──────────────────────────────────────── */

/** Pull `ytInitialData = {...}` (or any other `NAME = {...}` assignment) out
 *  of the document's own inline scripts — the same technique
 *  YouTubeSubcription's yt-data.ts uses, ported down to just what this
 *  extension needs. */
function extractAssignedObject(marker: string): unknown | null {
  for (const script of document.scripts) {
    if (script.src) continue;
    const text = script.textContent;
    if (!text || !text.includes(marker)) continue;

    const at = text.indexOf(marker);
    const brace = text.indexOf('{', at);
    if (brace === -1 || brace - at > 40) continue;

    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = brace; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(brace, i + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

function dig(root: unknown, ...path: string[]): unknown {
  let node: unknown = root;
  for (const key of path) {
    if (!node || typeof node !== 'object') return null;
    node = (node as Record<string, unknown>)[key];
  }
  return node ?? null;
}

/** The channel this page is *about* — read from YouTube's own statement of
 *  it (the embedded `ytInitialData` bootstrap, or the canonical link tag as
 *  a fallback), never assumed from the URL alone. */
export function readViewedChannelKey(): string | null {
  const initialData = extractAssignedObject('ytInitialData');
  const fromData =
    dig(initialData, 'metadata', 'channelMetadataRenderer', 'externalId') ??
    dig(initialData, 'header', 'c4TabbedHeaderRenderer', 'channelId') ??
    dig(initialData, 'microformat', 'microformatDataRenderer', 'externalId');
  if (typeof fromData === 'string' && fromData.startsWith('UC')) return fromData;

  const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href') ?? '';
  const byId = /\/channel\/(UC[\w-]{20,24})/.exec(canonical)?.[1];
  if (byId) return byId;
  const byHandle = /\/(@[^/?#]+)/.exec(canonical)?.[1];
  return byHandle ?? null;
}

/** Studio scopes its whole Content dashboard to one channel per URL — this
 *  reads that id off the path. Used only *after* readStudioIdentityElement()
 *  below confirms Studio's own UI actually names a channel for it; the URL
 *  is never trusted on its own (PRD §5's "don't trust the URL alone" rule).
 */
function studioChannelIdFromUrl(): string | null {
  return /\/channel\/([^/]+)\/videos/.exec(location.pathname)?.[1] ?? null;
}

/** Studio's own channel-identity element: the account/channel switcher in
 *  Studio's header, which always names the channel the dashboard is
 *  currently scoped to. Selectors here are a best-effort guess at Studio's
 *  markup (unverified live — see the file header) and deliberately
 *  redundant across several known Studio layouts; the function returns null
 *  the moment none of them yield non-empty text, which is what makes the
 *  gate fail closed rather than trust the URL by itself. */
function readStudioIdentityElement(): string | null {
  const candidates = [
    '#entity-name',
    'ytcp-header #channel-title',
    'ytcp-channel-switcher-panel[selected-channel-id]',
    '#channel-switcher-container #channel-title',
    'ytcp-account-avatar',
  ];
  for (const selector of candidates) {
    const el = document.querySelector(selector);
    if (!el) continue;
    const attr = el.getAttribute('selected-channel-id');
    if (attr) return attr;
    const text = el.textContent?.trim();
    if (text) return text;
  }
  return null;
}

/**
 * The channel key(s) the signed-in session actually owns, read from
 * YouTube's own UI rather than assumed (PRD §5). On Studio, the only page
 * Studio ever shows is a channel the session manages, so confirming
 * Studio's own identity element names *a* channel is what lets the URL's
 * channel id be trusted; on a channel's own youtube.com page, this reads
 * the account-switcher menu's "Your channel" entry/entries.
 *
 * Returns an empty array — never a guess — when nothing can be confirmed,
 * which is what makes the Archive button fail closed (parse.ts#
 * isOwnChannelMatch returns false against an empty list).
 */
export function readOwnChannelKeys(): string[] {
  if (location.hostname === 'studio.youtube.com') {
    const identity = readStudioIdentityElement();
    const urlId = studioChannelIdFromUrl();
    // Studio's identity element must actually confirm *something* before the
    // URL's channel id is trusted — an identity element that can't be read
    // at all means "can't confirm", not "assume yes".
    return identity && urlId ? [urlId] : [];
  }

  // youtube.com: read the masthead's account-switcher menu. YouTube renders
  // the "Your channel" entry as a link to /@handle or /channel/UC… inside
  // the avatar menu's content wrapper; several layouts keep this in the DOM
  // even before the menu is opened by a click, which is what lets this be
  // read passively rather than by simulating a click on the user's behalf.
  const menuScopes = [
    'ytd-active-account-header-renderer',
    'tp-yt-paper-listbox#items',
    'ytd-multi-page-menu-renderer',
    '#avatar-btn',
  ];

  const keys = new Set<string>();
  for (const scopeSelector of menuScopes) {
    for (const scope of document.querySelectorAll(scopeSelector)) {
      for (const link of scope.querySelectorAll<HTMLAnchorElement>('a[href^="/@"], a[href^="/channel/"]')) {
        const href = link.getAttribute('href') ?? '';
        const byId = /\/channel\/(UC[\w-]{20,24})/.exec(href)?.[1];
        if (byId) {
          keys.add(byId);
          continue;
        }
        const byHandle = /^\/(@[^/?#]+)/.exec(href)?.[1];
        if (byHandle) keys.add(byHandle);
      }
    }
  }
  return Array.from(keys);
}

/* ── Reading one video row/tile ──────────────────────────────────────────── */

/** Containers that hold one video each, in a channel's own public "Videos"
 *  grid — same tile set YouTubeSubcription's selectors.ts reads. */
const CHANNEL_ROW_SELECTOR = ['ytd-rich-item-renderer', 'ytd-grid-video-renderer'].join(',');

/** Studio's Content table renders one custom element per video row. */
const STUDIO_ROW_SELECTOR = 'ytcp-video-row';

export function findVideoRows(context: PageContext, root: ParentNode = document): HTMLElement[] {
  if (context === 'channel-videos') return Array.from(root.querySelectorAll<HTMLElement>(CHANNEL_ROW_SELECTOR));
  if (context === 'studio-content') return Array.from(root.querySelectorAll<HTMLElement>(STUDIO_ROW_SELECTOR));
  return [];
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').trim();
}

function firstText(root: ParentNode, selectors: string[]): string {
  for (const selector of selectors) {
    const found = text(root.querySelector(selector));
    if (found) return found;
  }
  return '';
}

/** The thumbnail `<img>` src as rendered — a static i.ytimg.com/vi/<id>/...
 *  image asset. Never resolved to anything else, and never used to derive a
 *  stream URL of any kind (PRD §2). */
function readThumbnailUrl(root: ParentNode): string {
  const img = root.querySelector<HTMLImageElement>('img[src*="i.ytimg.com"], img[src*="ytimg.com"]');
  return img?.src ?? '';
}

function extractFromChannelTile(row: Element): ScrapedVideo | null {
  const link = row.querySelector<HTMLAnchorElement>('a#video-title-link, a#video-title, a[href*="/watch?v="], a[href*="/shorts/"]');
  const videoId = parseVideoId(link?.getAttribute('href'));
  if (!videoId) return null;

  const title = firstText(row, ['#video-title', 'a#video-title-link', 'yt-formatted-string#video-title']);

  // The metadata line reads "12K views · 3 days ago" as one or two spans;
  // views and the publish date are pulled out of whichever spans are
  // present, and the public grid never shows a description or a like count.
  const metadataTexts = Array.from(row.querySelectorAll('#metadata-line span, .inline-metadata-item'))
    .map(el => text(el))
    .filter(Boolean);
  const viewsText = metadataTexts.find(t => /view/i.test(t)) ?? null;
  const dateText = metadataTexts.find(t => t !== viewsText) ?? metadataTexts[metadataTexts.length - 1] ?? '';

  return {
    videoId,
    url: canonicalWatchUrl(videoId),
    title,
    description: '',
    publishDateText: dateText,
    views: parseDisplayedCount(viewsText),
    likes: null,
    thumbnailUrl: readThumbnailUrl(row),
  };
}

function extractFromStudioRow(row: Element): ScrapedVideo | null {
  const link = row.querySelector<HTMLAnchorElement>('a[href*="/video/"]');
  const videoId = parseVideoId(link?.getAttribute('href')) ?? row.getAttribute('video-id') ?? null;
  if (!videoId) return null;

  const title = firstText(row, ['#video-title', '.video-title', '[id="video-title"]']);
  const description = firstText(row, ['.description-text', '#description', '[id="description"]']);
  const dateText = firstText(row, ['#date', '.cell.date', '[id="date"] .cell-content']);
  const viewsText = firstText(row, ['#views .cell-content', '.cell.views', '[id="views"]']);
  const likesText = firstText(row, ['#likes .cell-content', '.cell.likes', '[id="likes"]']);

  return {
    videoId,
    url: canonicalWatchUrl(videoId),
    title,
    description,
    publishDateText: dateText,
    views: parseDisplayedCount(viewsText),
    likes: parseDisplayedCount(likesText),
    thumbnailUrl: readThumbnailUrl(row),
  };
}

/** Reads one row into an archive-ready snapshot. Never throws — a row that
 *  fails to parse is skipped by the caller, not the whole batch (PRD §7). */
export function extractVideoMetadata(row: Element, context: PageContext): ScrapedVideo | null {
  try {
    if (context === 'channel-videos') return extractFromChannelTile(row);
    if (context === 'studio-content') return extractFromStudioRow(row);
    return null;
  } catch {
    return null;
  }
}
