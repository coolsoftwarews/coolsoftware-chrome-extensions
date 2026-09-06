import { bumpMetric, readChannelCache, writeChannelCache } from '../lib/storage';
import type { ChannelStats, ChannelStatsRequest, ChannelStatsResponse } from '../types';
import { fetchChannelStats } from './channel';

/**
 * Service worker: the only place that touches the network. It exists to keep
 * enrichment off the page's critical path and to guarantee a channel is
 * fetched at most once, however many search results reference it.
 */

/** Concurrency cap. Higher gets us rate-limited; lower makes a page of 20 results crawl. */
const MAX_CONCURRENT = 3;

/** In-flight and completed fetches for this worker's lifetime, keyed by channel. */
const inFlight = new Map<string, Promise<ChannelStats>>();

let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => queue.push(resolve));
}

function release(): void {
  const next = queue.shift();
  if (next) {
    next();
    return;
  }
  active -= 1;
}

async function resolveChannel(channelKey: string, channelUrl: string): Promise<ChannelStats> {
  const cached = await readChannelCache(channelKey);
  if (cached) return cached;

  const existing = inFlight.get(channelKey);
  if (existing) return existing;

  const task = (async () => {
    await acquire();
    try {
      const stats = await fetchChannelStats(channelKey, channelUrl);
      await writeChannelCache(stats);
      void bumpMetric(stats.failed ? 'enrich.fail' : 'enrich.ok');
      return stats;
    } finally {
      release();
      inFlight.delete(channelKey);
    }
  })();

  inFlight.set(channelKey, task);
  return task;
}

chrome.runtime.onMessage.addListener((message: ChannelStatsRequest, _sender, sendResponse) => {
  if (message?.type !== 'YPF_CHANNEL_STATS') return false;

  resolveChannel(message.channelKey, message.channelUrl)
    .then((stats) => sendResponse({ ok: true, stats } satisfies ChannelStatsResponse))
    .catch((error: unknown) =>
      sendResponse({ ok: false, error: error instanceof Error ? error.message : 'unknown' } satisfies ChannelStatsResponse),
    );

  // Keeps the message channel open for the async sendResponse above.
  return true;
});
