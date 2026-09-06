/**
 * The DOM half of the extension: finds video tiles on whatever TikTok page is
 * open and reads what it can off them. This is the part that cannot be unit
 * tested (no browser here) and the part PRD §5 explicitly gates on a spike —
 * "confirm view counts, creator identity and shop/product markers are
 * readable from feed, search and hashtag pages" before betting the product on
 * it. What ships here is deliberately layered and defensive so that when
 * TikTok's markup drifts, individual tiles degrade quietly instead of taking
 * the page down (PRD §7: "degrade to 'couldn't read this video', never break
 * the feed").
 *
 * Every extraction is wrapped so a single bad tile can never throw past this
 * file. Nothing here ever writes to the page beyond the badge overlay in
 * badge.ts — this file only reads (README hard constraint: read-only on the
 * platform).
 */

import { combineMarkers } from './markers';
import { classifyPage, extractHandle, extractVideoId, isRestrictedTileText, parseCompactNumber, PageContext } from './parse';
import { Marker, ScannedVideo, SourceContext } from './types';

const TILE_ATTR = 'data-tps-tile';
const MAX_ANCESTOR_CLIMB = 8;

/** Anchors that plausibly link to a watch page. Attribute-contains rather than an exact `data-e2e` name, because those names are the first thing TikTok's own redesigns rename. */
function videoAnchors(root: ParentNode): HTMLAnchorElement[] {
  return Array.from(root.querySelectorAll<HTMLAnchorElement>('a[href*="/video/"]'));
}

/**
 * Climbs from a video link to the element that most likely represents "one
 * feed card" — the thing a badge should be pinned to. There is no reliable
 * class name to key off, so this walks up looking for the first ancestor
 * that is meaningfully bigger than the anchor itself (a card, not just the
 * thumbnail link) and gives up rather than guess past a sane depth.
 */
function nearestTile(anchor: HTMLAnchorElement): HTMLElement {
  let node: HTMLElement = anchor;
  const anchorArea = anchor.getBoundingClientRect().width * anchor.getBoundingClientRect().height;

  for (let i = 0; i < MAX_ANCESTOR_CLIMB && node.parentElement; i++) {
    const parent = node.parentElement;
    const rect = parent.getBoundingClientRect();
    if (anchorArea > 0 && rect.width * rect.height > anchorArea * 1.15) return parent;
    node = parent;
  }
  return anchor.parentElement ?? anchor;
}

/** First matching element's trimmed text among several candidate selectors, tried in order. */
function textFrom(tile: HTMLElement, selectors: string[]): string | null {
  for (const selector of selectors) {
    const el = tile.querySelector(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return null;
}

const COUNT_SELECTORS = {
  likes: ['[data-e2e="like-count"]', '[data-e2e="browse-like-count"]', '[data-e2e="video-like-count"]'],
  comments: ['[data-e2e="comment-count"]', '[data-e2e="browse-comment-count"]'],
  views: ['[data-e2e="video-views"]', '[data-e2e="video-view-count"]', '[data-e2e="browse-video-view-count"]'],
};

function readCompactCountAttr(tile: HTMLElement, selectors: string[]): string | null {
  return textFrom(tile, selectors);
}

/** DOM-verified shop marker: an actual shop link/tag/badge in the tile, not caption text. */
function detectDomShopMarker(tile: HTMLElement): Marker[] {
  const shopEl = tile.querySelector(
    '[data-e2e*="shop" i], a[href*="/shop/"], [aria-label*="shop" i], [class*="Shop" i]'
  );
  if (!shopEl) return [];
  return [{ type: 'shop_link', confidence: 'verified', label: 'TikTok Shop' }];
}

function captionFrom(tile: HTMLElement): string {
  return (
    textFrom(tile, ['[data-e2e="video-desc"]', '[data-e2e="browse-video-desc"]', '[data-e2e="search-card-video-caption"]']) ??
    // Last resort: the anchor's own accessible text, which TikTok sometimes uses to carry the caption for screen readers.
    tile.querySelector('a[href*="/video/"]')?.getAttribute('aria-label') ??
    ''
  );
}

/** True when the tile itself says it cannot be shown normally (age gate, region lock, unavailable). */
function isRestricted(tile: HTMLElement): boolean {
  return isRestrictedTileText(tile.textContent ?? '');
}

/**
 * Extracts one video from a tile, or null if it isn't usable (restricted,
 * unreadable, or missing the minimum we need — an id and a creator). Never
 * throws: a parse failure here is exactly the "DOM churn" case the PRD asks
 * us to degrade quietly on.
 */
export function extractVideo(tile: HTMLElement, anchor: HTMLAnchorElement, context: SourceContext): ScannedVideo | null {
  try {
    if (isRestricted(tile)) return null;

    const url = anchor.href;
    const id = extractVideoId(url);
    const handle = extractHandle(url);
    if (!id || !handle) return null;

    const caption = captionFrom(tile);
    const domMarkers = detectDomShopMarker(tile);

    return {
      id,
      url,
      creatorHandle: handle,
      caption,
      views: parseCompactFromSelectors(tile, COUNT_SELECTORS.views),
      likes: parseCompactFromSelectors(tile, COUNT_SELECTORS.likes),
      comments: parseCompactFromSelectors(tile, COUNT_SELECTORS.comments),
      publishedAt: null, // TikTok rarely exposes an absolute date in tile markup; left null rather than guessed.
      markers: combineMarkers(domMarkers, caption),
      context,
    };
  } catch {
    return null;
  }
}

function parseCompactFromSelectors(tile: HTMLElement, selectors: string[]): number | null {
  const raw = readCompactCountAttr(tile, selectors);
  return raw ? parseCompactNumber(raw) : null;
}

/** All not-yet-processed video tiles currently in the document for a given context. */
export function findTiles(context: SourceContext): Array<{ tile: HTMLElement; anchor: HTMLAnchorElement }> {
  const seenTiles = new Set<HTMLElement>();
  const results: Array<{ tile: HTMLElement; anchor: HTMLAnchorElement }> = [];

  for (const anchor of videoAnchors(document)) {
    if (anchor.closest('[data-tps-ui]')) continue; // never scan our own overlay
    let tile: HTMLElement;
    try {
      tile = nearestTile(anchor);
    } catch {
      continue;
    }
    if (seenTiles.has(tile)) continue;
    seenTiles.add(tile);
    results.push({ tile, anchor });
  }

  return results;
}

/** Profile-page view counts, for building a creator's baseline (PRD §5). Best-effort, same defensive shape as extractVideo. */
export function extractProfileViewCounts(): number[] {
  const views: number[] = [];
  for (const { tile } of findTiles('profile')) {
    try {
      if (isRestricted(tile)) continue;
      const raw = readCompactCountAttr(tile, [
        '[data-e2e="video-views"]',
        '[data-e2e="user-post-item-desc"]',
        '[data-e2e="video-view-count"]',
      ]);
      const value = raw ? parseCompactNumber(raw) : null;
      if (value !== null) views.push(value);
    } catch {
      /* skip this tile */
    }
  }
  return views;
}

export function pageContext(): PageContext {
  return classifyPage(location.pathname, location.search);
}

export const __internal = { nearestTile, textFrom, TILE_ATTR };
