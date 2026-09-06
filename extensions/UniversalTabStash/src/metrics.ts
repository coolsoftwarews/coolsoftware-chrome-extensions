/**
 * Local-only usage counters. Nothing leaves the device: no URLs, no titles, no
 * timestamps beyond a day bucket. The user can read and reset them from the
 * panel. Same pattern and contract as WebHighlighter's metrics.ts.
 *
 * The ratio worth watching (PRD §8) is stash-created vs stash-restored — a
 * tool that only accumulates stashes nobody reopens is a tab graveyard.
 */

const STORAGE_KEY = 'uts:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'stash_created'
  | 'tabs_closed_on_stash'
  | 'stash_restored_all'
  | 'tab_restored_single'
  | 'search_used'
  | 'export_md'
  | 'export_csv'
  | 'data_exported'
  | 'data_imported'
  | 'stash_deleted';

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

/** The health ratio from PRD §8: restores per stash created. Null until there
 *  is at least one stash to compare against. */
export function restoreRatio(metrics: Metrics): number | null {
  const created = metrics.counts.stash_created ?? 0;
  if (!created) return null;
  const restored = metrics.counts.stash_restored_all ?? 0;
  return Math.round((restored / created) * 100);
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
