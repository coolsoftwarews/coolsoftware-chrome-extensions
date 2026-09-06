/**
 * Local-only usage counters (PRD §8 wants these, portfolio README wants them
 * to never leave the device). No URLs, no product titles, no review text —
 * only counts and day buckets. Readable and resettable from the panel.
 *
 * These line up with PRD §8's success metrics so the numbers the seller sees
 * in the panel are the same shape as the ones being tracked for the product:
 * products analysed, themes expanded, exports used.
 */

const STORAGE_KEY = 'ari:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'analysis_viewed'
  | 'theme_expanded'
  | 'filter_applied'
  | 'note_saved'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported'
  | 'data_cleared';

export interface Metrics {
  counts: Record<string, number>;
  /** Distinct ASINs ever analysed — the "used on >= 3 products" metric. */
  asinsAnalyzed: string[];
  /** Days (YYYY-MM-DD) the extension was used, last 30. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, asinsAnalyzed: [], activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      asinsAnalyzed: value?.asinsAnalyzed ?? [],
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

export function trackAnalyzed(asin: string): Promise<void> {
  return enqueue(metrics => {
    if (!metrics.asinsAnalyzed.includes(asin)) metrics.asinsAnalyzed = [...metrics.asinsAnalyzed, asin];
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
