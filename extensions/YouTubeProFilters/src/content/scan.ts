import { parseChannelKey, parseCompactNumber, parseDuration, parseRelativeDate, parseVideoId } from '../lib/parse';
import type { ResultData, ResultKind } from '../types';
import * as dom from './selectors';

/**
 * Turns a search-result element into structured data. Returns null when the
 * row is not a video at all (channel cards, playlists, ads, shelf headers) —
 * those are left completely untouched, filters included.
 */
export function scanRow(row: Element, now = Date.now()): ResultData | null {
  const anchor = dom.titleAnchor(row);
  const href = anchor?.getAttribute('href') ?? null;
  const videoId = parseVideoId(href);
  if (!videoId) return null;

  const channelAnchorEl = dom.channelAnchor(row);
  const channelUrl = channelAnchorEl?.getAttribute('href') ?? null;
  const meta = dom.metadataItems(row);
  const status = dom.timeStatusText(row);

  const durationSeconds = parseDuration(status);
  const kind = classify(href, status, meta);

  return {
    videoId,
    kind,
    title: anchor?.getAttribute('title')?.trim() || anchor?.textContent?.trim() || '',
    channelKey: parseChannelKey(channelUrl),
    channelUrl,
    channelName: channelAnchorEl?.textContent?.trim() ?? null,
    views: findViews(meta),
    publishedAt: findPublished(meta, now),
    durationSeconds,
  };
}

/** Shorts have their own URL shape; live/upcoming announce themselves in the overlay. */
function classify(href: string | null, status: string | null, meta: string[]): ResultKind {
  const badge = (status ?? '').toLowerCase();
  const joined = meta.join(' ').toLowerCase();

  if (badge.includes('live') || joined.includes('watching')) return 'live';
  if (badge.includes('premier') || badge.includes('upcoming') || joined.includes('scheduled')) return 'upcoming';
  if (href?.includes('/shorts/')) return 'short';
  return 'video';
}

function findViews(meta: string[]): number | null {
  const item = meta.find((entry) => /views?\b/i.test(entry));
  // "1,234 watching" is a live concurrent count, not a view total.
  if (!item || /watching/i.test(item)) return null;
  return parseCompactNumber(item);
}

function findPublished(meta: string[], now: number): number | null {
  const item = meta.find((entry) => /\bago\b/i.test(entry));
  return parseRelativeDate(item, now);
}
