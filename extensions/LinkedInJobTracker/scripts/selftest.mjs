/**
 * Headless checks for the pure logic: job-id/URL dedupe, capture-card
 * creation and re-track merge semantics, stage transitions, the "days since
 * last update" indicator, text parsing (salary/location/date/closed
 * detection), CSV/Markdown export formatting, and the storage layer's
 * dedupe-on-retrack / import merge-by-id semantics.
 *
 * storage.ts talks to chrome.storage.local, which doesn't exist in Node — so
 * this file installs a tiny in-memory mock on globalThis.chrome before
 * exercising it, the same technique InstagramResearchSaver's selftest uses.
 *
 * The DOM-bound half (content.ts, scrape.ts — injecting the button, reading
 * LinkedIn's page) needs a real browser and a real, logged-in LinkedIn
 * session, and is covered by the manual checklist in README.md.
 *
 * Run: node scripts/selftest.mjs
 */

import { build } from 'esbuild';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath, pathToFileURL } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');

/* ── Minimal in-memory chrome.storage.local ─────────────────────────── */

function createChromeMock() {
  const store = new Map();
  return {
    storage: {
      local: {
        async get(keys) {
          if (keys === null || keys === undefined) return Object.fromEntries(store);
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys ?? {});
          const result = {};
          for (const key of list) if (store.has(key)) result[key] = store.get(key);
          return result;
        },
        async set(items) {
          for (const [key, value] of Object.entries(items)) store.set(key, value);
        },
        async remove(keys) {
          for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
        },
        async getBytesInUse(keys) {
          const values = keys == null ? [...store.values()] : (Array.isArray(keys) ? keys : [keys]).map(k => store.get(k)).filter(v => v !== undefined);
          return values.reduce((sum, v) => sum + JSON.stringify(v).length, 0);
        },
        async clear() {
          store.clear();
        },
      },
    },
  };
}

globalThis.chrome = createChromeMock();

const entry = path.join(os.tmpdir(), `ljt-selftest-${process.pid}.mjs`);
fs.writeFileSync(
  entry,
  ['capture.ts', 'text.ts', 'formatters.ts', 'storage.ts', 'types.ts']
    .map(file => `export * from ${JSON.stringify(path.join(rootDir, 'src', file).replace(/\\/g, '/'))};`)
    .join('\n')
);

const bundlePath = path.join(os.tmpdir(), `ljt-selftest-bundle-${process.pid}.mjs`);
await build({
  entryPoints: [entry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node20'],
  outfile: bundlePath,
  logLevel: 'silent',
});

const mod = await import(pathToFileURL(bundlePath).href);

let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.log(`  FAIL ${name}${detail !== undefined ? ` — ${detail}` : ''}`);
  }
}

/* ── jobIdFromUrl / normalizeJobUrl — dedupe across page layouts (PRD §7) ── */

console.log('jobIdFromUrl / normalizeJobUrl');
check(
  'reads the id from a permalink path',
  mod.jobIdFromUrl('https://www.linkedin.com/jobs/view/3856219004/') === '3856219004'
);
check(
  'reads the id from a slug-prefixed permalink path',
  mod.jobIdFromUrl('https://www.linkedin.com/jobs/view/software-engineer-at-acme-3856219004/') === '3856219004'
);
check(
  'reads the id from the currentJobId query param (search/collections split view)',
  mod.jobIdFromUrl('https://www.linkedin.com/jobs/search/?currentJobId=3856219004&keywords=engineer') === '3856219004'
);
check(
  'the same job seen via the permalink and via a search pane resolves to the same id',
  mod.jobIdFromUrl('https://www.linkedin.com/jobs/view/3856219004/') ===
    mod.jobIdFromUrl('https://www.linkedin.com/jobs/search/?currentJobId=3856219004')
);
check('an unparseable URL returns null, not a guess', mod.jobIdFromUrl('https://www.linkedin.com/jobs/') === null);
check(
  'normalizeJobUrl builds the canonical permalink from an id',
  mod.normalizeJobUrl('https://www.linkedin.com/jobs/search/?currentJobId=42', '42') === 'https://www.linkedin.com/jobs/view/42/'
);

/* ── text.ts: pure parsing ─────────────────────────────────────────────── */

