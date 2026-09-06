/**
 * The export layer: a list of tracked jobs in, CSV or Markdown out. JSON
 * export is the backup itself (see storage.ts#exportBackup) — this file only
 * handles the two human-facing formats. Deliberately pure — no DOM, no
 * chrome.* — so scripts/selftest.mjs can check every format headlessly.
 */

import { daysSince } from './capture';
import { STAGES, Stage, TrackedJob } from './types';

function csvCell(value: string): string {
  const needsQuotes = /[",\n\r]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuotes ? `"${escaped}"` : escaped;
}

function stageLabel(stage: Stage): string {
  return STAGES.find(s => s.id === stage)?.label ?? stage;
}

const CSV_HEADERS = [
  'Stage',
  'Title',
  'Company',
  'Location',
  'Salary',
  'Posted',
  'Job URL',
  'Tracked date',
  'Last updated',
  'Days since update',
  'Stale',
  'Note',
];

/** One row per tracked job, every field from PRD §4's capture table plus stage/note. */
export function toCsv(jobs: TrackedJob[], now: number = Date.now()): string {
  const rows = [CSV_HEADERS.map(csvCell).join(',')];
  for (const job of jobs) {
    rows.push(
      [
        stageLabel(job.stage),
        job.title,
        job.company,
        job.location,
        job.salaryRaw ?? '',
        job.postedDateRaw,
        job.jobUrl,
        new Date(job.trackedAt).toISOString(),
        new Date(job.lastActivityAt).toISOString(),
        String(daysSince(job.lastActivityAt, now)),
        job.stale ? 'Yes' : 'No',
        job.note,
      ]
        .map(csvCell)
        .join(',')
    );
  }
  return rows.join('\r\n') + '\r\n';
}

/** One section per stage, one entry per job — the same grouping the panel's kanban uses. */
export function toMarkdown(jobs: TrackedJob[], now: number = Date.now()): string {
  if (!jobs.length) return '_No tracked jobs yet._\n';

  const byStage = new Map<Stage, TrackedJob[]>();
  for (const job of jobs) {
    const list = byStage.get(job.stage) ?? [];
    list.push(job);
    byStage.set(job.stage, list);
  }

  const parts: string[] = [];
  for (const { id, label } of STAGES) {
    const list = (byStage.get(id) ?? []).sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    if (!list.length) continue;

    parts.push(`# ${label}`, '');
    for (const job of list) {
      const heading = [job.title || 'Untitled role', job.company ? `— ${job.company}` : ''].filter(Boolean).join(' ');
      parts.push(`## ${heading}`, '');
      const meta: string[] = [];
      if (job.location) meta.push(`Location: ${job.location}`);
      if (job.salaryRaw) meta.push(`Salary: ${job.salaryRaw}`);
      if (job.postedDateRaw) meta.push(`Posted: ${job.postedDateRaw}`);
      if (meta.length) parts.push(`- ${meta.join(' · ')}`);
      parts.push(`- Tracked: ${new Date(job.trackedAt).toISOString().slice(0, 10)} · Updated ${daysSince(job.lastActivityAt, now)} day(s) ago`);
      if (job.stale) parts.push('- ⚠️ No longer accepting applications (as of last visit)');
      parts.push('');
      if (job.note.trim()) parts.push(`**Note:** ${job.note.trim()}`, '');
      parts.push(`[Open posting](${job.jobUrl})`, '');
    }
  }

  return (parts.length ? parts.join('\n') : '_No tracked jobs yet._').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

export function buildExportFilename(kind: 'csv' | 'md' | 'json'): string {
  const stamp = new Date().toISOString().slice(0, 10);
  return `linkedin-job-tracker-${stamp}.${kind}`;
}
