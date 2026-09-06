/**
 * The whole data model. One record type — a tracked job — moving through a
 * fixed set of stages (PRD §4's kanban). There is no separate "collection"
 * concept the way the Saver-pattern extensions have one: the stage itself is
 * the organizing axis, and it's a closed set defined by the PRD, not
 * user-creatable.
 */

export type Stage = 'saved' | 'applied' | 'interviewing' | 'offer' | 'rejected' | 'withdrawn';

/** Display order for the panel's kanban sections and for every export (PRD §4). */
export const STAGES: ReadonlyArray<{ id: Stage; label: string }> = [
  { id: 'saved', label: 'Saved' },
  { id: 'applied', label: 'Applied' },
  { id: 'interviewing', label: 'Interviewing' },
  { id: 'offer', label: 'Offer' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'withdrawn', label: 'Withdrawn' },
];

export function isStage(value: unknown): value is Stage {
  return typeof value === 'string' && STAGES.some(s => s.id === value);
}

/** What the content script scrapes from a job posting before it becomes a TrackedJob. */
export interface RawJobCapture {
  jobUrl: string;
  title: string;
  company: string;
  location: string;
  postedDateRaw: string;
  /** Raw salary text as LinkedIn rendered it, or null when the posting shows none. */
  salaryRaw: string | null;
}

/** The tracked job — one card in the kanban (PRD §4 capture table + stage/note). */
export interface TrackedJob {
  /** Parsed from the job URL's numeric id; stable across re-tracks and across
   *  the two different page layouts that can show the same posting (PRD §7). */
  id: string;
  jobUrl: string;
  title: string;
  company: string;
  location: string;
  postedDateRaw: string;
  salaryRaw: string | null;
  stage: Stage;
  note: string;
  /** First time this job was tracked — preserved across re-tracks. */
  trackedAt: number;
  /** Last time the stage or note changed — drives the "days since last update" line (PRD §4). */
  lastActivityAt: number;
  /** Set when a passive re-visit of the posting finds it's no longer accepting
   *  applications (PRD §7) — never clears the user's note or stage. */
  stale: boolean;
}

export interface Backup {
  format: 'linkedin-job-tracker';
  version: 1;
  exportedAt: string;
  jobs: TrackedJob[];
}

export interface ImportResult {
  jobs: number;
}

export interface QuotaStatus {
  bytes: number;
  ratio: number;
  warn: boolean;
}

export type ExportFormat = 'csv' | 'md' | 'json';