console.log('text.ts');
check(
  'splitPrimaryDescription pulls location and posted date apart',
  JSON.stringify(mod.splitPrimaryDescription('San Francisco, CA · 3 days ago · Over 100 applicants')) ===
    JSON.stringify({ location: 'San Francisco, CA', postedDateRaw: '3 days ago' })
);
check(
  'splitPrimaryDescription handles "Reposted" phrasing and no applicant count',
  JSON.stringify(mod.splitPrimaryDescription('Remote · Reposted 2 weeks ago')) ===
    JSON.stringify({ location: 'Remote', postedDateRaw: 'Reposted 2 weeks ago' })
);
check('splitPrimaryDescription on an empty string returns both fields empty', mod.splitPrimaryDescription('').location === '' && mod.splitPrimaryDescription('').postedDateRaw === '');

check('extractSalary parses an annual range', mod.extractSalary('$120,000/yr - $150,000/yr') === '$120,000/yr - $150,000/yr');
check('extractSalary parses an hourly range', mod.extractSalary('$45.00/hr - $60.00/hr') === '$45.00/hr - $60.00/hr');
check('extractSalary parses a single figure', mod.extractSalary('$95,000/yr') === '$95,000/yr');
check('a posting with no salary text returns null, not an empty string', mod.extractSalary('Full-time · On-site') === null);

check('looksClosed detects the closed-posting label', mod.looksClosed('No longer accepting applications') === true);
check('looksClosed is false for an open posting', mod.looksClosed('Actively reviewing applicants') === false);

check('truncateText caps length without cutting mid-character', mod.truncateText('a'.repeat(10), 5) === 'aaaaa…');
check('truncateText collapses whitespace', mod.truncateText('  a   b  ') === 'a b');

/* ── buildCapture: capture-card creation + re-track merge semantics ────── */

console.log('buildCapture');

const rawA = {
  jobUrl: 'https://www.linkedin.com/jobs/view/3856219004/',
  title: '  Senior Software Engineer  ',
  company: 'Acme Corp',
  location: 'San Francisco, CA',
  postedDateRaw: '3 days ago',
  salaryRaw: '$150,000/yr - $190,000/yr',
};

const jobA = mod.buildCapture(rawA, null, 1_000);
check('id derives from the job URL', jobA.id === '3856219004');
check('title is trimmed', jobA.title === 'Senior Software Engineer');
check('a freshly tracked job starts in the Saved stage', jobA.stage === 'saved');
check('note starts empty', jobA.note === '');
check('trackedAt and lastActivityAt are set to "now"', jobA.trackedAt === 1_000 && jobA.lastActivityAt === 1_000);
check('a freshly tracked job is never stale', jobA.stale === false);

// Edge case: no salary/location shown on the posting (PRD §7) — stored as
// empty/null, never a fabricated placeholder.
const rawNoExtras = { ...rawA, salaryRaw: null, location: '' };
const jobNoExtras = mod.buildCapture(rawNoExtras, null, 1_000);
check('missing salary is stored as null, not a placeholder string', jobNoExtras.salaryRaw === null);
check('missing location is stored as empty, not a placeholder string', jobNoExtras.location === '');

// Edge case: re-tracking the same job (viewed a second time, or via the
// other page layout) refreshes metadata but preserves the user's progress.
const userEdited = { ...jobA, stage: 'interviewing', note: 'Recruiter call scheduled for Tuesday.', lastActivityAt: 2_000 };
const retracked = mod.buildCapture({ ...rawA, salaryRaw: '$160,000/yr - $195,000/yr' }, userEdited, 5_000);
check('id is unchanged on a re-track', retracked.id === jobA.id);
check('re-tracking does not move the job back to Saved', retracked.stage === 'interviewing');
check('re-tracking keeps the note the user wrote', retracked.note === userEdited.note);
check('re-tracking refreshes the salary', retracked.salaryRaw === '$160,000/yr - $195,000/yr');
check('trackedAt does not move on a re-track', retracked.trackedAt === jobA.trackedAt);
check('lastActivityAt does not move on a metadata-only re-track', retracked.lastActivityAt === userEdited.lastActivityAt);

