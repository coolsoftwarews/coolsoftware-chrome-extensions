/**
 * Local-only usage counters. PRD §8 wants installs-that-form-a-habit numbers
 * (jobs tracked, stage movement, export used), and the hard constraint in
 * docs/extensions/README.md is that instrumentation never leaves the
 * device. Every event here is a counter in chrome.storage.local: no job
 * titles, no companies, no notes, no URLs — just totals and a day bucket.
 * The user can read and reset them from the panel's Usage sheet.
 */

const STORAGE_KEY = 'ljt:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'track_button_clicked'
  | 'job_tracked_created'
  | 'job_tracked_updated'
  | 'stage_changed'
  | 'note_saved'
  | 'job_deleted'
  | 'stale_detected'
  | 'export_csv'
  | 'export_md'
  | 'export_json'
  | 'data_exported'
  | 'data_imported';

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
