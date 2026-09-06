/**
 * Turns the current grid into RawPost[]. DOM text is read first (it's what's
 * actually rendered), then any embedded JSON signal fills in whatever the
 * DOM didn't expose — most importantly the date, which the grid tile itself
 * never shows.
 */

import { parseCompactNumber } from './outlier';
import { extractJsonSignals } from './signals';
import { RawPost } from './types';
import * as dom from './selectors';

export interface ScanResult {
  posts: RawPost[];
  /** True when tiles were present but nothing usable could be read from any of them. */
  failed: boolean;
}

export function scanGrid(): ScanResult {
  const tiles = dom.tileAnchors();
  if (tiles.length === 0) return { posts: [], failed: false };

  const signals = extractJsonSignals(dom.candidateScriptTexts());
  const posts: RawPost[] = [];
  let usable = 0;

  for (const tile of tiles) {
    try {
      const href = tile.getAttribute('href');
      const shortcode = dom.extractShortcode(href);
      if (!shortcode || !href) continue;

      const signal = signals.get(shortcode) ?? null;
      const url = new URL(href, location.origin).toString();
      const kind = signal?.kind ?? dom.kindFromTile(tile, href);
      const pinned = signal?.pinned ?? dom.isPinnedTile(tile);

      const views = signal?.views ?? parseCompactNumber(dom.viewsTextFromTile(tile));
      const likes = signal?.likes ?? parseCompactNumber(dom.likesTextFromTile(tile));
      const comments = signal?.comments ?? parseCompactNumber(dom.commentsTextFromTile(tile));
      const takenAt = signal?.takenAt ?? null;

      if (views !== null || likes !== null) usable++;

      posts.push({ id: shortcode, url, kind, pinned, views, likes, comments, takenAt });
    } catch {
      // One tile's markup being unexpected must never take the rest down.
      continue;
    }
  }

  // Tiles existed but not one of them yielded a count — that's the DOM
  // rewrite PRD §6/§9 asks to detect, not merely a quiet account.
  const failed = posts.length > 0 && usable === 0;
  return { posts, failed };
}
