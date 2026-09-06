import type { ChannelStats, ChannelStatsRequest, ChannelStatsResponse } from '../types';

/**
 * Page-side view of channel enrichment. Holds a per-page memo so a channel
 * that appears in eight results costs one message, and reports each resolved
 * channel back through a callback so the UI can re-render progressively —
 * never blocking on the full set (§5).
 */

const resolved = new Map<string, ChannelStats>();
const pending = new Map<string, Promise<ChannelStats | null>>();

export function cachedStats(channelKey: string): ChannelStats | null {
  return resolved.get(channelKey) ?? null;
}

export async function requestStats(channelKey: string, channelUrl: string): Promise<ChannelStats | null> {
  const known = resolved.get(channelKey);
  if (known) return known;

  const inFlight = pending.get(channelKey);
  if (inFlight) return inFlight;

  const task = (async () => {
    try {
      const message: ChannelStatsRequest = { type: 'YPF_CHANNEL_STATS', channelKey, channelUrl };
      const response = (await chrome.runtime.sendMessage(message)) as ChannelStatsResponse | undefined;
      if (!response?.ok || !response.stats) return null;
      resolved.set(channelKey, response.stats);
      return response.stats;
    } catch {
      // The service worker can be torn down mid-flight, or the extension
      // reloaded under the page. Neither is worth surfacing to the user.
      return null;
    } finally {
      pending.delete(channelKey);
    }
  })();

  pending.set(channelKey, task);
  return task;
}

/**
 * Enriches a set of channels, invoking `onResolved` as each one lands rather
 * than once at the end.
 */
export function enrichChannels(
  channels: Array<{ channelKey: string; channelUrl: string }>,
  onResolved: () => void,
): void {
  const seen = new Set<string>();
  for (const { channelKey, channelUrl } of channels) {
    if (!channelKey || !channelUrl || seen.has(channelKey) || resolved.has(channelKey)) continue;
    seen.add(channelKey);
    void requestStats(channelKey, channelUrl).then((stats) => {
      if (stats) onResolved();
    });
  }
}
