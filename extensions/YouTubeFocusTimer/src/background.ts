/**
 * Service worker. Exists for exactly one reason: coordinating the session
 * timer across every open YouTube tab so time is measured once, globally,
 * never once per tab (PRD §7's "must not double-count" edge case). Routing
 * every tick through this single service-worker instance makes the
 * accumulation single-writer — no read-modify-write race between tabs is
 * possible, because only this file ever writes the cursor.
 *
 * The interval below runs *only* while at least one YouTube tab has an open
 * port, which only happens while that tab is actually being watched
 * (content.ts opens the port on focus+visible, closes it on blur/hide/
 * unload — see content.ts's `updateWatchState`). Nothing here ever polls on
 * its own, wakes up on a timer with no tab watching, or makes a network
 * request. No fetch, no XMLHttpRequest, no sendBeacon — see PRIVACY.md.
 */
import { addMs, pruneOldDays } from './aggregate';
import { accumulate, HEARTBEAT_INTERVAL_MS } from './session';
import { readCursor, readTotals, writeCursor, writeTotals } from './storage';
import { splitByDay } from './time';

const PORT_NAME = 'ft-watch';
const openPorts = new Set<chrome.runtime.Port>();
let intervalId: ReturnType<typeof setInterval> | null = null;

async function tick(): Promise<void> {
  const now = Date.now();
  const cursor = await readCursor();
  const { addedMs, nextLastTickAt } = accumulate(cursor, now);
  await writeCursor(nextLastTickAt);
  if (addedMs <= 0) return;

  const parts = splitByDay(now - addedMs, now);
  let totals = await readTotals();
  for (const part of parts) totals = addMs(totals, part.dateKey, part.ms);
  await writeTotals(pruneOldDays(totals, now));
}

function startTicking(): void {
  if (intervalId !== null) return;
  // Resets the cursor cleanly (discarding any stale gap since the last
  // session — accumulate() already handles that) and picks up any elapsed
  // time immediately rather than waiting a full interval for the first tick.
  void tick();
  intervalId = setInterval(() => void tick(), HEARTBEAT_INTERVAL_MS);
}

async function stopTicking(): Promise<void> {
  if (intervalId === null) return;
  clearInterval(intervalId);
  intervalId = null;
  await tick(); // flush whatever elapsed since the last heartbeat
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  openPorts.add(port);
  startTicking();

  port.onDisconnect.addListener(() => {
    openPorts.delete(port);
    if (openPorts.size === 0) void stopTicking();
  });
});
