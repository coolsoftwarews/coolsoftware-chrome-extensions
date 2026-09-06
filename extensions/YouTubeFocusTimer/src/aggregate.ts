/**
 * Pure daily-totals bucket math. `DailyTotals` keys are 'YYYY-MM-DD' strings
 * (time.ts's dateKeyLocal), which sort lexicographically in exact calendar
 * order — every comparison below leans on that instead of re-parsing dates.
 */
import { dateKeyLocal } from './time';
import type { DailyTotals } from './types';

/** Adds `ms` of watched time to one day's bucket. No-op for zero/negative input. */
export function addMs(totals: DailyTotals, dateKey: string, ms: number): DailyTotals {
  if (ms <= 0) return totals;
  return { ...totals, [dateKey]: (totals[dateKey] ?? 0) + ms };
}

/** Sums whatever buckets exist for the given date keys; missing days count as 0. */
export function sumDays(totals: DailyTotals, dateKeys: string[]): number {
  return dateKeys.reduce((sum, key) => sum + (totals[key] ?? 0), 0);
}

/** Enough history for the 7-day chart plus real headroom, without unbounded storage growth. */
export const MAX_HISTORY_DAYS = 90;

/** Drops any day older than `MAX_HISTORY_DAYS` before `nowMs`'s calendar day. */
export function pruneOldDays(totals: DailyTotals, nowMs: number, maxDays: number = MAX_HISTORY_DAYS): DailyTotals {
  const now = new Date(nowMs);
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - maxDays);
  const cutoffKey = dateKeyLocal(cutoff.getTime());

  const out: DailyTotals = {};
  for (const [key, ms] of Object.entries(totals)) {
    if (key >= cutoffKey) out[key] = ms;
  }
  return out;
}
