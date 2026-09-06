/**
 * Local-only usage counters (hard constraint: "local-only instrumentation").
 * No URLs, no search terms, no listing data — only totals, a day bucket, and
 * a set of anonymous query-key hashes so "searches analysed" can be counted
 * without storing what anyone searched for.
 */

const STORAGE_KEY = 'enf:metrics';
const MAX_TRACKED_QUERIES = 50;

export type MetricEvent =
  | 'popup_opened'
  | 'strip_shown'
  | 'snapshot_saved'
  | 'filters_applied'
  | 'tag_view_opened'
  | 'export_csv'
  | 'export_md'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** One-way hashes of query keys analysed, so "≥5 searches" can be counted locally. */
  queriesAnalyzed: string[];
  /** Days (YYYY-MM-DD) the extension was used, last 30. */
  activeDays: string[];
}

const EMPTY: Metrics = { counts: {}, queriesAnalyzed: [], activeDays: [] };

/** A non-reversible fingerprint — never the query text itself. */
async function hashQueryKey(queryKey: string): Promise<string> {
  try {
    const bytes = new TextEncoder().encode(queryKey);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest).slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    // SubtleCrypto unavailable for some reason — fall back to a coarse, still
    // non-reversible bucket rather than storing the query key itself.
    let h = 0;
    for (let i = 0; i < queryKey.length; i++) h = (h * 31 + queryKey.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }
}

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      queriesAnalyzed: value?.queriesAnalyzed ?? [],
      activeDays: value?.activeDays ?? [],
    };
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

/** Records that a search/category page was successfully read (strip shown). */
export async function trackQueryAnalyzed(queryKey: string): Promise<void> {
  const hash = await hashQueryKey(queryKey);
  await enqueue(metrics => {
    if (!metrics.queriesAnalyzed.includes(hash)) {
      metrics.queriesAnalyzed = [...metrics.queriesAnalyzed, hash].slice(-MAX_TRACKED_QUERIES);
    }
  });
}

/** PRD-20 §9 success metric: "users who analyse ≥5 searches". */
export function distinctQueriesAnalyzed(metrics: Metrics): number {
  return metrics.queriesAnalyzed.length;
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
