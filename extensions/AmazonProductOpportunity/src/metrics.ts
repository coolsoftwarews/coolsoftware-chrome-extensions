/**
 * Local-only usage counters (PRD §9's success metrics, read by the developer
 * from this device, never transmitted). No URLs, no search terms, no ASINs —
 * only totals and the day-buckets the extension was used, same shape as
 * WebHighlighter's and YouTubeTranscription's metrics.ts.
 */

import { MetricEvent } from './types';

const STORAGE_KEY = 'apo:metrics';

export interface Metrics {
  counts: Record<string, number>;
  /** Distinct search snapshots analysed, capped at 999 — PRD §9's "≥5 searches" cohort. */
  searchesAnalyzed: number;
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, searchesAnalyzed: 0, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      searchesAnalyzed: value?.searchesAnalyzed ?? 0,
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
    if (event === 'search_analyzed') metrics.searchesAnalyzed += 1;
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
