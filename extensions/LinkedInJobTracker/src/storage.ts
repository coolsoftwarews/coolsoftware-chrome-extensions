/**
 * chrome.storage.local is the whole backend. There is no server, no account
 * and no network call anywhere in this extension (PRD §6), which puts two
 * obligations on this file: never lose a tracked job, and always let the
 * user take their data out. One record family — tracked jobs — keyed by the
 * job id parsed out of the URL (capture.ts#jobIdFromUrl).
 */

import { moveStage, setStale, updateNote } from './capture';
import { Backup, ImportResult, QuotaStatus, Stage, TrackedJob, isStage } from './types';

const JOB_PREFIX = 'ljt:job:';

/** chrome.storage.local is 10 MB unless "unlimitedStorage" is requested. */
const QUOTA_BYTES = 10 * 1024 * 1024;
const WARN_RATIO = 0.8;

function jobKey(id: string): string {
  return JOB_PREFIX + id;
}

export async function readAllJobs(): Promise<TrackedJob[]> {
  const all = await chrome.storage.local.get(null);
  return Object.entries(all)
    .filter(([key]) => key.startsWith(JOB_PREFIX))
    .map(([, value]) => value as TrackedJob)
    .filter(job => job && job.id && job.jobUrl)
    .sort((a, b) => (b.trackedAt ?? 0) - (a.trackedAt ?? 0));
}

export async function readJob(id: string): Promise<TrackedJob | null> {
  const key = jobKey(id);
  const stored = await chrome.storage.local.get(key);
  return (stored?.[key] as TrackedJob | undefined) ?? null;
}

export async function writeJob(job: TrackedJob): Promise<void> {
  await chrome.storage.local.set({ [jobKey(job.id)]: job });
}

export async function deleteJob(id: string): Promise<void> {
  await chrome.storage.local.remove(jobKey(id));
}

/**
 * Persists a tracked job. `build` receives the existing card (if this job was
 * tracked before) so the caller can merge rather than duplicate — see
 * capture.ts#buildCapture. Storage failures are never swallowed: a quota
 * failure must fail loudly with an export prompt, never drop the item
 * silently (same rule as every Saver-pattern extension in this portfolio).
 */
export async function saveJob(id: string, build: (existing: TrackedJob | null) => TrackedJob): Promise<TrackedJob> {
  const existing = await readJob(id);
  const job = build(existing);
  try {
    await writeJob(job);
  } catch {
    throw new Error('Storage is full. Export your tracked jobs, then remove a few, and try again.');
  }
  return job;
}

export async function changeStage(id: string, stage: Stage): Promise<TrackedJob | null> {
  const existing = await readJob(id);
  if (!existing) return null;
  const updated = moveStage(existing, stage, Date.now());
  await writeJob(updated);
  return updated;
}

export async function changeNote(id: string, note: string): Promise<TrackedJob | null> {
  const existing = await readJob(id);
  if (!existing) return null;
  const updated = updateNote(existing, note, Date.now());
  await writeJob(updated);
  return updated;
}

/** Passive stale flag from a re-visit of a tracked posting (PRD §7) — never touches stage/note. */
export async function markStale(id: string, stale: boolean): Promise<TrackedJob | null> {
  const existing = await readJob(id);
  if (!existing) return null;
  const updated = setStale(existing, stale);
  if (updated === existing) return existing;
  await writeJob(updated);
  return updated;
}

export async function clearAllData(): Promise<void> {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter(key => key.startsWith(JOB_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

export async function quotaStatus(): Promise<QuotaStatus> {
  let bytes = 0;
  try {
    bytes = await chrome.storage.local.getBytesInUse(null);
  } catch {
    /* not implemented everywhere; treat as empty */
  }
  const ratio = bytes / QUOTA_BYTES;
  return { bytes, ratio, warn: ratio >= WARN_RATIO };
}

/* ── Whole-library operations ────────────────────────────────────────── */

export async function exportBackup(): Promise<Backup> {
  return {
    format: 'linkedin-job-tracker',
    version: 1,
    exportedAt: new Date().toISOString(),
    jobs: await readAllJobs(),
  };
}

/**
 * Merges a backup into local storage. Jobs are matched by id (the job's
 * numeric LinkedIn id), so importing the same file twice never duplicates a
 * card — the incoming file wins on conflicts, same rule every Saver-pattern
 * extension in this portfolio uses.
 */
export async function importBackup(raw: unknown): Promise<ImportResult> {
  const backup = raw as Partial<Backup>;
  if (!backup || backup.format !== 'linkedin-job-tracker' || !Array.isArray(backup.jobs)) {
    throw new Error('That file is not a LinkedIn Job Tracker backup.');
  }

  let imported = 0;
  for (const incoming of backup.jobs) {
    if (!incoming?.id || !incoming.jobUrl || !isStage(incoming.stage)) continue;
    await writeJob(incoming);
    imported++;
  }

  return { jobs: imported };
}
