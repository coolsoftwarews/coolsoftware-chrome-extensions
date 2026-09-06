/**
 * Local-only usage counters (portfolio-wide rule: "enough to answer which
 * feature is used, nothing that leaves the device"). No comment text, no
 * video id, no search query is ever recorded — only event counts and the
 * day-bucketed active-days list, exactly like WebHighlighter's metrics.ts.
 */

const STORAGE_KEY = 'ycd:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'sort_changed'
  | 'search_used'
  | 'load_more_used'
  | 'wordfreq_opened'
  | 'export_md'
  | 'export_csv';

export interface Metrics {
  counts: Record<string, number>;
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return { counts: value?.counts ?? {}, activeDays: value?.activeDays ?? [] };
  } catch {
    return { ...EMPTY };
  }
}

let queue: Promise<void> = Promise.resolve();

export function track(event: MetricEvent): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    if (!metrics.activeDays.includes(today)) metrics.activeDays = [...metrics.activeDays, today].slice(-30);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: metrics });
    } catch {
      /* best-effort — never break a feature over a counter write */
    }
  });
  return queue;
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
