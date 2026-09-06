import { EMPTY_FILTERS, type ChannelStats, type FilterState, type MetricKey, type Preset } from '../types';

const FILTER_KEY = 'ypf:filters';
const PRESET_KEY = 'ypf:presets';
const METRIC_KEY = 'ypf:metrics';
const CHANNEL_PREFIX = 'ypf:chan:';

/** Subscriber counts move slowly; a week-old number is fine for a min/max bound. */
export const CHANNEL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** A failed channel is re-tried after an hour rather than on every scroll. */
export const CHANNEL_FAIL_TTL_MS = 60 * 60 * 1000;

/* ── Filter state (session-scoped, per §4 "persists across searches") ──── */

export async function loadFilters(): Promise<FilterState> {
  const stored = await chrome.storage.session.get(FILTER_KEY);
  const value = stored[FILTER_KEY] as Partial<FilterState> | undefined;
  // Merge over the defaults so a state saved by an older version, missing
  // fields added since, still loads instead of producing undefined bounds.
  return { ...EMPTY_FILTERS, ...(value ?? {}) };
}

export async function saveFilters(filters: FilterState): Promise<void> {
  await chrome.storage.session.set({ [FILTER_KEY]: filters });
}

/* ── User presets (persistent) ────────────────────────────────────────── */

export async function loadUserPresets(): Promise<Preset[]> {
  const stored = await chrome.storage.local.get(PRESET_KEY);
  const value = stored[PRESET_KEY];
  return Array.isArray(value) ? (value as Preset[]) : [];
}

export async function saveUserPresets(presets: Preset[]): Promise<void> {
  await chrome.storage.local.set({ [PRESET_KEY]: presets });
}

/* ── Channel cache ────────────────────────────────────────────────────── */

export async function readChannelCache(channelKey: string): Promise<ChannelStats | null> {
  const key = CHANNEL_PREFIX + channelKey;
  const stored = await chrome.storage.local.get(key);
  const stats = stored[key] as ChannelStats | undefined;
  if (!stats) return null;

  const ttl = stats.failed ? CHANNEL_FAIL_TTL_MS : CHANNEL_TTL_MS;
  if (Date.now() - stats.fetchedAt > ttl) return null;
  return stats;
}

export async function writeChannelCache(stats: ChannelStats): Promise<void> {
  await chrome.storage.local.set({ [CHANNEL_PREFIX + stats.channelKey]: stats });
}

/* ── Local-only metrics ───────────────────────────────────────────────── */

/**
 * Bumps a counter in `chrome.storage.local`. Read-modify-write is racy under
 * concurrent bumps, which is acceptable: these counters inform a product
 * decision, not a billing ledger, and losing the occasional increment does
 * not change the shape of the signal.
 */
export async function bumpMetric(key: MetricKey, by = 1): Promise<void> {
  try {
    const stored = await chrome.storage.local.get(METRIC_KEY);
    const counters = (stored[METRIC_KEY] ?? {}) as Record<string, number>;
    counters[key] = (counters[key] ?? 0) + by;
    await chrome.storage.local.set({ [METRIC_KEY]: counters });
  } catch {
    // Metrics must never break the page.
  }
}

export async function readMetrics(): Promise<Record<string, number>> {
  const stored = await chrome.storage.local.get(METRIC_KEY);
  return (stored[METRIC_KEY] ?? {}) as Record<string, number>;
}

export async function clearMetrics(): Promise<void> {
  await chrome.storage.local.remove(METRIC_KEY);
}
