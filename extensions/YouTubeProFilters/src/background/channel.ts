import { median, parseCompactNumber } from '../lib/parse';
import type { ChannelStats } from '../types';

/**
 * Channel enrichment by scraping the channel's own /videos tab — the outcome
 * of the §7 spike. One HTML fetch yields both signals we need:
 *
 *   • subscriberCountText → channel size
 *   • the viewCountText of the recent uploads → the median for the outlier ratio
 *
 * No API key, so zero-config survives. Cost is one fetch per channel per week,
 * deduped in-memory and in `storage.local`.
 */

/** Recent uploads considered for the median. Enough to be stable, few enough to stay cheap. */
const MEDIAN_SAMPLE = 30;
/** A channel with almost no uploads has no meaningful "typical" performance. */
const MIN_SAMPLE_FOR_MEDIAN = 5;

const FETCH_TIMEOUT_MS = 8000;

export async function fetchChannelStats(channelKey: string, channelUrl: string): Promise<ChannelStats> {
  try {
    const html = await fetchText(videosTabUrl(channelUrl));
    const stats: ChannelStats = {
      channelKey,
      subscribers: extractSubscribers(html),
      medianViews: extractMedianViews(html),
      fetchedAt: Date.now(),
      failed: false,
    };
    // A page that yielded neither signal is a parse failure, not a channel
    // with no data — cache it as failed so it retries on the short TTL.
    if (stats.subscribers === null && stats.medianViews === null) {
      return { ...stats, failed: true };
    }
    return stats;
  } catch {
    return { channelKey, subscribers: null, medianViews: null, fetchedAt: Date.now(), failed: true };
  }
}

/** Normalises /channel/UC…, /@handle and /c/name into that channel's videos tab. */
function videosTabUrl(channelUrl: string): string {
  const url = new URL(channelUrl, 'https://www.youtube.com');
  const path = url.pathname.replace(/\/(videos|featured|about|streams|shorts|playlists)\/?$/, '');
  return `https://www.youtube.com${path}/videos`;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { credentials: 'omit', signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The subscriber count appears in the embedded ytInitialData under a couple of
 * shapes depending on which channel-header experiment the user is served.
 * Both are matched; the first hit wins.
 */
function extractSubscribers(html: string): number | null {
  const patterns = [
    /"subscriberCountText":\s*\{\s*"simpleText":\s*"([^"]+)"/,
    /"subscriberCountText":\s*\{[^}]*"content":\s*"([^"]+)"/,
    /"([\d.,]+[KMB]?)\s+subscribers"/,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) {
      const value = parseCompactNumber(match[1]);
      if (value !== null) return value;
    }
  }
  return null;
}

/**
 * Median views across the most recent uploads on the videos tab. The tab is
 * ordered newest-first, so slicing the first N gives a recent-form median
 * rather than a lifetime one — which is what "is this video an outlier"
 * actually asks.
 */
function extractMedianViews(html: string): number | null {
  const counts: number[] = [];
  const pattern = /"viewCountText":\s*\{\s*"simpleText":\s*"([^"]+)"/g;

  for (const match of html.matchAll(pattern)) {
    // Live rows read "1,234 watching" — a concurrent-viewer number, not a
    // view total, and including it would drag the median toward zero.
    if (/watching/i.test(match[1])) continue;
    const value = parseCompactNumber(match[1]);
    if (value !== null) counts.push(value);
    if (counts.length >= MEDIAN_SAMPLE) break;
  }

  if (counts.length < MIN_SAMPLE_FOR_MEDIAN) return null;
  return median(counts);
}
