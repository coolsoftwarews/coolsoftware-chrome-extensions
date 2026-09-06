/**
 * Local-only usage counters (README hard constraint: "local-only
 * instrumentation... nothing that leaves the device"). Every counter here
 * maps to a row in PRD §8's success-metrics table, so the developer can read
 * the same numbers the store listing will eventually be judged against —
 * without a server anywhere in the loop.
 */

const STORAGE_KEY = 'tps:metrics';

export type MetricEvent =
  | 'board_opened'
  | 'product_tracked'
  | 'product_renamed'
  | 'product_removed'
  | 'video_tracked'
  | 'video_removed'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported'
  | 'filter_applied';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the extension was used, last 30 — the retention signal from PRD §8. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return { counts: value?.counts ?? {}, activeDays: value?.activeDays ?? [] };
  } catch {
    return { ...EMPTY, counts: {}, activeDays: [] };
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