// Edge case: a metadata refresh where the new view didn't expose a field
// (e.g. the search pane shows no salary this time) must not blank out what
// was already captured.
const missingThisTime = mod.buildCapture({ ...rawA, salaryRaw: null }, retracked, 6_000);
check('a field missing on a later view falls back to what is already stored', missingThisTime.salaryRaw === retracked.salaryRaw);

/* ── Stage transitions, notes, staleness, "days since" ──────────────── */

console.log('stage transitions / staleness / daysSince');

const moved = mod.moveStage(jobA, 'applied', 3_000);
check('moveStage updates the stage', moved.stage === 'applied');
check('moveStage bumps lastActivityAt', moved.lastActivityAt === 3_000);
check('moveStage to the same stage is a no-op (same object)', mod.moveStage(moved, 'applied', 9_999) === moved);

const noted = mod.updateNote(jobA, 'Referred by a friend.', 4_000);
check('updateNote sets the note', noted.note === 'Referred by a friend.');
check('updateNote bumps lastActivityAt', noted.lastActivityAt === 4_000);
check('updateNote with the same text is a no-op (same object)', mod.updateNote(noted, noted.note, 9_999) === noted);

const staled = mod.setStale(jobA, true);
check('setStale marks a job stale', staled.stale === true);
check('setStale never touches stage', staled.stage === jobA.stage);
check('setStale never touches note', staled.note === jobA.note);
check('setStale never touches lastActivityAt', staled.lastActivityAt === jobA.lastActivityAt);
check('setStale with the same value is a no-op (same object)', mod.setStale(staled, true) === staled);

check('daysSince rounds down to whole days', mod.daysSince(0, 3 * 86_400_000 + 1000) === 3);
check('daysSince never goes negative for a future lastActivityAt (clock skew)', mod.daysSince(10_000, 0) === 0);

/* ── Export formats ─────────────────────────────────────────────────── */

console.log('exports');

const now = 10 * 86_400_000;
const jobs = [
  { ...jobA, id: 'j1', stage: 'saved', title: 'Backend Engineer', company: 'Acme, Inc.', note: '', trackedAt: 1000, lastActivityAt: 1000 },
  { ...jobA, id: 'j2', stage: 'interviewing', title: 'Data Scientist', company: 'Umbrella, Inc. "Labs"', note: 'Loop scheduled', location: '', salaryRaw: null, trackedAt: 2000, lastActivityAt: now, stale: true },
];

const csv = mod.toCsv(jobs, now);
const csvLines = csv.trim().split('\r\n');
check('CSV has a header plus one row per job', csvLines.length === jobs.length + 1, csvLines.length);
check('CSV header names the capture fields', csvLines[0].includes('Company') && csvLines[0].includes('Salary'));
check('a company containing a quote is CSV-escaped', csvLines[2].includes('""Labs""'), csvLines[2]);
check('a company containing a comma is wrapped in quotes', /"[^"]*Umbrella[^"]*"/.test(csvLines[2]), csvLines[2]);
check('a missing salary renders as an empty cell, not "null"', !csv.includes('null'));

const md = mod.toMarkdown(jobs, now);
check('Markdown groups jobs under their stage heading', md.includes('# Saved') && md.includes('# Interviewing'));
check('Markdown includes the job title and company', md.includes('## Backend Engineer — Acme, Inc.'));
check('Markdown flags a stale job', md.includes('No longer accepting applications'));
check('Markdown includes the note when present', md.includes('Loop scheduled'));
check('Markdown links back to the original posting', md.includes(`[Open posting](${jobs[0].jobUrl})`));

const emptyMd = mod.toMarkdown([], now);
check('an empty tracker exports without throwing', emptyMd.includes('No tracked jobs yet'));

const filename = mod.buildExportFilename('csv');
check('export filenames end with the right extension', filename.endsWith('.csv'));
check('export filenames are dated', /linkedin-job-tracker-\d{4}-\d{2}-\d{2}\.csv/.test(filename), filename);

/* ── Storage: dedupe-on-retrack + import merge-by-id ─────────────────── */

console.log('storage');

const built = mod.buildCapture(rawA, null, 1_000);
await mod.saveJob(built.id, existing => mod.buildCapture(rawA, existing, 1_000));
const afterFirstTrack = await mod.readAllJobs();
check('tracking a new job stores exactly one card', afterFirstTrack.length === 1);

