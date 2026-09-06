/**
 * Local-only usage counters.
 *
 * PRD §9 wants installs-that-form-a-habit numbers (items saved, thread saves,
 * export used), and the hard constraint in docs/extensions/README.md is
 * that instrumentation never leaves the device. Every event here is a counter
 * in chrome.storage.local: no post text, no handles, no URLs, no timestamps
 * beyond a day bucket. The user can read and reset them from the panel's
 * Usage sheet.
 *
 * PRD §9/§10 single out the thread-save rate as the differentiator metric —
 * "if nobody uses it, we built a nicer bookmark" — so it gets its own derived
 * number below rather than being buried in the raw counts.
 */

const STORAGE_KEY = 'xcs:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'post_saved'
  | 'thread_saved'
  | 'conversation_saved'
  | 'item_updated'
  | 'item_deleted'
  | 'note_saved'
  | 'person_note_saved'
  | 'move_collection'
  | 'collection_renamed'
  | 'search_used'
  | 'post_opened'
  | 'export_csv'
  | 'export_md'
  | 'export_json'
  | 'data_exported'
  | 'data_imported'
  | 'data_cleared';

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

/** Share of saves that captured more than one post — PRD §9's "thread-save
 *  rate" and PRD §10's kill criterion (kill under 25%). Null until there's data. */
export function threadShareRate(metrics: Metrics): number | null {
  const posts = metrics.counts.post_saved ?? 0;
  const threads = (metrics.counts.thread_saved ?? 0) + (metrics.counts.conversation_saved ?? 0);
  const total = posts + threads;
  if (!total) return null;
  return Math.round((threads / total) * 100);
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
