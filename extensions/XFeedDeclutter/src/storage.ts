/**
 * chrome.storage.local is the whole backend — no server, no account, no
 * network call anywhere in this extension (PRD §5/§6). What persists is
 * exactly two things: the five toggle values, and the small local usage
 * counters named in PRD §4/§8. Nothing about what a user actually saw —
 * no post text, no ad content, no counts — is ever written here; a hidden
 * node leaves no trace once it's off-screen.
 *
 * There is deliberately no export/import/backup surface here, unlike most
 * of this portfolio's other extensions. Every other extension in the README
 * "Hard constraints" list owes the user export-all/import/clear-all because
 * it stores *content the user created* (highlights, saved posts, notes).
 * This product stores five booleans and two counters — there is nothing to
 * meaningfully export as a portable file, so "Reset to defaults" (below)
 * covers the whole data-ownership story instead. See PRIVACY.md.
 */

import { DEFAULT_TOGGLES, Metrics, ToggleKey, ToggleState, emptyMetrics } from './types';

const TOGGLES_KEY = 'xfd:toggles';
const METRICS_KEY = 'xfd:metrics';

/* ── Toggles ─────────────────────────────────────────────────────────── */

export async function readToggles(): Promise<ToggleState> {
  const stored = await chrome.storage.local.get(TOGGLES_KEY);
  return { ...DEFAULT_TOGGLES, ...((stored?.[TOGGLES_KEY] as Partial<ToggleState>) ?? {}) };
}

export async function writeToggles(toggles: ToggleState): Promise<void> {
  await chrome.storage.local.set({ [TOGGLES_KEY]: toggles });
}

/** Removes the stored toggle key entirely (not just writes the defaults
 * over it) — the next readToggles() falls back to DEFAULT_TOGGLES. This is
 * the "clear all data" this product owes the user for the one thing it
 * stores that isn't a usage counter (README "Hard constraints"); usage
 * counters get their own separate clearMetrics() below, same split
 * FacebookAdWinner/XVelocityFinder use elsewhere in this portfolio. */
export async function clearToggles(): Promise<void> {
  await chrome.storage.local.remove(TOGGLES_KEY);
}

/** Fires on any chrome.storage.local write, in every extension context
 * (including the one that made the write) — this is how the content script
 * picks up a toggle flipped from the popup without any message passing. */
export function onTogglesChanged(callback: (toggles: ToggleState) => void): void {
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[TOGGLES_KEY]) return;
    callback({ ...DEFAULT_TOGGLES, ...((changes[TOGGLES_KEY].newValue as Partial<ToggleState>) ?? {}) });
  });
}

/* ── Local-only usage counters ───────────────────────────────────────── */

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(METRICS_KEY);
    const value = stored?.[METRICS_KEY] as Partial<Metrics> | undefined;
    const empty = emptyMetrics();
    return {
      toggleOnCount: { ...empty.toggleOnCount, ...(value?.toggleOnCount ?? {}) },
      toggleOffCount: { ...empty.toggleOffCount, ...(value?.toggleOffCount ?? {}) },
      sessionCount: value?.sessionCount ?? 0,
      popupOpenCount: value?.popupOpenCount ?? 0,
    };
  } catch {
    return emptyMetrics();
  }
}

async function writeMetrics(metrics: Metrics): Promise<void> {
  try {
    await chrome.storage.local.set({ [METRICS_KEY]: metrics });
  } catch {
    /* counters are best-effort; never break a feature over them */
  }
}

/** Read-modify-write against one key, chained so concurrent bumps (a toggle
 * flip and a session start landing in the same tick) don't drop each other. */
let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    await writeMetrics(metrics);
  });
  return queue;
}

export function trackToggleFlip(key: ToggleKey, enabled: boolean): Promise<void> {
  return enqueue(metrics => {
    if (enabled) metrics.toggleOnCount[key] = (metrics.toggleOnCount[key] ?? 0) + 1;
    else metrics.toggleOffCount[key] = (metrics.toggleOffCount[key] ?? 0) + 1;
  });
}

export function trackSessionStart(): Promise<void> {
  return enqueue(metrics => {
    metrics.sessionCount += 1;
  });
}

export function trackPopupOpened(): Promise<void> {
  return enqueue(metrics => {
    metrics.popupOpenCount += 1;
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
