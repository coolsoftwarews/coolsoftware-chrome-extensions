/**
 * Local-only usage counters.
 *
 * PRD §9 wants installs-that-form-a-habit numbers (saves/week, collections
 * created, export used), and the hard constraint in
 * docs/extensions/README.md is that instrumentation never leaves the
 * device. Every event here is a counter in chrome.storage.local: no post URLs,
 * no handles, no captions, no timestamps beyond a day bucket. The user can
 * read and reset them from the panel's Usage sheet.
 *
 * The thumbnail fallback rate is the health number that matters most — if
 * capture starts failing and falling back to remote URLs, the library is
 * quietly rotting (PRD §6).
 */

const STORAGE_KEY = 'irs:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'save_button_clicked'
  | 'save_created'
  | 'save_updated'
  | 'save_deleted'
  | 'note_saved'
  | 'move_collection'
  | 'collection_created'
  | 'collection_renamed'
  | 'search_used'
  | 'post_opened'
  | 'export_csv'
  | 'export_md'
  | 'export_json'
  | 'data_exported'
  | 'data_imported'
  | 'thumbnail_captured'
  | 'thumbnail_fallback_remote';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the extension was used, last 30 — the retention signal from PRD §9. */
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

/** The health number from PRD §6 — how often a real thumbnail could be captured. */
export function thumbnailCaptureRate(metrics: Metrics): number | null {
  const captured = metrics.counts.thumbnail_captured ?? 0;
  const fallback = metrics.counts.thumbnail_fallback_remote ?? 0;
  const attempted = captured + fallback;
  if (!attempted) return null;
  return Math.round((captured / attempted) * 100);
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
