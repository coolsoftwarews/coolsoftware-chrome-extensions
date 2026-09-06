/**
 * Local-only usage counters (PRD §8): pages scanned by type, filter used,
 * sort used, export used, and parse-failure count. No handles, no URLs, no
 * post ids — only totals and the dates the extension was used, readable and
 * resettable from the popup.
 *
 * The parse-failure counter is the health metric PRD §8 calls out by name:
 * LinkedIn will change its DOM, and this is the only place that shows it
 * before the reviews do.
 */

import { MetricEvent, Metrics } from './types';

const STORAGE_KEY = 'lpo:metrics';

const EMPTY: Metrics = { counts: {}, parseFailures: 0, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      parseFailures: value?.parseFailures ?? 0,
      activeDays: value?.activeDays ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    const today = new Date().toISOString().slice(0, 10);
    if (!metrics.activeDays.includes(today)) metrics.activeDays = [...metrics.activeDays, today].slice(-30);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: metrics });
    } catch {
      /* counters are best-effort; never break a feature over them */
    }
  });
  return queue;
}

export function track(event: MetricEvent): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;
  });
}

export function trackParseFailure(): Promise<void> {
  return enqueue(metrics => {
    metrics.parseFailures += 1;
  });
}

export function clearMetrics(): Promise<void> {
  queue = queue.then(async () => {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });
  return queue;
}
