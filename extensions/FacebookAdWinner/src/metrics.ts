/**
 * Local-only usage counters.
 *
 * The PRD's success metrics (§8) ask "did users sort/filter by longevity",
 * "did users save an ad", "was export used" — all answerable from counts
 * that never leave the device. No ad ids, no advertiser names, no URLs,
 * nothing but totals and the days the extension was used. Readable and
 * resettable from the popup footer.
 */

const STORAGE_KEY = 'faw_metrics';

export type MetricEvent =
  | 'badges_rendered'
  | 'sort_used'
  | 'filter_used'
  | 'ad_saved'
  | 'ad_unsaved'
  | 'note_added'
  | 'collection_created'
  | 'search_used'
  | 'export_results_csv'
  | 'export_results_md'
  | 'export_swipefile_csv'
  | 'export_swipefile_md'
  | 'export_swipefile_json'
  | 'data_exported'
  | 'data_imported'
  | 'popup_opened'
  | 'parse_failure';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) on which the extension did something, capped at 30. */
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

/** Read-modify-write against one key; chained so concurrent calls don't drop increments. */
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
