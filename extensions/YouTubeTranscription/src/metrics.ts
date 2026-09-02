/**
 * Local-only usage counters.
 *
 * The PRD's success metrics need instrumentation, but the extension has no
 * backend and asks for no identity. So every event is a counter in
 * chrome.storage.local: no video ids, no URLs, no timestamps beyond a day
 * bucket, and nothing ever leaves the machine. The user can read or clear them
 * from the panel footer.
 */

import { FailureReason } from './types';

const STORAGE_KEY = 'ytx_metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'transcript_loaded'
  | 'search_used'
  | 'timestamps_toggled'
  | 'language_switched'
  | 'copy_used'
  | 'export_md'
  | 'export_txt'
  | 'export_pdf'
  | 'seek_used'
  | 'notes_opened'
  | 'copy_prompt';

export interface Metrics {
  counts: Record<string, number>;
  failures: Record<string, number>;
  /** Days (YYYY-MM-DD) on which the panel was used, capped at the last 30. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, failures: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      failures: value?.failures ?? {},
      activeDays: value?.activeDays ?? [],
    };
  } catch {
    return { ...EMPTY };
  }
}

async function write(metrics: Metrics): Promise<void> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: metrics });
  } catch {
    /* counters are best-effort; never break a feature over them */
  }
}

/**
 * Every counter is a read-modify-write against one storage key, so concurrent
 * calls would drop increments. Chaining them costs nothing at this volume.
 */
let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    await write(metrics);
  });
  return queue;
}

export function track(event: MetricEvent): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;

    const today = new Date().toISOString().slice(0, 10);
    if (!metrics.activeDays.includes(today)) {
      metrics.activeDays = [...metrics.activeDays, today].slice(-30);
    }
  });
}

export function trackFailure(reason: FailureReason): Promise<void> {
  return enqueue(metrics => {
    metrics.failures[reason] = (metrics.failures[reason] ?? 0) + 1;
  });
}

export function clearMetrics(): Promise<void> {
  // Through the queue, so a pending increment cannot resurrect the counters.
  queue = queue.then(async () => {
    try {
      await chrome.storage.local.remove(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  });
  return queue;
}
