/**
 * Turns the loaded profile grid into ScannedVideo objects. Never throws: a
 * single tile's parse failure is swallowed and that tile is skipped, exactly
 * as PRD §6 asks ("the profile page is never broken").
 */

import { extractHashtags, firstLine, parseCompactNumber, parseDurationLabel, parseVideoId } from './parse';
import * as dom from './selectors';
import { ScannedVideo } from './types';

function gridItems(): Element[] {
  for (const selector of dom.POST_ITEM_SELECTORS) {
    const found = Array.from(document.querySelectorAll(selector));
    if (found.length) return found;
  }
  // Fallback: walk up from bare post links to a reasonable tile container.
  const links = Array.from(document.querySelectorAll<HTMLAnchorElement>(dom.POST_LINK_FALLBACK));
  const tiles = new Set<Element>();
  for (const link of links) {
    tiles.add(link.parentElement?.parentElement ?? link.parentElement ?? link);
  }
  return [...tiles];
}

function scanOne(item: Element): ScannedVideo | null {
  const href = dom.postHref(item);
  const id = parseVideoId(href);
  if (!id || !href) return null;

  const caption = dom.captionText(item);

  return {
    id,
    href,
    views: parseCompactNumber(dom.viewsText(item)),
    captionFirstLine: firstLine(caption),
    hashtags: extractHashtags(caption),
    durationSeconds: parseDurationLabel(dom.durationText(item)),
    postedAt: parseDateAttr(dom.postedAtAttr(item)),
    pinned: dom.isPinned(item),
    isPhoto: href.includes('/photo/'),
  };
}

function parseDateAttr(raw: string | null): number | null {
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

export interface ScanResult {
  videos: ScannedVideo[];
  /** True when the page clearly has post tiles but none could be parsed — a real DOM-change failure. */
  parseFailure: boolean;
}

export function scanGrid(): ScanResult {
  let items: Element[] = [];
  try {
    items = gridItems();
  } catch {
    return { videos: [], parseFailure: false };
  }

  const videos: ScannedVideo[] = [];
  const byId = new Set<string>();

  for (const item of items) {
    let scanned: ScannedVideo | null = null;
    try {
      scanned = scanOne(item);
    } catch {
      scanned = null;
    }
    if (!scanned || byId.has(scanned.id)) continue;
    byId.add(scanned.id);
    videos.push(scanned);
  }

  return { videos, parseFailure: items.length > 0 && videos.length === 0 };
}
