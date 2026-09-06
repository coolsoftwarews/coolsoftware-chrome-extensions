/**
 * Local-only usage counters — no URLs, no playlist ids/titles, no video
 * titles, only totals and the day the extension was used. Read/reset from
 * the panel's "Usage" sheet. This is the only instrumentation in the product
 * (README hard constraint: local-only instrumentation).
 */

import { METRICS_KEY } from './storage';

export type MetricEvent =
  | 'panel_opened'
  | 'scan_completed'
  | 'load_full_used'
  | 'load_full_capped'
  | 'sort_changed'
  | 'budget_filter_used'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(METRICS_KEY);
    const value = stored?.[METRICS_KEY] as Partial<Metrics> | undefined;
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
      await chrome.storage.local.set({ [METRICS_KEY]: metrics });
    } catch {
      /* counters are best-effort; never break a feature over them */
    }
  });
  return queue;
}

export function clearMetrics(): Promise<void> {
  queue = queue.then(async () => {
    try {
      await chrome.storage.local.remove(METRICS_KEY);
    } catch {
      /* ignore */
    }
  });
  return queue;
}
