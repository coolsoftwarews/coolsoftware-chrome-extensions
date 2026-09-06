/**
 * Local-only usage counters (README hard constraints — "local-only
 * instrumentation... nothing that leaves the device"). No lead names, no
 * headlines, no comment text, no profile URLs — only counts. The panel's
 * "Usage" sheet is the only place these are ever shown, and they can be
 * reset there at any time.
 *
 * The counters are chosen to answer the PRD §9 success metrics locally:
 * distinct posts collected from, whether the user ever exports, and whether
 * they ever set a qualification rule.
 */

const STORAGE_KEY = 'llf:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'collect_clicked'
  | 'leads_collected'
  | 'export_csv'
  | 'export_md'
  | 'rule_added'
  | 'rule_removed'
  | 'status_changed'
  | 'note_saved'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the extension was used, last 30. */
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

export function track(event: MetricEvent, count = 1): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + count;
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
