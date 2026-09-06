/**
 * Local-only usage counters — the README's "local-only instrumentation"
 * constraint applied to this product: rules active, hit counts, posts hidden
 * today. No group/post text, no author names, nothing that leaves the
 * device; every event is a counter in chrome.storage.local, readable and
 * resettable from the panel footer.
 */

const STORAGE_KEY = 'xkm:metrics';

export type MetricEvent =
  | 'panel_opened'
  | 'rule_created'
  | 'rule_edited'
  | 'rule_deleted'
  | 'starter_pack_used'
  | 'post_hidden'
  | 'post_shown_anyway'
  | 'rule_flagged_broad'
  | 'data_exported'
  | 'data_imported';

export interface Metrics {
  counts: Record<string, number>;
  /** Days (YYYY-MM-DD) the extension was used, capped at the last 30. */
  activeDays: string[];
  /** Posts hidden, by day (YYYY-MM-DD), capped at the last 30 — the PRD/README's
   *  "posts hidden today" figure is `dailyHidden[today] ?? 0`. */
  dailyHidden: Record<string, number>;
}

const EMPTY: Metrics = { counts: {}, activeDays: [], dailyHidden: {} };

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      activeDays: value?.activeDays ?? [],
      dailyHidden: value?.dailyHidden ?? {},
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

/**
 * Every counter is a read-modify-write against one storage key, so
 * concurrent calls (a fast-scrolling feed hiding several posts at once)
 * would drop increments. Chaining them costs nothing at this volume.
 */
let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    await write(metrics);
  });
  return queue;
}

export function track(event: MetricEvent): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;
    const day = today();
    if (!metrics.activeDays.includes(day)) {
      metrics.activeDays = [...metrics.activeDays, day].slice(-30);
    }
    if (event === 'post_hidden') {
      metrics.dailyHidden[day] = (metrics.dailyHidden[day] ?? 0) + 1;
      // Trim to the last 30 days seen so this never grows unbounded.
      const days = Object.keys(metrics.dailyHidden).sort();
      if (days.length > 30) {
        for (const stale of days.slice(0, days.length - 30)) delete metrics.dailyHidden[stale];
      }
    }
  });
}

export function hiddenToday(metrics: Metrics): number {
  return metrics.dailyHidden[today()] ?? 0;
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
