/**
 * Local-only usage counters (README "Hard constraints": local-only
 * instrumentation, nothing that leaves the device). These are what the popup
 * shows under "Usage" and what would answer PRD §8's success metrics if read
 * by the developer directly off a volunteer's machine — never transmitted.
 *
 * `parse_failure` is the health counter PRD §6 asks for: "Parse failure shows
 * one quiet notice; the profile page is never broken." If that number climbs,
 * TikTok's DOM moved and selectors.ts needs attention.
 */

import { MetricKey, Metrics } from './types';

const STORAGE_KEY = 'tco:metrics';
const MAX_PROFILES_TRACKED = 200;

const EMPTY: Metrics = { counts: {}, profilesAnalyzed: [] };

export async function readMetrics(): Promise<Metrics> {
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored?.[STORAGE_KEY] as Partial<Metrics> | undefined;
    return {
      counts: value?.counts ?? {},
      profilesAnalyzed: value?.profilesAnalyzed ?? [],
    };
  } catch {
    return { ...EMPTY, counts: {}, profilesAnalyzed: [] };
  }
}

let queue: Promise<void> = Promise.resolve();

function enqueue(mutate: (metrics: Metrics) => void): Promise<void> {
  queue = queue.then(async () => {
    const metrics = await readMetrics();
    mutate(metrics);
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: metrics });
    } catch {
      /* counters are best-effort; never break a feature over them */
    }
  });
  return queue;
}

export function track(event: MetricKey): Promise<void> {
  return enqueue(metrics => {
    metrics.counts[event] = (metrics.counts[event] ?? 0) + 1;
  });
}

/** Records a profile as "analysed" the first time it's scanned in a session. */
export function trackProfile(profileId: string): Promise<void> {
  return enqueue(metrics => {
    if (metrics.profilesAnalyzed.includes(profileId)) return;
    metrics.profilesAnalyzed = [...metrics.profilesAnalyzed, profileId].slice(-MAX_PROFILES_TRACKED);
  });
}

export function distinctProfileCount(metrics: Metrics): number {
  return metrics.profilesAnalyzed.length;
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