const secondCapture = mod.buildCapture({ ...rawA, salaryRaw: '$999,000/yr' }, null, 2_000);
const saved2 = await mod.saveJob(built.id, existing => mod.buildCapture({ ...rawA, salaryRaw: '$999,000/yr' }, existing, 2_000));
const afterSecondTrack = await mod.readAllJobs();
check('re-tracking the same job updates it, not a duplicate', afterSecondTrack.length === 1, afterSecondTrack.length);
check('the update carries the new salary', saved2.salaryRaw === '$999,000/yr');
check('id is stable across re-tracks of the same job', secondCapture.id === saved2.id);

const changedStage = await mod.changeStage(built.id, 'offer');
check('changeStage persists the new stage', changedStage?.stage === 'offer');
const afterStageRead = await mod.readJob(built.id);
check('changeStage is durable', afterStageRead?.stage === 'offer');

const changedNote = await mod.changeNote(built.id, 'Signing bonus offered.');
check('changeNote persists the note', changedNote?.note === 'Signing bonus offered.');

const markedStale = await mod.markStale(built.id, true);
check('markStale persists without moving the stage', markedStale?.stale === true && markedStale?.stage === 'offer');

check('changeStage on an untracked id returns null rather than throwing', (await mod.changeStage('not-a-real-id', 'saved')) === null);

const quota = await mod.quotaStatus();
check('quota status reports a nonzero byte count once data exists', quota.bytes > 0, quota.bytes);
check('quota is not flagged as warning at this tiny size', quota.warn === false);

const backup = await mod.exportBackup();
check('exported backup is re-importable', backup.format === 'linkedin-job-tracker' && backup.version === 1);
check('exported backup carries every tracked job', backup.jobs.length === afterSecondTrack.length);

await mod.clearAllData();
check('clearAllData removes every job', (await mod.readAllJobs()).length === 0);

const importResult1 = await mod.importBackup(backup);
check('importing a backup restores its jobs', importResult1.jobs === backup.jobs.length);
const afterFirstImport = await mod.readAllJobs();

const importResult2 = await mod.importBackup(backup);
check('importing the same backup twice does not duplicate jobs', (await mod.readAllJobs()).length === afterFirstImport.length);
check('re-import reports the same job count, not a growing one', importResult2.jobs === backup.jobs.length);

const editedBackup = {
  ...backup,
  jobs: backup.jobs.map(j => ({ ...j, note: 'Imported note' })),
};
await mod.importBackup(editedBackup);
const afterEditedImport = await mod.readAllJobs();
check(
  'importing an updated backup overwrites the matching card by id (merge-by-id)',
  afterEditedImport.every(j => j.note === 'Imported note'),
  afterEditedImport.map(j => j.note)
);

check(
  "importBackup rejects a file that is not this product's backup format",
  await mod.importBackup({ format: 'something-else' }).then(
    () => false,
    () => true
  )
);

check(
  'importBackup skips a record with an invalid stage rather than corrupting storage',
  await mod
    .importBackup({ format: 'linkedin-job-tracker', version: 1, exportedAt: '', jobs: [{ id: 'bad', jobUrl: 'https://x', stage: 'not-a-stage' }] })
    .then(result => result.jobs === 0)
);

// Quota failure must never drop a track silently.
const originalSet = globalThis.chrome.storage.local.set;
globalThis.chrome.storage.local.set = async () => {
  throw new Error('QUOTA_BYTES_PER_ITEM quota exceeded');
};
let threw = false;
try {
  await mod.saveJob('j:quota-test', existing => mod.buildCapture(rawA, existing, 1_000));
} catch (error) {
  threw = true;
  check('a quota failure surfaces a plain-language error, not a raw exception', /storage is full/i.test(error.message), error.message);
}
check('a storage failure while tracking throws rather than failing silently', threw);
globalThis.chrome.storage.local.set = originalSet;

fs.rmSync(entry, { force: true });
fs.rmSync(bundlePath, { force: true });

console.log(failures ? `\n${failures} check(s) failed.` : '\nAll checks passed.');
process.exit(failures ? 1 : 0);
