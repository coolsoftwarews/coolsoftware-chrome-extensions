/**
 * Turns a raw scrape (whatever content.ts / scrape.ts could read off the
 * page) into a tracked job, plus the stage-transition and dedupe logic.
 * Deliberately pure — no DOM, no chrome.* — so scripts/selftest.mjs can check
 * it headlessly. The DOM-bound half that produces a RawJobCapture lives in
 * scrape.ts and is covered by the manual checklist in README.md, same split
 * as InstagramResearchSaver's capture.ts / scrape.ts.
 */

import { Stage, RawJobCapture, TrackedJob } from './types';

const MAX_TEXT_LENGTH = 300;

function clamp(text: string): string {
  const trimmed = (text ?? '').trim();
  return trimmed.length > MAX_TEXT_LENGTH ? trimmed.slice(0, MAX_TEXT_LENGTH) : trimmed;
}

/**
 * A job posting is reachable two different ways on LinkedIn — a permalink
 * page (`/jobs/view/{id}/...`) and a detail pane inside search/collections
 * results (`?currentJobId={id}`) — and PRD §7 requires both to dedupe to the
 * same tracked card. Read the id from whichever one the URL actually has,
 * never from anything layout-specific.
 */
export function jobIdFromUrl(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl, 'https://www.linkedin.com');
    const queryId = url.searchParams.get('currentJobId');
    if (queryId && /^\d+$/.test(queryId)) return queryId;
    const match = url.pathname.match(/\/jobs\/view\/(?:[^/]*-)?(\d+)/);
    if (match) return match[1];
    return null;
  } catch {
    return null;
  }
}

/** Canonical `https://www.linkedin.com/jobs/view/{id}/` — the same URL for
 *  every job regardless of which page layout it was tracked from. */
export function normalizeJobUrl(rawUrl: string, id: string | null): string {
  if (id) return `https://www.linkedin.com/jobs/view/${id}/`;
  try {
    const url = new URL(rawUrl, 'https://www.linkedin.com');
    url.hash = '';
    return url.toString();
  } catch {
    return rawUrl;
  }
}

/**
 * Builds (or updates) the tracked-job card. Re-tracking the same job (PRD
 * §7's "viewed twice" edge case, and the general "re-visit and re-track"
 * case) refreshes metadata — title, company, location, posted date, salary —
 * but never moves the stage the user has it in, never overwrites the note,
 * and never moves the original tracked date. A field a later view didn't
 * expose (e.g. the search-pane view showing no salary this time) falls back
 * to what's already stored rather than blanking it out.
 */
export function buildCapture(raw: RawJobCapture, existing: TrackedJob | null, now: number): TrackedJob {
  const id = jobIdFromUrl(raw.jobUrl) ?? existing?.id ?? raw.jobUrl.trim().toLowerCase();
  return {
    id,
    jobUrl: normalizeJobUrl(raw.jobUrl, jobIdFromUrl(raw.jobUrl)),
    title: clamp(raw.title) || existing?.title || '',
    company: clamp(raw.company) || existing?.company || '',
    location: clamp(raw.location) || existing?.location || '',
    postedDateRaw: raw.postedDateRaw.trim() || existing?.postedDateRaw || '',
    salaryRaw: raw.salaryRaw?.trim() || existing?.salaryRaw || null,
    stage: existing?.stage ?? 'saved',
    note: existing?.note ?? '',
    trackedAt: existing?.trackedAt ?? now,
    lastActivityAt: existing?.lastActivityAt ?? now,
    // A fresh track/re-track means the user is looking at a live posting right
    // now — always clears any earlier stale flag (PRD §7's passive re-check
    // sets it back to true on its own if the posting is still closed).
    stale: false,
  };
}

/** Moving a job to a new stage is the one action that bumps "last update" (PRD §4). */
export function moveStage(job: TrackedJob, stage: Stage, now: number): TrackedJob {
  if (stage === job.stage) return job;
  return { ...job, stage, lastActivityAt: now };
}

/** Editing the note is the other action that counts as activity. */
export function updateNote(job: TrackedJob, note: string, now: number): TrackedJob {
  if (note === job.note) return job;
  return { ...job, note, lastActivityAt: now };
}

/**
 * Marks (or clears) the stale flag from a passive re-visit (PRD §7). This is
 * metadata-only — it never touches stage, note or lastActivityAt, because a
 * posting closing is not something the user *did*, and PRD §4's "days since
 * last update" line is specifically about the user's own activity on the
 * card, not the posting's lifecycle.
 */
export function setStale(job: TrackedJob, stale: boolean): TrackedJob {
  if (stale === job.stale) return job;
  return { ...job, stale };
}

/** Whole days between `lastActivityAt` and `now` — the panel's "Updated N days ago" line. */
export function daysSince(lastActivityAt: number, now: number): number {
  const ms = Math.max(0, now - lastActivityAt);
  return Math.floor(ms / 86_400_000);
}
