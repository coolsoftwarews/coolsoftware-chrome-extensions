/**
 * The DOM-bound half: reads whatever YouTube has currently rendered into
 * PlaylistRow[], and drives the bounded "load full playlist" auto-scroll.
 * Not unit-tested (no DOM in scripts/selftest.mjs) — see the README's manual
 * checklist. Every parsed field goes through src/parse.ts, which *is* tested.
 */

import { parseDuration, parseVideoId, parseViewCount, looksLikeRelativeDate } from '../parse';
import { PlaylistRow } from '../types';
import {
  ROW_SELECTOR,
  LIST_CONTAINER_SELECTOR,
  isUnavailableRow,
  metadataItems,
  positionText,
  statedTotalFromDocument,
  timeStatusText,
  titleAnchor,
} from './selectors';

function rowFromElement(el: Element, fallbackPosition: number): PlaylistRow {
  const anchor = titleAnchor(el);
  const title = anchor?.textContent?.trim() ?? anchor?.getAttribute('title')?.trim() ?? '';
  const videoId = parseVideoId(anchor?.getAttribute('href'));
  const durationText = timeStatusText(el);
  const durationSeconds = parseDuration(durationText);

  // The metadata line mixes a view count and a relative date with no fixed
  // order — classify each item by what it looks like, don't assume position.
  let viewsText: string | null = null;
  let dateText: string | null = null;
  for (const item of metadataItems(el)) {
    if (viewsText === null && parseViewCount(item) !== null) {
      viewsText = item;
    } else if (dateText === null && looksLikeRelativeDate(item)) {
      dateText = item;
    }
  }

  const positionRaw = positionText(el);
  const position = positionRaw && /^\d+$/.test(positionRaw) ? Number(positionRaw) : fallbackPosition;

  return {
    id: videoId ?? `row-${fallbackPosition}`,
    position,
    title,
    durationText,
    durationSeconds,
    viewsText,
    viewsCount: parseViewCount(viewsText),
    dateText,
    unavailable: isUnavailableRow(el, title, videoId),
  };
}

export function scanRows(): PlaylistRow[] {
  const elements = Array.from(document.querySelectorAll(ROW_SELECTOR));
  return elements.map((el, i) => rowFromElement(el, i + 1));
}

export function currentStatedTotal(): number | null {
  return statedTotalFromDocument();
}

function listContainer(): Element | null {
  return document.querySelector(LIST_CONTAINER_SELECTOR);
}

/** Auto-scroll bounds (PRD §5/§6: hard caps, both dimensions, not user-configurable). */
export const MAX_SCROLL_ATTEMPTS = 60;
export const MAX_SCROLL_MS = 45_000;
const SCROLL_PAUSE_MS = 350;
const STABLE_ATTEMPTS_TO_STOP = 4;

export interface LoadFullOutcome {
  finalCount: number;
  attempts: number;
  elapsedMs: number;
  /** True when the row count stopped growing on its own (genuinely finished). */
  completed: boolean;
}

/**
 * Repeatedly scrolls the playlist's own list container toward its end,
 * waiting for YouTube to append more rows, until either growth stalls for a
 * few consecutive attempts (finished) or a hard cap is hit (capped — see
 * PRD §5, never claim completeness past what was actually verified).
 */
export async function autoScrollToLoadFull(
  onProgress: (loaded: number, attempts: number, elapsedMs: number) => void,
  isCancelled: () => boolean,
): Promise<LoadFullOutcome> {
  const start = Date.now();
  let attempts = 0;
  let stable = 0;
  let lastCount = scanRows().length;

  while (attempts < MAX_SCROLL_ATTEMPTS && Date.now() - start < MAX_SCROLL_MS) {
    if (isCancelled()) break;

    const container = listContainer();
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
    // Some layouts scroll the whole document rather than an inner container.
    window.scrollTo(0, document.documentElement.scrollHeight);

    await new Promise((resolve) => setTimeout(resolve, SCROLL_PAUSE_MS));
    attempts++;

    const count = scanRows().length;
    onProgress(count, attempts, Date.now() - start);

    if (count > lastCount) {
      stable = 0;
      lastCount = count;
    } else {
      stable++;
      if (stable >= STABLE_ATTEMPTS_TO_STOP) {
        return { finalCount: count, attempts, elapsedMs: Date.now() - start, completed: true };
      }
    }
  }

  return { finalCount: lastCount, attempts, elapsedMs: Date.now() - start, completed: false };
}
