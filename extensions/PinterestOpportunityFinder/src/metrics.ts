/**
 * Local-only usage counters, matching the PRD's success metrics (§8): panel
 * opens, analysed searches, keyword panel opens, and export usage. Everything
 * is a counter in chrome.storage.local — no query text, no domains, no
 * timestamps beyond a day bucket, nothing that leaves the device. Readable
 * and clearable from the panel footer.
 */

const STORAGE_KEY = 'pof_metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'search_analyzed'
  | 'keyword_panel_opened'
  | 'filter_applied'
  | 'export_pins_csv'
  | 'export_keywords_csv'
  | 'export_report_md'
  | 'rescan_used';

export interface Metrics {
  counts: Record<string, number>;
  /** Distinct queries analysed, capped — used to compute "≥3 analysed searches" without storing the query text itself. */
  analyzedQueries: string[];
  /** Days (YYYY-MM-DD) the panel was used, capped at the last 30. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, analyzedQueries: [], activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      analyzedQueries: value?.analyzedQueries ?? [],
      activeDays: value?.activeDays ?? [],
    };
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

let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void | Promise<void>): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    await mutate(metrics);
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

/** Hashed rather than raw, so the query text itself never sits in storage — only enough to count distinct searches. */
async function hashQuery(query: string): Promise<string> {
  const bytes = new TextEncoder().encode(query.trim().toLowerCase());
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function trackSearchAnalyzed(query: string): Promise<void> {
  return enqueue(async metrics => {
    metrics.counts.search_analyzed = (metrics.counts.search_analyzed ?? 0) + 1;
    const today = new Date().toISOString().slice(0, 10);
    if (!metrics.activeDays.includes(today)) metrics.activeDays = [...metrics.activeDays, today].slice(-30);
    const hash = await hashQuery(query);
    if (!metrics.analyzedQueries.includes(hash)) {
      metrics.analyzedQueries = [...metrics.analyzedQueries, hash].slice(-200);
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
