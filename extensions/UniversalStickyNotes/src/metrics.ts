/**
 * Local-only usage counters.
 *
 * PRD §8 wants numbers, and this product's entire positioning is that
 * nothing leaves the device. Every event is a counter in
 * chrome.storage.local: no URLs, no page titles, no note text, no timestamps
 * beyond a day bucket. The user can read and reset them from the panel.
 *
 * note_created is the health metric — this is meant to be a one-click
 * reflex, and a low creation rate signals the first-run experience failed to
 * teach the product (PRD §9).
 */

const STORAGE_KEY = 'sn:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'note_created'
  | 'note_deleted'
  | 'note_recolored'
  | 'note_dragged'
  | 'note_resized'
  | 'note_text_saved'
  | 'hide_toggled'
  | 'panel_search_used'
  | 'page_jumped_to'
  | 'export_markdown'
  | 'data_exported'
  | 'data_imported'
  | 'data_cleared';

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
