/**
 * Local-only usage counters. Nothing here leaves the device — no post text,
 * no URLs, just event counts and day buckets (PRD §6: no network requests
 * anywhere in this extension).
 */

const STORAGE_KEY = 'pdb:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'overlay_shown'
  | 'draft_saved'
  | 'draft_autosaved'
  | 'template_saved'
  | 'template_inserted'
  | 'published_archived'
  | 'published_updated'
  | 'item_deleted'
  | 'search_used'
  | 'export_csv'
  | 'export_md'
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

export function track(event: MetricEvent, amount = 1): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + amount;
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
