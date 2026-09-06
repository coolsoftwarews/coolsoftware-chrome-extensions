/**
 * Local-only usage counters.
 *
 * PRD §9 wants numbers, and this product's entire positioning is that nothing
 * leaves the device. So every event is a counter in chrome.storage.local: no
 * URLs, no page titles, no quote text, no timestamps beyond a day bucket. The
 * user can read and reset them from the panel.
 *
 * The counter that matters most is the re-anchor rate — if restoration starts
 * failing, the product is rotting quietly and this is the only place it shows.
 */

const STORAGE_KEY = 'wh:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'highlight_created'
  | 'highlight_deleted'
  | 'color_changed'
  | 'note_attached'
  | 'page_note_saved'
  | 'scroll_to_used'
  | 'copy_markdown'
  | 'export_md'
  | 'export_html'
  | 'export_pdf'
  | 'export_txt'
  | 'scope_highlights'
  | 'scope_page'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** Highlights we tried to restore, and how that went. */
  anchor: { attempted: number; exact: number; whitespace: number; fuzzy: number; failed: number };
  /** Days (YYYY-MM-DD) the extension was used, last 30. */
  activeDays: string[];
}

const EMPTY: Metrics = {
  counts: {},
  anchor: { attempted: 0, exact: 0, whitespace: 0, fuzzy: 0, failed: 0 },
  activeDays: [],
};

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      anchor: { ...EMPTY.anchor, ...(value?.anchor ?? {}) },
      activeDays: value?.activeDays ?? [],
    };
  } catch {
    return { ...EMPTY, anchor: { ...EMPTY.anchor } };
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

export function trackAnchoring(outcomes: Array<'exact' | 'whitespace' | 'fuzzy' | 'failed'>): Promise<void> {
  if (!outcomes.length) return Promise.resolve();
  return enqueue(metrics => {
    metrics.anchor.attempted += outcomes.length;
    for (const outcome of outcomes) metrics.anchor[outcome] += 1;
  });
}

/** The health number from PRD §9, as a percentage. Null until there is data. */
export function anchorSuccessRate(metrics: Metrics): number | null {
  if (!metrics.anchor.attempted) return null;
  const restored = metrics.anchor.attempted - metrics.anchor.failed;
  return Math.round((restored / metrics.anchor.attempted) * 100);
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
