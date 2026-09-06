/**
 * The session-timer's core reducer — pure, no chrome.*, no DOM, no real
 * timers. This is the whole "must not double-count across tabs" mechanism
 * from PRD §7: time is measured once, globally, by advancing a single
 * "last accounted for" cursor by wall-clock elapsed time, never by summing
 * independent per-tab durations. The background service worker (the only
 * writer of the cursor — see background.ts) calls `accumulate()` on a fixed
 * heartbeat while at least one tab is being watched; how many tabs are
 * connected at once cannot change the result, only *whether* it ticks at all.
 */

/** How often the background service worker ticks while ≥1 tab is watching. */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * A gap between heartbeats longer than this is treated as "not actually
 * watched" rather than credited — the laptop-sleep / lid-close edge case
 * (PRD §7). Three missed heartbeats' worth of grace absorbs normal
 * scheduling jitter without absorbing a real sleep/wake gap of minutes.
 */
export const MAX_GAP_MS = HEARTBEAT_INTERVAL_MS * 3;

export interface TickResult {
  /** Milliseconds to credit as watched since the previous tick. Never negative. */
  addedMs: number;
  /** The cursor value to persist for the next call. */
  nextLastTickAt: number;
}

/**
 * Advances the cursor by one heartbeat.
 *
 * - `lastTickAt === null` (first tick ever, or the cursor was reset when
 *   watching stopped and later restarted): nothing is credited, the cursor
 *   is simply seeded at `now`.
 * - `now <= lastTickAt` (clock skew, or a stale/racing call): nothing is
 *   credited; never let a bad reading produce negative or duplicate time.
 * - A gap larger than `MAX_GAP_MS`: nothing is credited (sleep/crash), but
 *   the cursor still advances to `now` so the gap is never retroactively
 *   picked up by a later, unrelated tick.
 * - Otherwise: the full gap is credited.
 */
export function accumulate(lastTickAt: number | null, now: number): TickResult {
  if (lastTickAt === null || now <= lastTickAt) {
    return { addedMs: 0, nextLastTickAt: now };
  }
  const gap = now - lastTickAt;
  const addedMs = gap > MAX_GAP_MS ? 0 : gap;
  return { addedMs, nextLastTickAt: now };
}

/**
 * Whether the gentle end-of-session reminder (PRD §4) should show right now.
 * Pure: the caller owns the "continuous watching" clock and the
 * already-shown flag for the current streak; this function just applies the
 * threshold. `thresholdMs` of `null` or `<= 0` means the reminder is off.
 */
export function shouldRemind(continuousWatchMs: number, thresholdMs: number | null, alreadyShownThisStreak: boolean): boolean {
  if (thresholdMs === null || thresholdMs <= 0) return false;
  if (alreadyShownThisStreak) return false;
  return continuousWatchMs >= thresholdMs;
}
