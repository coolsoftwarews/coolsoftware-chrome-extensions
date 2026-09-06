/**
 * Local-only usage counters. The PRD's success metrics (§8: rule creation,
 * matched-thread rate, "replied" rate, export usage) need instrumentation,
 * but the extension has no backend and asks for no identity — so every event
 * is a counter in chrome.storage.local: no subreddit names, no post text, no
 * identifiers, nothing that leaves the device. Readable and resettable from
 * the panel footer.
 */

const STORAGE_KEY = 'rom:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'rule_created'
  | 'rule_deleted'
  | 'starter_pack_used'
  | 'post_captured'
  | 'status_replied'
  | 'status_dismissed'
  | 'note_added'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported'
  | 'session_cap_reached'
  | 'subreddit_read_viewed';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the panel was used, capped at the last 30. */
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
 * Every counter is a read-modify-write against one storage key, so
 * concurrent calls would drop increments. Chaining them costs nothing at
 * this volume.
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
