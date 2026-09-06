/** Pure CSV export + filename builder — no DOM, no chrome.*. */
import type { DailyTotals } from './types';
import { dateKeyLocal } from './time';

/** One row per date key, in the order given (the caller decides oldest-first vs newest-first). */
export function buildSessionCsv(totals: DailyTotals, dateKeys: string[]): string {
  const header = 'Date,Minutes watched';
  const rows = dateKeys.map((key) => `${key},${Math.round((totals[key] ?? 0) / 60_000)}`);
  return [header, ...rows].join('\r\n') + '\r\n';
}

/** `{prefix} - {YYYY-MM-DD}.{ext}` — sanitized and length-capped like every other export in this portfolio. */
export function buildFilename(prefix: string, ext: string, date: Date = new Date()): string {
  const stamp = dateKeyLocal(date.getTime());
  // eslint-disable-next-line no-control-regex
  const safePrefix = prefix.replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 80) || 'export';
  return `${safePrefix} - ${stamp}.${ext}`;
}
