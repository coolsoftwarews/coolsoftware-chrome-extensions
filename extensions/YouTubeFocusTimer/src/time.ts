/**
 * Pure date/time helpers. No DOM, no chrome.*, no locale-dependent formatting
 * (see the portfolio-wide `.toLocaleString()` lesson: never rely on the
 * runtime's own ICU locale for anything that has to be stable across
 * machines or assertable in a test) — everything here is hand-rolled.
 */

/** Local calendar date key, e.g. "2026-09-02" — always the *browser's own* timezone. */
export function dateKeyLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Epoch ms of the next local midnight strictly after `ms`. */
function nextLocalMidnight(ms: number): number {
  const d = new Date(ms);
  d.setHours(24, 0, 0, 0);
  return d.getTime();
}

/**
 * Splits an elapsed [startMs, endMs) span into per-day ms buckets, so a
 * heartbeat that straddles local midnight credits each calendar day only the
 * portion of the gap that actually fell on it (PRD §7's midnight rollover
 * edge case). Returns entries in chronological order; empty for a zero or
 * negative span.
 */
export function splitByDay(startMs: number, endMs: number): Array<{ dateKey: string; ms: number }> {
  const out: Array<{ dateKey: string; ms: number }> = [];
  if (endMs <= startMs) return out;

  let cursor = startMs;
  while (cursor < endMs) {
    const boundary = Math.min(nextLocalMidnight(cursor), endMs);
    out.push({ dateKey: dateKeyLocal(cursor), ms: boundary - cursor });
    cursor = boundary;
  }
  return out;
}

/** "1h 23m" / "42m" / "0m" — never seconds, the report is a minutes-level number by design. */
export function formatDuration(ms: number): string {
  const totalMinutes = Math.round(Math.max(0, ms) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return hours === 0 ? `${minutes}m` : `${hours}h ${minutes}m`;
}

const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Deliberately not `toLocaleDateString` — same locale-instability reason as formatDuration. */
export function shortWeekday(ms: number): string {
  return SHORT_WEEKDAYS[new Date(ms).getDay()];
}

/**
 * The `n` local date keys ending on the day containing `endMs`, oldest first.
 * Built from calendar-field subtraction (not `endMs - i * 86400000`) so a
 * daylight-saving transition day (23h or 25h long) can never shift a date
 * key by one.
 */
export function lastNDateKeys(endMs: number, n: number): string[] {
  const end = new Date(endMs);
  const keys: string[] = [];
  for (let i = n - 1; i >= 0; i -= 1) {
    const d = new Date(end.getFullYear(), end.getMonth(), end.getDate() - i);
    keys.push(dateKeyLocal(d.getTime()));
  }
  return keys;
}
