/**
 * Local-only usage counters (README "Local-only instrumentation").
 *
 * The PRD's success metrics (§8: panel opened ≥3 times, export used, users
 * watching ≥3 people) need instrumentation, but there is no backend and no
 * identity. Every event is a counter in chrome.storage.local; nothing here
 * carries a person's name, a post's text or a URL. The user can read or clear
 * these from the panel footer.
 */

const STORAGE_KEY = 'lcw_metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'watch_added'
  | 'watch_removed'
  | 'post_collected'
  | 'person_note_saved'
  | 'post_note_saved'
  | 'sort_changed'
  | 'filter_changed'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported'
  | 'data_cleared';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the panel was opened, capped at the last 30 — for a local read on retention. */
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
