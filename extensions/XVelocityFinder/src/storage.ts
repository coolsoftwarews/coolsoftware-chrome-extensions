/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §5/§6). What persists is
 * exactly what PRD §4 names and nothing else: author medians and filter
 * settings. Post text and counts are never written to storage; they live in
 * memory for the current tab only and are gone on reload.
 */

import { AuthorBaseline, DEFAULT_FILTERS, FailureReason, FilterSettings, MetricEvent } from './types';

const BASELINE_PREFIX = 'xvf:baseline:';
const FILTERS_KEY = 'xvf:filters';
const METRICS_KEY = 'xvf:metrics';

/* ── Author baselines ───────────────────────────────────────────────── */

function baselineKey(handle: string): string {
  return BASELINE_PREFIX + handle.toLowerCase();
}

export async function readBaseline(handle: string): Promise<AuthorBaseline | undefined> {
  const key = baselineKey(handle);
  const stored = await chrome.storage.local.get(key);
  return stored?.[key] as AuthorBaseline | undefined;
}

export async function readBaselines(handles: string[]): Promise<Map<string, AuthorBaseline>> {
  if (!handles.length) return new Map();
  const keys = [...new Set(handles.map(baselineKey))];
  const stored = await chrome.storage.local.get(keys);
  const result = new Map<string, AuthorBaseline>();
  for (const handle of handles) {
    const value = stored?.[baselineKey(handle)] as AuthorBaseline | undefined;
    if (value) result.set(handle.toLowerCase(), value);
  }
  return result;
}

export async function writeBaseline(baseline: AuthorBaseline): Promise<void> {
  await chrome.storage.local.set({ [baselineKey(baseline.handle)]: baseline });
}

export async function readAllBaselines(): Promise<AuthorBaseline[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(BASELINE_PREFIX))
    .map(([, value]) => value as AuthorBaseline)
    .filter(value => value && Array.isArray(value.samples));
}

export async function clearBaselines(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(BASELINE_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

/* ── Filter settings ─────────────────────────────────────────────────── */

export async function readFilters(): Promise<FilterSettings> {
  const stored = await chrome.storage.local.get(FILTERS_KEY);
  return { ...DEFAULT_FILTERS, ...((stored?.[FILTERS_KEY] as Partial<FilterSettings>) ?? {}) };
}

export async function writeFilters(filters: FilterSettings): Promise<void> {
  await chrome.storage.local.set({ [FILTERS_KEY]: filters });
}

/* ── Whole-library operations (export all / import / clear all) ────────
 * Every product that stores anything owes the user these three (README
 * "Hard constraints"). Author medians are the only thing worth exporting —
 * filter settings are convenience, not data the user "created".
 */

export interface Backup {
  format: 'x-velocity-finder';
  version: 1;
  exportedAt: string;
  baselines: AuthorBaseline[];
  filters: FilterSettings;
}

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'x-velocity-finder',
    version: 1,
    exportedAt: new Date().toISOString(),
    baselines: await readAllBaselines(),
    filters: await readFilters(),
  };
}

export interface ImportResult {
  baselines: number;
}

export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'x-velocity-finder' || !Array.isArray(backup.baselines)) {
    throw new Error('That file is not an X Velocity Finder backup.');
  }

  let count = 0;
  for (const baseline of backup.baselines) {
    if (!baseline?.handle || !Array.isArray(baseline.samples)) continue;
    await writeBaseline(baseline);
    count++;
  }
  if (backup.filters) await writeFilters({ ...DEFAULT_FILTERS, ...backup.filters });

  return { baselines: count };
}

export async function clearAllData(): Promise<void> {
  await clearBaselines();
  await chrome.storage.local.remove(FILTERS_KEY);
}

/* ── Local-only usage counters ───────────────────────────────────────── */

export interface Metrics {
  counts: Record<string, number>;
  failures: Record<string, number>;
  activeDays: string[];
}

const EMPTY_METRICS: Metrics = { counts: {}, failures: {}, activeDays: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(METRICS_KEY);
    const value = stored?.[METRICS_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      failures: value?.failures ?? {},
      activeDays: value?.activeDays ?? [],
    };
  } catch {
    return { ...EMPTY_METRICS };
  }
}

async function writeMetrics(metrics: Metrics): Promise<void> {
  try {
    await chrome.storage.local.set({ [METRICS_KEY]: metrics });
  } catch {
    /* counters are best-effort; never break a feature over them */
  }
}

/** Read-modify-write against one key, chained so concurrent bumps don't drop each other. */
let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    await writeMetrics(metrics);
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

export function trackFailure(reason: FailureReason): Promise<void> {
  return enqueue(metrics => {
    metrics.failures[reason] = (metrics.failures[reason] ?? 0) + 1;
  });
}

export function clearMetrics(): Promise<void> {
  queue = queue.then(async () => {
    try {
      await chrome.storage.local.remove(METRICS_KEY);
    } catch {
      /* ignore */
    }
  });
  return queue;
}
