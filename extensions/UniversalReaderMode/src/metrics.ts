/**
 * Local-only usage counters (PRD-39 §8). No URLs, no page titles, no article
 * text, no identifiers — only totals and the dates the extension was used.
 *
 * The counter that matters most is the extraction rejection rate — PRD-39 §9
 * makes it a kill-criterion input. If it climbs, the extraction heuristic is
 * quietly failing more of the real pages people try it on.
 */

const STORAGE_KEY = 'urm:metrics';

export type MetricEvent =
  | 'reader_opened'
  | 'extraction_high_confidence'
  | 'extraction_low_confidence'
  | 'export_md'
  | 'export_pdf'
  | 'export_txt'
  | 'font_changed'
  | 'theme_changed'
  | 'width_changed'
  | 'font_size_changed'
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

export function track(event: MetricEvent): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;
  });
}

/** The health number from PRD-39 §8/§9, as a percentage. Null until there is data. */
export function extractionRejectionRate(metrics: Metrics): number | null {
  const high = metrics.counts.extraction_high_confidence ?? 0;
  const low = metrics.counts.extraction_low_confidence ?? 0;
  const total = high + low;
  if (!total) return null;
  return Math.round((low / total) * 100);
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
