/**
 * Local-only usage counters.
 *
 * PRD §8 wants habit-forming numbers (bookmarks indexed, search used, tagged/
 * foldered), and the hard constraint in docs/extensions/README.md is
 * that instrumentation never leaves the device. Every event here is a
 * counter in chrome.storage.local: no post text, no handles, no URLs, no
 * timestamps beyond a day bucket. The user can read and reset them from the
 * panel's Usage sheet.
 */

const STORAGE_KEY = 'xbo:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'bookmark_indexed'
  | 'bookmark_updated'
  | 'reindex_started'
  | 'reindex_completed'
  | 'tag_added'
  | 'note_saved'
  | 'move_collection'
  | 'collection_created'
  | 'collection_renamed'
  | 'search_used'
  | 'bookmark_opened'
  | 'item_deleted'
  | 'export_csv'
  | 'export_md'
  | 'export_json'
  | 'data_exported'
  | 'data_imported'
  | 'data_cleared';

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
