/**
 * Local-only usage counters (README "hard constraints": local-only
 * instrumentation). PRD §8 wants numbers for retention, theme-assignment rate
 * and export rate — export rate especially, since export is the point of this
 * product. Every event is a counter in chrome.storage.local: no URLs, no
 * quote text, no usernames, no timestamps beyond a day bucket. Readable and
 * resettable from the panel's Usage sheet.
 */

const STORAGE_KEY = 'rvoc:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'quote_saved'
  | 'quote_replaced'
  | 'quote_duplicate'
  | 'quote_deleted'
  | 'theme_assigned'
  | 'theme_created'
  | 'theme_renamed'
  | 'theme_deleted'
  | 'note_added'
  | 'author_hidden'
  | 'anonymize_toggled'
  | 'search_used'
  | 'permalink_opened'
  | 'copy_markdown'
  | 'export_md'
  | 'export_csv'
  | 'export_json'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the extension was used, last 30 — the retention proxy. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return { counts: value?.counts ?? {}, activeDays: value?.activeDays ?? [] };
  } catch {
    return { counts: { ...EMPTY.counts }, activeDays: [...EMPTY.activeDays] };
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
